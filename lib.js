import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

/* ---------- settings ---------- */
export const cfg = {
  get workerUrl() { return (localStorage.getItem('workerUrl') || '').trim().replace(/\/$/, ''); },
  get aaiKey() { return (localStorage.getItem('aaiKey') || '').trim(); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- voices (Edge TTS only has 2 Burmese voices; personas vary pitch/rate) ---------- */
const THIHA = 'my-MM-ThihaNeural', NILAR = 'my-MM-NilarNeural';
export const PERSONAS = [
  { id: 'BB', name: 'ဘိုဘို', g: 'Male', voice: THIHA, pitch: 0, rate: 0 },
  { id: 'NL', name: 'ညဏ်လင်း', g: 'Male', voice: THIHA, pitch: -6, rate: -4 },
  { id: 'PW', name: 'ဖြိုးဝေ', g: 'Male', voice: THIHA, pitch: 6, rate: 6 },
  { id: 'KM', name: 'ကောင်းမြတ်', g: 'Male', voice: THIHA, pitch: -12, rate: 0 },
  { id: 'ZK', name: 'ဇေကို', g: 'Male', voice: THIHA, pitch: 12, rate: 4 },
  { id: 'HS', name: 'နှင်းဆီ', g: 'Female', voice: NILAR, pitch: 0, rate: 0 },
  { id: 'SL', name: 'စုလွင်', g: 'Female', voice: NILAR, pitch: 6, rate: 4 },
  { id: 'YS', name: 'ယွန်းရွှေ', g: 'Female', voice: NILAR, pitch: -6, rate: -4 },
  { id: 'EC', name: 'အိမ့်ချစ်', g: 'Female', voice: NILAR, pitch: 12, rate: 6 },
  { id: 'TS', name: 'သက်စု', g: 'Female', voice: NILAR, pitch: -10, rate: 0 }
];

/* ---------- ffmpeg (core files are kept in Cache Storage after the first download) ---------- */
let ff = null, progCb = null, ffLoading = null, dlCb = null;
export const setFFProgress = cb => { progCb = cb; };

const FF_CACHE = 'ffmpeg-core-v1';
const FF_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
const FF_FILES = [
  { name: 'ffmpeg-core.js', type: 'text/javascript', w: 0.05 },
  { name: 'ffmpeg-core.wasm', type: 'application/wasm', w: 0.95 }
];

async function ffAsset(file, onFrac) {
  const url = `${FF_BASE}/${file.name}`;
  let cache = null;
  try { cache = await caches.open(FF_CACHE); } catch {}
  const hit = cache ? await cache.match(url) : null;
  if (hit) {
    const b = await hit.blob();
    onFrac(1);
    return URL.createObjectURL(new Blob([b], { type: file.type }));
  }
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Engine ဒေါင်းလုဒ် မရပါ (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onFrac(total ? Math.min(0.99, got / total) : 0);
  }
  const blob = new Blob(parts, { type: file.type });
  if (cache) { try { await cache.put(url, new Response(blob, { headers: { 'content-type': file.type } })); } catch {} }
  onFrac(1);
  return URL.createObjectURL(blob);
}

export function getFFmpeg(onProg) {
  if (onProg) dlCb = onProg;
  if (ff) { dlCb && dlCb(1); return Promise.resolve(ff); }
  if (!ffLoading) {
    ffLoading = (async () => {
      const f = new FFmpeg();
      f.on('progress', ({ progress }) => progCb && progCb(Math.max(0, Math.min(1, progress))));
      const urls = [];
      let doneW = 0;
      for (const file of FF_FILES) {
        const base = doneW;
        urls.push(await ffAsset(file, p => dlCb && dlCb(base + p * file.w)));
        doneW += file.w;
      }
      await f.load({ coreURL: urls[0], wasmURL: urls[1] });
      ff = f;
      return f;
    })().finally(() => { ffLoading = null; dlCb = null; });
  }
  return ffLoading;
}

export async function ffmpegCached() {
  try {
    const c = await caches.open(FF_CACHE);
    const r = await Promise.all(FF_FILES.map(f => c.match(`${FF_BASE}/${f.name}`)));
    return r.every(Boolean);
  } catch { return false; }
}

export async function ffmpegClear() {
  try { await caches.delete(FF_CACHE); } catch {}
  ff = null;
  keptInput = null;
}

export function videoDuration(file) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); };
    v.onerror = () => rej(new Error('Video ဖိုင်ကို ဖတ်မရပါ'));
    v.src = URL.createObjectURL(file);
  });
}

const extOf = f => (f.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';

let keptInput = null;
export async function forgetInput() {
  if (ff && keptInput) { try { await ff.deleteFile(keptInput); } catch {} }
  keptInput = null;
}

export async function extractAudio(file, onProg) {
  const f = await getFFmpeg();
  setFFProgress(onProg);
  await forgetInput();
  const inName = 'in.' + extOf(file);
  try { await f.writeFile(inName, await fetchFile(file)); }
  catch { throw new Error('Video ဖိုင်ကို ဖတ်မရပါ — ဖုန်း Downloads/Movies ထဲက ဖိုင်ကို ပြန်ရွေးပါ'); }
  keptInput = inName;
  const code = await f.exec(['-i', inName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'a.wav']);
  if (code !== 0) throw new Error('Video ထဲက အသံကို ထုတ်မရပါ');
  const data = await f.readFile('a.wav');
  await f.deleteFile('a.wav');
  return new Blob([data.slice().buffer], { type: 'audio/wav' });
}

/* ---------- AssemblyAI (through the worker) ---------- */
async function aai(path, opts = {}) {
  if (!cfg.workerUrl || !cfg.aaiKey) throw new Error('API Key Settings ထဲမှာ Worker URL နဲ့ AssemblyAI key ကို အရင်ထည့်ပါ');
  const r = await fetch(`${cfg.workerUrl}/aai${path}`, {
    ...opts,
    headers: { authorization: cfg.aaiKey, ...(opts.headers || {}) }
  });
  if (!r.ok) throw new Error(`AssemblyAI ${r.status}: ${await r.text()}`);
  return r.json();
}

const tidy = t => t.replace(/(?<=[\u3000-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u9fff\uff00-\uffef])/g, '').trim();

/* Own line splitting from word timings, so the line count stays stable between runs */
const SEG = { gap: 0.6, maxDur: 8, maxChars: 80, minPunct: 1.5 };
const ENDP = /[。！？!?.…]$/;

function segmentWords(words) {
  const segs = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const text = tidy(cur.text);
    if (text) segs.push({ start: cur.start / 1000, end: cur.end / 1000, text });
    cur = null;
  };
  for (const w of words) {
    if (cur) {
      const gap = (w.start - cur.end) / 1000;
      const dur = (w.end - cur.start) / 1000;
      if (gap > SEG.gap || dur > SEG.maxDur || cur.text.length >= SEG.maxChars) flush();
    }
    if (!cur) cur = { start: w.start, end: w.end, text: w.text };
    else { cur.text += ' ' + w.text; cur.end = w.end; }
    if (ENDP.test(w.text.trim()) && (cur.end - cur.start) / 1000 >= SEG.minPunct) flush();
  }
  flush();
  return segs;
}

export async function transcribe(blob, lang, onStatus) {
  // same audio + same language -> reuse the earlier result (no new AssemblyAI call)
  const key = `tx:${lang}:${blob.size}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(hit) && hit.length) { onStatus('processing'); return hit; }
  } catch {}

  onStatus('uploading');
  const up = await aai('/v2/upload', { method: 'POST', body: blob, headers: { 'content-type': 'application/octet-stream' } });
  const body = { audio_url: up.upload_url };
  if (lang === 'auto') body.language_detection = true; else body.language_code = lang;
  const t = await aai('/v2/transcript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (;;) {
    await sleep(3000);
    const s = await aai('/v2/transcript/' + t.id);
    if (s.status === 'completed') break;
    if (s.status === 'error') throw new Error('AssemblyAI: ' + s.error);
    onStatus(s.status);
  }

  const full = await aai('/v2/transcript/' + t.id);
  let segs = segmentWords(full.words || []);
  if (!segs.length) {
    const sent = await aai(`/v2/transcript/${t.id}/sentences`);
    segs = (sent.sentences || []).map(s => ({ start: s.start / 1000, end: s.end / 1000, text: tidy(s.text) })).filter(s => s.text);
  }
  if (!segs.length) throw new Error('စကားပြောသံ မတွေ့ပါ');
  try { localStorage.setItem(key, JSON.stringify(segs)); } catch {}
  return segs;
}

/* ---------- Gemini prompt (same format as the original app) ---------- */
export function buildPrompt(segs) {
  const lines = segs.map((s, i) => {
    const slot = (i + 1 < segs.length ? segs[i + 1].start : s.end) - s.start;
    return `ID: ${i} | Duration: ${Math.max(slot, s.end - s.start).toFixed(1)}s | Text: "${s.text}"`;
  }).join('\n');
  return `You are a professional video dubbing translator. You MUST translate the following subtitles into natural spoken Burmese (Myanmar script ONLY, NO English, NO phonetic guides).
Translate each line so that it sounds natural in a movie recap narration. Do not translate word-for-word.
Timing is critical: Burmese narration is spoken at about 4-5 syllables per second, so each line MUST be short enough to be spoken within its Duration (for example 2.0s allows roughly 8-10 syllables). Condense the meaning and drop minor details instead of translating everything. Being on time matters more than completeness.
Source lines may be cut in the middle of a sentence. Still translate each line on its own so it sounds natural by itself, and keep the same order and the same number of lines.
Return the result STRICTLY as a JSON object with a single key "translations" containing an array of strings in order, exactly one string per ID.
Example:
{
"translations": [
"မြန်မာစာသား ၁",
"မြန်မာစာသား ၂"
]
}
Inputs:
${lines}`;
}

export function buildShortenPrompt(segs, burmese, longLines) {
  const lm = new Map(longLines.map(x => [x.i, x.ratio]));
  const lines = segs.map((s, i) => {
    const slot = (i + 1 < segs.length ? segs[i + 1].start : s.end) - s.start;
    const r = lm.get(i);
    const flag = r ? ` | LONG: rewrite to about ${Math.max(20, Math.floor(r * 85))}% of its current length` : '';
    return `ID: ${i} | Duration: ${Math.max(slot, s.end - s.start).toFixed(1)}s${flag} | Source: "${s.text}" | Burmese: "${burmese[i] || ''}"`;
  }).join('\n');
  return `You are a professional dubbing script editor. Below are Burmese narration lines for a movie recap, each with its source text and the time (Duration) available to speak it.
Lines marked LONG cannot be spoken within their Duration. Rewrite ONLY those lines so they are shorter by the percentage given: condense the meaning, drop minor details, and keep natural spoken Burmese (Myanmar script ONLY, NO English). Keep every other line exactly unchanged.
Return the FULL result STRICTLY as a JSON object with a single key "translations" containing an array of exactly ${segs.length} strings in order.
Inputs:
${lines}`;
}

export function parseTranslations(raw) {
  let s = raw.trim().replace(/```json|```/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('JSON မတွေ့ပါ — Gemini ရလဒ်ကို အကုန် paste လုပ်ပါ');
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch { throw new Error('JSON ပုံစံ မမှန်ပါ'); }
  if (!Array.isArray(obj.translations)) throw new Error('"translations" array မတွေ့ပါ');
  return obj.translations.map(x => String(x ?? '').replace(/\s*\n\s*/g, ' ').trim());
}

/* ---------- TTS ---------- */
export async function tts(text, persona, pitchOffset = 0, tries = 3) {
  let last;
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(cfg.workerUrl + '/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice: persona.voice, pitch: persona.pitch + pitchOffset, rate: persona.rate })
      });
      if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
      const ab = await r.arrayBuffer();
      if (ab.byteLength < 200) throw new Error('TTS audio မရပါ');
      return ab;
    } catch (e) { last = e; await sleep(600 * (k + 1)); }
  }
  throw last;
}

/* ---------- render ---------- */
const SR = 24000, GAP = 0.05;

// leading/trailing silence of a TTS clip, so speech starts exactly at the slot start
function trimBounds(buf, thr = 0.012) {
  const ch = buf.getChannelData(0), n = ch.length;
  let a = 0, b = n - 1;
  while (a < n && Math.abs(ch[a]) < thr) a++;
  while (b > a && Math.abs(ch[b]) < thr) b--;
  if (a >= b) return { lead: 0, len: buf.duration };
  const lead = Math.max(0, a / buf.sampleRate - 0.02);
  const end = Math.min(buf.duration, (b + 1) / buf.sampleRate + 0.05);
  return { lead, len: end - lead };
}

function encodeWav(buf) {
  const ch = buf.getChannelData(0), n = ch.length;
  const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, ch[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Uint8Array(ab);
}

const tempoChain = t => {
  const parts = [];
  while (t > 2) { parts.push('atempo=2.0'); t /= 2; }
  parts.push(`atempo=${t.toFixed(4)}`);
  return parts.join(',');
};

/* ---- ducking: original audio quiet while someone speaks, full volume otherwise ---- */
function duckIntervals(segs, placed, pad = 0.3, mergeGap = 0.8) {
  const iv = [];
  segs.forEach((s, i) => {
    const p = placed[i]; if (!p) return;
    iv.push([Math.min(s.start, p.start) - pad, Math.max(s.end, p.end) + pad]);
  });
  iv.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of iv) {
    const l = out[out.length - 1];
    if (l && a <= l[1] + mergeGap) l[1] = Math.max(l[1], b); else out.push([Math.max(0, a), b]);
  }
  return out;
}
function gainExpr(iv, talk, gap, r = 0.2) {
  if (!iv.length) return gap.toFixed(3);
  const terms = iv.map(([a, b]) =>
    `max(0,min(1,min((t-(${(a - r).toFixed(3)}))/${r},((${(b + r).toFixed(3)})-t)/${r})))`).join('+');
  return `${gap.toFixed(3)}+(${(talk - gap).toFixed(3)})*min(1,${terms})`;
}

function dubStats(placed, maxTempo) {
  const d = placed.filter(Boolean).map(p => p.drift);
  const longLines = [];
  placed.forEach((p, i) => { if (p && p.natural > p.slot * maxTempo * 1.02) longLines.push({ i, ratio: (p.slot * maxTempo) / p.natural }); });
  return { lateCount: d.filter(x => x > 0.5).length, maxDrift: Math.max(0, ...d), longLines };
}

export async function renderDub({ file, videoDur, segs, burmese, persona, pitch, keepTalk = 0, keepGap = 0, offset = 0, maxTempo = 1.7, dubGain = 1.6, onProgress }) {
  const n = segs.length;
  const f = await getFFmpeg();
  const ctx = new OfflineAudioContext(1, Math.ceil((videoDur + 30) * SR), SR);

  // 1) TTS (3 in parallel) — 0..50%
  const raw = new Array(n).fill(null);
  const todo = [...Array(n).keys()].filter(i => burmese[i]);
  const total = todo.length || 1;
  let done = 0;
  const run = async () => {
    while (todo.length) {
      const i = todo.shift();
      raw[i] = await tts(burmese[i], persona, pitch);
      done++;
      onProgress((done / total) * 0.5, `အသံထုတ်နေသည် ${done}/${total}`);
    }
  };
  await Promise.all([run(), run(), run()]);

  // 2) fit each clip into its time slot — 50..75%
  setFFProgress(null);
  const placed = new Array(n).fill(null);
  const clips = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    onProgress(0.5 + (i / n) * 0.25, `အချိန်ကိုက်နေသည် ${i + 1}/${n}`);
    if (!raw[i]) continue;
    let buf = await ctx.decodeAudioData(raw[i].slice(0));
    let tb = trimBounds(buf);
    const natural = tb.len;
    const want = segs[i].start + offset;
    const start = Math.max(want, cursor, 0);
    const nextStart = i + 1 < n ? segs[i + 1].start + offset : videoDur;
    const slot = Math.max(nextStart - start - GAP, 0.3);
    const tempo = Math.min(tb.len / slot, maxTempo);
    if (tempo > 1.03) {
      await f.writeFile('s.mp3', new Uint8Array(raw[i]));
      const code = await f.exec(['-i', 's.mp3', '-filter:a', tempoChain(tempo), '-ar', String(SR), '-ac', '1', 's.wav']);
      if (code === 0) {
        const wav = await f.readFile('s.wav');
        buf = await ctx.decodeAudioData(wav.slice().buffer);
        tb = trimBounds(buf);
        await f.deleteFile('s.wav');
      }
      await f.deleteFile('s.mp3');
    }
    clips.push({ buf, start, lead: tb.lead, len: tb.len });
    placed[i] = { start, end: start + tb.len, drift: start - want, natural, slot };
    cursor = start + tb.len + GAP;
  }

  // 3) mix all clips into one track — 75..85%
  onProgress(0.76, 'အသံတွဲနေသည်');
  for (const c of clips) {
    const src = ctx.createBufferSource();
    src.buffer = c.buf;
    src.connect(ctx.destination);
    src.start(c.start, c.lead, c.len);
  }
  const mixed = await ctx.startRendering();
  const wavBytes = encodeWav(mixed);
  onProgress(0.85, 'Video နဲ့ ပေါင်းနေသည်');

  // 4) mux with video — 85..100%
  let inName = keptInput, temp = false;
  if (inName) {
    try { const l = await f.listDir('/'); if (!l.some(x => x.name === inName)) inName = null; } catch { inName = null; }
  }
  if (!inName) {
    inName = 'v.' + extOf(file); temp = true;
    try { await f.writeFile(inName, await fetchFile(file)); }
    catch { throw new Error('Video ဖိုင်ကို ပြန်ဖတ်မရပါ — "Video ပြန်ရွေးပြီး ပြန်စမည်" ကိုနှိပ်ပါ'); }
  }
  await f.writeFile('mix.wav', wavBytes);
  setFFProgress(p => onProgress(0.85 + p * 0.15, 'Video ပေါင်းနေသည်'));
  const outArgs = ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', 'out.mp4'];
  const attempts = [];
  const wantMix = keepTalk > 0 || keepGap > 0;
  if (wantMix) {
    const g = gainExpr(duckIntervals(segs, placed), keepTalk, keepGap);
    const head = `[0:a]volume='${g}':eval=frame[o];[1:a]volume=${dubGain.toFixed(2)},apad[d];[o][d]amix=inputs=2:duration=first:dropout_transition=0,volume=2`;
    for (const tail of [',alimiter=limit=0.95:level=0', '']) {
      attempts.push(['-i', inName, '-i', 'mix.wav', '-filter_complex', `${head}${tail}[a]`, '-map', '0:v:0', '-map', '[a]']);
    }
  }
  attempts.push(['-i', inName, '-i', 'mix.wav', '-map', '0:v:0', '-map', '1:a:0']);
  let code = -1, used = -1;
  for (let k = 0; k < attempts.length; k++) {
    code = await f.exec([...attempts[k], ...outArgs]);
    used = k;
    if (code === 0) break;
    try { await f.deleteFile('out.mp4'); } catch {}
  }
  if (code !== 0) throw new Error('Video ပေါင်းစပ်မှု မအောင်မြင်ပါ (ffmpeg error)');
  const fellBack = wantMix && used === attempts.length - 1;
  const out = await f.readFile('out.mp4');
  for (const x of [temp ? inName : null, 'mix.wav', 'out.mp4']) { if (x) { try { await f.deleteFile(x); } catch {} } }
  setFFProgress(null);
  onProgress(1, 'ပြီးပါပြီ');
  return { video: new Blob([out.slice().buffer], { type: 'video/mp4' }), placed, fellBack, stats: dubStats(placed, maxTempo) };
}

/* ---------- SRT ---------- */
const ts = s => {
  const ms = Math.round(s * 1000);
  const p = (v, l = 2) => String(v).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export function buildSrt(burmese, placed) {
  return burmese.map((t, i) => placed[i] && t ? `${i + 1}\n${ts(placed[i].start)} --> ${ts(placed[i].end)}\n${t}\n` : '').filter(Boolean).join('\n');
}
