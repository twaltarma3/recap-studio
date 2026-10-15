import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { PT16_B64, AKK_B64 } from './fonts-data.js';

/* ---------- settings ---------- */
// Cloudflare Worker proxy (Edge TTS + AssemblyAI). Built in, so users never have to enter it.
const WORKER_URL = 'https://recap-proxy.twaltarma3.workers.dev';

export const cfg = {
  get workerUrl() { return WORKER_URL; },
  get aaiKey() { return (localStorage.getItem('aaiKey') || '').trim(); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- access code + daily limit (checked by the Worker) ---------- */
// The Worker counts one use per video per day; /auth/start hands back a ticket that /tts needs.
let ticket = '';
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
export const access = {
  get code() { return lsGet('accessCode'); },
  set code(v) { try { v ? localStorage.setItem('accessCode', v) : localStorage.removeItem('accessCode'); } catch {} },
  get adminPass() { return lsGet('adminPass'); },
  set adminPass(v) { try { v ? localStorage.setItem('adminPass', v) : localStorage.removeItem('adminPass'); } catch {} }
};
async function accessPost(path, body, headers = {}) {
  const r = await fetch(cfg.workerUrl + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ...j };
}
// {open:true} = no access codes on this Worker; {error:'bad_code'|'expired'}; else {name, limit, used, left, plan, expires, credits}
// Premium codes with credits also get a ticket for the premium routes (transcription with the owner's key, AI translation).
// Premium is paid by video length (CPM credits a minute): job() names the video in hand (set by the app),
// its first premium use pays for it.
export const CPM = 80;
export const creditCost = secs => Math.max(1, Math.ceil(Math.max(0, secs || 0) * CPM / 60));
let pticket = '';
export const premium = { get on() { return !!pticket; }, job: () => '' };
export async function accessCheck(code) {
  const r = await accessPost('/auth/check', { code: code ?? access.code, job: premium.job() });
  pticket = r.pticket || '';
  return r;
}
// call a premium route; an expired premium ticket (6 h) is renewed once
async function premiumFetch(path, opts = {}) {
  for (let k = 0; k < 2; k++) {
    const r = await fetch(cfg.workerUrl + path, { ...opts, headers: { ...(opts.headers || {}), 'x-ticket': pticket, 'x-job': premium.job() } });
    if (r.status === 403 && k === 0) { await accessCheck().catch(() => {}); if (pticket) continue; }
    return r;
  }
}
const PREMIUM_ERR = {
  premium_only: 'Premium Code မဟုတ်တော့ပါ (သို့) ပိတ်ထားပါတယ်',
  no_credit: '💎 Credit မလောက်တော့ပါ — Admin ဆီက ထပ်ဖြည့်ပါ',
  premium_cap: 'ယနေ့အတွက် Premium အလိုအလျောက် သုံးခွင့် ပြည့်သွားပါပြီ — မနက်ဖြန် ပြန်သုံးပါ',
  no_gemini_key: 'Admin က Gemini key မထည့်ရသေးပါ',
  no_ai: 'Admin က AI (Workers AI / Gemini) မချိတ်ရသေးပါ',
  no_aai_key: 'Admin က AssemblyAI key မထည့်ရသေးပါ'
};
// Premium: Gemini answers a prompt on the Worker (json = ask for a JSON reply)
export async function premiumAI(prompt, json = false) {
  const r = await premiumFetch('/premium/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, json }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.text) throw new Error(PREMIUM_ERR[j.error] || ('AI မအောင်မြင်ပါ: ' + (j.detail || j.error || r.status)));
  return j.text;
}
// Premium: translate all lines in small batches, so the AI keeps the line count (big batches drop lines).
// A batch that comes back with the wrong count is asked again, then split in half; a line that still fails stays empty.
// An error from the AI itself (location, key, credits, network) stops everything at once and is shown.
export async function autoTranslate(segs, style, onProgress) {
  const out = new Array(segs.length).fill('');
  let done = 0;
  const run = async (from, to, tries = 0) => {
    const part = segs.slice(from, to);
    const text = await premiumAI(buildPrompt(part, style), true);
    let t = [];
    try { t = parseTranslations(text); } catch {}
    if (t.length === part.length) {
      t.forEach((x, i) => { out[from + i] = x; });
      done += part.length; if (onProgress) onProgress(done / segs.length);
      return;
    }
    if (tries < 1) return run(from, to, tries + 1);
    if (part.length > 1) { const mid = from + Math.ceil(part.length / 2); await run(from, mid); return run(mid, to); }
    done += 1; if (onProgress) onProgress(done / segs.length);
  };
  const BATCH = 12, starts = [];
  for (let i = 0; i < segs.length; i += BATCH) starts.push(i);
  for (let k = 0; k < starts.length; k += 3) {             // 3 batches at a time
    await Promise.all(starts.slice(k, k + 3).map(i => run(i, Math.min(segs.length, i + BATCH))));
  }
  return out;
}
// uses one of today's videos (same job again = free); returns {ticket, left, ...} or {error:'limit'|'bad_code'}
export async function accessStart(job, secs = 0) {
  const r = await accessPost('/auth/start', { code: access.code, job, secs });
  if (r.ticket) ticket = r.ticket;
  return r;
}
export const adminCall = body => accessPost('/admin/codes', body, { authorization: 'Bearer ' + access.adminPass });

/* ---------- voices (Edge TTS only has 2 Burmese voices; personas vary pitch/rate) ---------- */
const THIHA = 'my-MM-ThihaNeural', NILAR = 'my-MM-NilarNeural';
export const PERSONAS = [
  { id: 'TH', name: 'သီဟ', g: 'Male', voice: THIHA, pitch: 0, rate: 0 },
  { id: 'NL', name: 'နီလာ', g: 'Female', voice: NILAR, pitch: 0, rate: 0 }
];

/* ---------- ffmpeg (core files are kept in Cache Storage after the first download) ---------- */
let ff = null, progCb = null, ffLoading = null, dlCb = null;
export const setFFProgress = cb => { progCb = cb; };

// 'st' = the normal single-thread engine; 'mt' = multi-core engine (needs a cross-origin-isolated page)
const CORES = {
  st: {
    cache: 'ffmpeg-core-v1', base: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm',
    files: [
      { name: 'ffmpeg-core.js', type: 'text/javascript', w: 0.05 },
      { name: 'ffmpeg-core.wasm', type: 'application/wasm', w: 0.95 }
    ]
  },
  mt: {
    cache: 'ffmpeg-core-mt-v1', base: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm',
    files: [
      { name: 'ffmpeg-core.js', type: 'text/javascript', w: 0.04 },
      { name: 'ffmpeg-core.wasm', type: 'application/wasm', w: 0.95 },
      { name: 'ffmpeg-core.worker.js', type: 'text/javascript', w: 0.01 }
    ]
  }
};
// multi-core: only when the browser allows it (SharedArrayBuffer) AND the user switched it on in Settings
export const mtSupported = () => typeof SharedArrayBuffer !== 'undefined' && !!globalThis.crossOriginIsolated;
export const mtWanted = () => { try { return localStorage.getItem('ffMt') === '1'; } catch { return false; } };
const wantKind = () => (mtWanted() && mtSupported() ? 'mt' : 'st');
let ffKind = null, mtFailed = false;
// which engine is running: { kind: 'mt' | 'st' | null, fellBack: multi-core was wanted but could not start }
export const engineInfo = () => ({ kind: ffKind, fellBack: mtFailed && mtWanted() });
export function setMtWanted(on) {
  try { on ? localStorage.setItem('ffMt', '1') : localStorage.removeItem('ffMt'); } catch {}
  mtFailed = false;
  if (ff && ffKind !== wantKind()) { try { ff.terminate(); } catch {} ff = null; ffKind = null; keptInput = null; }
}

async function ffAsset(core, file, onFrac) {
  const url = `${core.base}/${file.name}`;
  let cache = null;
  try { cache = await caches.open(core.cache); } catch {}
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

async function loadCore(kind) {
  const core = CORES[kind];
  const f = new FFmpeg();
  f.on('progress', ({ progress }) => progCb && progCb(Math.max(0, Math.min(1, progress))));
  const urls = [];
  let doneW = 0;
  for (const file of core.files) {
    const base = doneW;
    urls.push(await ffAsset(core, file, p => dlCb && dlCb(base + p * file.w)));
    doneW += file.w;
  }
  const opts = { coreURL: urls[0], wasmURL: urls[1] };
  if (urls[2]) opts.workerURL = urls[2];
  let timer;
  try {
    // a multi-core start that never finishes must not block the app
    await Promise.race([f.load(opts), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Engine start timeout')), 60000); })]);
  } catch (e) { try { f.terminate(); } catch {} throw e; }
  finally { clearTimeout(timer); }
  return f;
}

export function getFFmpeg(onProg) {
  if (onProg) dlCb = onProg;
  if (ff && ffKind === wantKind()) { dlCb && dlCb(1); return Promise.resolve(ff); }
  if (!ffLoading) {
    ffLoading = (async () => {
      if (ff) { try { ff.terminate(); } catch {} ff = null; ffKind = null; keptInput = null; }   // engine choice changed
      let kind = mtFailed ? 'st' : wantKind();
      let f;
      try { f = await loadCore(kind); }
      catch (e) {
        if (kind !== 'mt') throw e;
        mtFailed = true; kind = 'st';                 // multi-core could not start -> fall back to the normal engine
        f = await loadCore('st');
      }
      ff = f; ffKind = kind;
      return f;
    })().finally(() => { ffLoading = null; dlCb = null; });
  }
  return ffLoading;
}

// Runs one ffmpeg command. On the multi-core engine a stuck run (no log / progress for 30 s) is
// stopped, multi-core is switched off for this session and an error with .mtStall is thrown,
// so the caller can simply run again on the normal engine.
const MT_STALL_MS = 30000;
async function ffRun(f, args) {
  if (ffKind !== 'mt') return f.exec(args);
  let last = Date.now(), iv, stalled = false;
  const mark = () => { last = Date.now(); };
  f.on('log', mark); f.on('progress', mark);
  try {
    return await Promise.race([
      f.exec(args),
      new Promise((_, rej) => {
        iv = setInterval(() => {
          if (Date.now() - last < MT_STALL_MS) return;
          stalled = true; mtFailed = true;
          if (ff === f) { ff = null; ffKind = null; keptInput = null; }
          rej(new Error('stall'));
          try { f.terminate(); } catch {}         // also rejects the pending exec ("called FFmpeg.terminate()")
        }, 2000);
      })
    ]);
  } catch (err) {
    if (!stalled) throw err;
    const e = new Error('Multi-core Engine ရပ်သွားလို့ ပုံမှန် Engine ကို ပြောင်းသုံးပါမယ် — ပြန်စမည် ကိုနှိပ်ပါ');
    e.mtStall = true; throw e;                    // always report the stall, whichever rejection arrived first
  } finally { clearInterval(iv); try { f.off('log', mark); f.off('progress', mark); } catch {} }
}
// Thread limits for the multi-core build. It has a fixed pool of 32 threads; with automatic settings every
// input (video, audio, subtitle PNGs, logo PNG) opens about one decoder thread per CPU core, so on an 8-core
// phone the pool runs out and ffmpeg waits forever. Explicit small numbers avoid that and were also fastest.
const mtArgs = () => (ffKind === 'mt' ? ['-filter_threads', '1', '-filter_complex_threads', '1'] : []);
const mtIn = n => (ffKind === 'mt' ? ['-threads', String(n)] : []);            // decoder threads, goes before an -i
// decoder threads for the main video: reading (decoding) a 1080p / 60 fps source is the slowest part once 720p and
// 30 fps shrink the encode; 4 threads decode ~30% faster than 2. Phones with fewer cores stay at 2.
const mainDec = () => ((navigator.hardwareConcurrency || 4) >= 6 ? 4 : 2);
const mtEnc = () => (ffKind === 'mt' ? ['-threads', '4'] : []);                 // x264 encoder threads

// is the engine the user currently wants already downloaded?
export async function ffmpegCached() {
  try {
    const core = CORES[mtFailed ? 'st' : wantKind()];
    const c = await caches.open(core.cache);
    const r = await Promise.all(core.files.map(f => c.match(`${core.base}/${f.name}`)));
    return r.every(Boolean);
  } catch { return false; }
}

export async function ffmpegClear() {
  for (const k in CORES) { try { await caches.delete(CORES[k].cache); } catch {} }
  if (ff) { try { ff.terminate(); } catch {} }   // free the old wasm worker's memory
  ff = null; ffKind = null; mtFailed = false;
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
  const code = await ffRun(f, ['-i', inName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'a.wav']);
  if (code !== 0) throw new Error('Video ထဲက အသံကို ထုတ်မရပါ');
  const data = await f.readFile('a.wav');
  await f.deleteFile('a.wav');
  return new Blob([data.slice().buffer], { type: 'audio/wav' });
}

/* ---------- TikTok link -> video file (through the worker) ---------- */
const DL_ERR = {
  not_tiktok: 'TikTok link မဟုတ်ပါ — tiktok.com link ကို ထည့်ပါ',
  not_found: 'Video ကို ရှာမတွေ့ပါ — link မှန်လား၊ Private / ဖျက်ထားတဲ့ video လား စစ်ပါ',
  too_big: 'Video အရမ်းကြီးလွန်းပါတယ် (300MB ထက်ကျော်)',
  download_failed: 'Video ဒေါင်းမရပါ — ခဏနေ ပြန်ကြိုးစားပါ'
};
// pulls the first http(s) link out of whatever was pasted (TikTok's share text has words around it)
export const findLink = t => ((String(t || '').match(/https?:\/\/[^\s"'<>]+/i) || [])[0] || '').replace(/[)\].,!?]+$/, '');
export const isTikTok = u => { try { return /(^|\.)tiktok\.com$/i.test(new URL(u).hostname); } catch { return false; } };

// streams a video response into a File, reporting progress
async function readVideo(r, link, onProg) {
  const total = +r.headers.get('content-length') || 0;
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onProg && onProg(total ? got / total : 0, got);
  }
  if (got < 1000) throw new Error('Video ဒေါင်းမရပါ — ခဏနေ ပြန်ကြိုးစားပါ');
  const id = (link.match(/video\/(\d+)/) || link.match(/\/([A-Za-z0-9]{5,})\/?(?:\?|$)/) || [])[1] || Date.now();
  let title = '';
  try { title = decodeURIComponent(r.headers.get('x-video-title') || ''); } catch {}
  return { file: new File(parts, `tiktok_${id}.mp4`, { type: 'video/mp4' }), title, duration: +r.headers.get('x-video-duration') || 0 };
}

// backup: the phone asks tikwm itself (the phone's own daily limit, not the Worker's shared one),
// then the Worker downloads that file address for us (/dl/file only accepts TikTok / tikwm hosts)
async function viaPhoneTikwm(link, onProg) {
  let j;
  try { j = await (await fetch('https://www.tikwm.com/api/?hd=1&url=' + encodeURIComponent(link))).json(); }
  catch { throw new Error('phone tikwm: blocked'); }
  if (!j || j.code !== 0 || !j.data) throw new Error('phone tikwm: ' + String((j && j.msg) || 'no data'));
  const abs = u => (!u ? '' : /^https?:/i.test(u) ? u : 'https://www.tikwm.com' + (u.startsWith('/') ? '' : '/') + u);
  let last = '';
  for (const u of [abs(j.data.hdplay), abs(j.data.play)].filter(Boolean)) {
    const r = await fetch(`${cfg.workerUrl}/dl/file?u=${encodeURIComponent(u)}`);
    if (r.ok) {
      const out = await readVideo(r, link, onProg);
      out.title = out.title || String(j.data.title || ''); out.duration = out.duration || +j.data.duration || 0;
      return out;
    }
    last = 'file ' + r.status;
  }
  throw new Error('phone tikwm: ' + last);
}

export async function loadTikTok(link, onProg) {
  let r;
  try { r = await fetch(`${cfg.workerUrl}/dl/tiktok?url=${encodeURIComponent(link)}`); }
  catch { throw new Error('Server နဲ့ ချိတ်ဆက်မရပါ — Wi-Fi / Internet စစ်ပါ၊ VPN ချိတ်ထားရင် ဖြုတ်ပါ'); }
  if (r.ok) return readVideo(r, link, onProg);
  let e = null; try { e = await r.clone().json(); } catch {}
  if (e && e.error === 'not_found') {
    try { return await viaPhoneTikwm(link, onProg); }                 // last try before giving up
    catch (pe) { e.detail = [e.detail, String(pe.message || pe)].filter(Boolean).join(' | '); }
  }
  if (e && DL_ERR[e.error]) {
    const err = new Error(DL_ERR[e.error]);
    err.detail = e.detail || '';                   // what the download services said (shown small, for troubleshooting)
    throw err;
  }
  if (r.status === 404) throw new Error('Worker မှာ TikTok download မပါသေးပါ — Worker ကို update လုပ်ပါ');
  throw new Error(`Video ဒေါင်းမရပါ (${r.status}) — ခဏနေ ပြန်ကြိုးစားပါ`);
}

/* ---------- AssemblyAI (through the worker) ---------- */
async function aai(path, opts = {}) {
  // Premium: the Worker uses the owner's AssemblyAI key, so the user needs none
  if (premium.on) {
    // the Worker charges by length: 16 kHz mono 16-bit WAV is 32000 bytes a second (it also reads content-length)
    if (opts.body instanceof Blob) opts = { ...opts, headers: { ...(opts.headers || {}), 'x-secs': String(Math.max(0, (opts.body.size - 44) / 32000)) } };
    const r = await premiumFetch('/premium/aai' + path, opts);
    if (!r.ok) {
      const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
      if (j.error === 'no_credit' && j.need) throw new Error(`💎 ဒီ Video အတွက် Credit ${j.need.toLocaleString()} လိုပါတယ် (ကျန် ${(j.credits || 0).toLocaleString()}) — Admin ဆီက ထပ်ဖြည့်ပါ`);
      throw new Error(PREMIUM_ERR[j.error] || `Server ${r.status}: ${t}`);
    }
    return r.json();
  }
  if (!cfg.workerUrl || !cfg.aaiKey) throw new Error('API Key Settings ထဲမှာ AssemblyAI key ကို အရင်ထည့်ပါ');
  const r = await fetch(`${cfg.workerUrl}/aai${path}`, {
    ...opts,
    headers: { authorization: cfg.aaiKey, ...(opts.headers || {}) }
  });
  if (!r.ok) throw new Error(`Server ${r.status}: ${await r.text()}`);
  return r.json();
}

// no lookbehind: older iOS Safari (< 16.4) can't parse it and the whole app would fail to load
const tidy = t => t.replace(/([\u3000-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u9fff\uff00-\uffef])/g, '$1').trim();

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

// fingerprint of the audio itself (size alone is the same for any two videos of equal length)
// (plain JS, so it also works on http:// where crypto.subtle is missing)
async function audioId(blob) {
  try {
    const u = new Uint8Array(await blob.arrayBuffer());
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 16777619); h2 = Math.imul(h2 ^ u[i], 2246822519); }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  } catch { return null; }
}
const TX_MAX = 15;
function txSave(key, segs) {
  let keys = [];
  try { keys = JSON.parse(localStorage.getItem('txKeys') || '[]'); } catch {}
  // drop old-format entries (tx:<lang>:<size>) and the oldest ones beyond TX_MAX
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (/^tx:[^:]+:\d+$/.test(k)) localStorage.removeItem(k);
  }
  keys = keys.filter(k => k !== key);
  keys.push(key);
  while (keys.length > TX_MAX) localStorage.removeItem(keys.shift());
  for (;;) {
    try { localStorage.setItem(key, JSON.stringify(segs)); break; }
    catch { if (keys.length <= 1) return; localStorage.removeItem(keys.shift()); }   // storage full -> drop oldest
  }
  try { localStorage.setItem('txKeys', JSON.stringify(keys)); } catch {}
}

export async function transcribe(blob, lang, onStatus) {
  // same audio + same language -> reuse the earlier result (no new AssemblyAI call)
  const id = await audioId(blob);
  const key = id ? `tx:${lang}:${blob.size}:${id}` : null;
  if (key) try {
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
    if (s.status === 'error') throw new Error('Server: ' + s.error);
    onStatus(s.status);
  }

  const full = await aai('/v2/transcript/' + t.id);
  let segs = segmentWords(full.words || []);
  if (!segs.length) {
    const sent = await aai(`/v2/transcript/${t.id}/sentences`);
    segs = (sent.sentences || []).map(s => ({ start: s.start / 1000, end: s.end / 1000, text: tidy(s.text) })).filter(s => s.text);
  }
  if (!segs.length) throw new Error('စကားပြောသံ မတွေ့ပါ');
  if (key) { try { txSave(key, segs); } catch {} }
  return segs;
}

/* ---------- Gemini prompt (same format as the original app) ---------- */
export function buildPrompt(segs, style = 'recap') {
  const lines = segs.map((s, i) => {
    const slot = (i + 1 < segs.length ? segs[i + 1].start : s.end) - s.start;
    return `ID: ${i} | Duration: ${Math.max(slot, s.end - s.start).toFixed(1)}s | Text: "${s.text}"`;
  }).join('\n');
  const head = style === 'chat' ? `You are a professional video dubbing translator. You MUST translate the following subtitles into natural spoken Burmese (Myanmar script ONLY, NO English, NO phonetic guides).
STYLE: Write in casual COLLOQUIAL spoken Burmese (အပြောစကား), the way a friend retells a movie story out loud. NEVER use formal literary/written Burmese (စာရေးစကား). Do not use written endings or particles such as သည်၊ ၏၊ ၌၊ မည်၊ ၍၊ သို့၊ နှင့်၊ ထို၊ ၎င်း. Use spoken forms instead: တယ်၊ ပါတယ်၊ မယ်၊ ရဲ့၊ မှာ၊ ကို၊ နဲ့၊ အဲဒီ၊ သူ၊ ပြီးတော့. Keep sentences short and lively, like speech, not like a newspaper or a textbook.
Examples (written -> spoken):
သူသည် အိမ်သို့ ပြန်သွားသည်။ -> သူ အိမ်ကို ပြန်သွားတယ်။
ထိုအခါ သူမသည် ငိုကြွေးခဲ့၏။ -> အဲဒီအခါ သူမ ငိုချလိုက်တယ်။
` : `You are a high-energy TikTok movie recap narrator. Translate the following subtitles into 100% natural spoken Burmese (Myanmar script ONLY, NO English, NO phonetic guides).
STYLE: Write in casual COLLOQUIAL spoken Burmese (အပြောစကား), like an exciting, fast-paced story told to a friend. NEVER use formal literary/written Burmese (စာရေးစကား). Strictly avoid written endings and particles such as သည်၊ ၏၊ ၌၊ မည်၊ ၍၊ သို့၊ နှင့်၊ ထို၊ ၎င်း၊ သော. Use spoken forms: တယ်၊ ပါတယ်၊ မယ်၊ တာ၊ ပေါ့၊ လေ၊ ဗျာ၊ ရဲ့၊ မှာ၊ ကို၊ နဲ့၊ အဲဒီ၊ သူ၊ ပြီးတော့. Keep the tone thrilling and punchy.
Examples (written -> spoken):
သူသည် အိမ်သို့ ပြန်သွားသည်။ -> သူ အိမ်ကို ပြန်သွားတယ်။
ထိုအခါ သူမသည် ငိုကြွေးခဲ့၏။ -> အဲဒီအခါ သူမ ငိုချလိုက်တယ်။
DIALOGUE: Do NOT write dialogue as direct quotes. Turn what characters say into indirect speech inside the narration (for example: သူက စိတ်ဆိုးပြီး သူ့ကို လုပ်မယ်လို့ ပြောလိုက်တယ်). Do not use quotation marks inside the translations.
TTS: Keep every line short and punchy. Use commas ( , ) only for natural breathing pauses.
SAFE WORDS (TikTok safety), replace restricted words automatically: alcohol/beer/liquor -> အထူးဖျော်ရည်; cigarettes/smoking -> မီးခိုးတံ; drugs/pills/injections -> ပစ္စည်း or အားဆေး; violence/kill/death/blood -> ရှင်းထုတ်လိုက်တယ် / အနားယူသွားတယ် / အနီရောင်အမှတ်တွေ; swear words -> safe intense expressions such as ဟာကွာ၊ တောက်.
`;
  return `${head}Translate each line so that it sounds natural in a movie recap narration. Do not translate word-for-word.
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
Lines marked LONG cannot be spoken within their Duration. Rewrite ONLY those lines so they are shorter by the percentage given: condense the meaning, drop minor details, and keep casual colloquial spoken Burmese (အပြောစကား, never formal written Burmese; Myanmar script ONLY, NO English). Keep every other line exactly unchanged.
Return the FULL result STRICTLY as a JSON object with a single key "translations" containing an array of exactly ${segs.length} strings in order.
Inputs:
${lines}`;
}

/* ---------- Recap Script mode (free-form script instead of line-by-line JSON) ---------- */
export function buildRecapPrompt(segs) {
  const source = segs.map(s => s.text).join('\n');
  return `### ROLE & OBJECTIVE:
You are a professional "Movie Recap Scriptwriter" for a popular Burmese Facebook/YouTube/TikTok channel. Your task is to rewrite a given detailed scene-by-scene action into a highly descriptive, engaging, and beautifully paced video script in Burmese that matches a longer video duration. 

### TONE & STYLE:
- Genre: Movie Recap / Storytelling.
- Language: Burmese (Colloquial/Spoken style - အပြောစကား သက်သက်ဖြစ်ရမည်). Strictly Do NOT use formal/literary Burmese (စာရေးစကား လုံးဝမသုံးရ).
- Vibe: Epic, deeply descriptive, slightly humorous, badass (အထာကျကျ), and engaging.
- Pacing: Medium-Fast but HIGHLY DESCRIPTIVE. Do not skip details. 

### WRITING RULES (STRICTLY FOLLOW):
1. Elongation Technique for TTS Timing: 
   - Expand on actions using vivid descriptions (e.g., describe the environment, the creepy sounds, the glowing lights).
   - Use dynamic sound-effect words in Burmese (e.g., ဝုန်းဆိုပြီး၊ ဒိုင်းဆိုပြီး၊ ဖြောင်းဆိုပြီး၊ ရှူးဆိုပြီး).
   - Describe character emotions and reactions vividly (e.g., ကြောက်လန့်တကြားနဲ့၊ မျက်လုံးပြူးသွားပြီး၊ အထာကျကျ ပြုံးလိုက်ရင်း).
2. Dialogue Handling: Keep the provided badass dialogues intact but add conversational flavor before and after them to pad the timing naturally.
3. Grammar & Flow (NO ELLIPSES): Use natural storytelling endings (..တယ်၊ ..မယ်၊ ..သွားတယ်၊ ..လေရဲ့၊ ..ရော၊ ..ပေါ့၊ ..ပါလေရော). Avoid listing or bullet points. STRICTLY DO NOT USE ellipses (\`...\`) for pauses; use a single space instead.
4. Exact Sequential Order: Follow the exact sequence and flow of the provided input text. Do not rearrange the chronological order of the events or skip any parts. (စာစီပေးထားတဲ့ အစီအစဉ်အတိုင်း တိတိကျကျ ရေးသားရန်)
5. Ban Sense (Platform Safety): Avoid direct words for gore, violence, or extreme brutality to prevent TikTok/YouTube bans. Use terms like "အပြတ်ရှင်းတယ်", "ကြွေမွသွားတယ်", "လွင့်စင်သွားတယ်".
6. Standard Outro & No Moral Fluff: Do not add moral lessons. Smoothly end the story with an engaging cliffhanger (e.g., "နောက်ထပ် ဘာတွေဆက်ဖြစ်မလဲ [summarize the suspense]"). Finally, ALWAYS end the script with the exact phrase: "အကောင့်လေးကိုလဲ ဖေါလိုးလုပ်ပေးခဲ့ကြပါဗျာ။"
7. Strict Output Format: Output ONLY the core script inside a single \`code block\`. STRICTLY DO NOT include any scene headers, scene numbers, or descriptions in brackets (e.g., [ဇာတ်ဝင်ခန်း - ၁]). DO NOT include any AI conversational filler before or after the code block.
8. Video-Driven Accuracy (Strict Observation): You MUST first carefully watch and analyze the provided video. When rewriting and expanding the script, your descriptions must accurately reflect the EXACT movements, environments, and character expressions seen in the video. STRICTLY DO NOT invent, hallucinate, or add any actions, objects, or events that do not physically happen in the video footage. Your final output must meticulously combine the provided text with the exact visual actions from the video without fabricating extra details.

### INPUT STORY / VIDEO DETAILS:
${source}`;
}

// split a free-form Burmese script into sentences (for TTS lines)
export function parseScript(raw) {
  const s = String(raw || '').replace(/```[a-z]*/gi, '').trim();
  if (!s) throw new Error('Script စာသား မတွေ့ပါ');
  const parts = s.replace(/။/g, '။\n').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < 14) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  if (!out.length) throw new Error('Script စာသား မတွေ့ပါ');
  return out;
}

// spread script sentences over the original speech timeline, proportional to length
export function layoutScript(sentences, orig) {
  const t0 = orig[0].start, t1 = orig[orig.length - 1].end;
  const D = Math.max(t1 - t0, sentences.length * 1.5);
  const w = sentences.map(x => Math.max(x.length, 4));
  const W = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return sentences.map((text, i) => {
    const start = t0 + (D * acc) / W; acc += w[i];
    const end = t0 + (D * acc) / W;
    return { start, end, text };
  });
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

/* ---------- cut a finished video (start / end) without re-encoding ---------- */
// Stream copy: takes seconds and keeps the quality. The end is cut exactly; a cut at the start can land up
// to a key frame earlier (about 1-2 s), because a copied video must begin on a key frame.
export async function cutVideo(file, start, end, onProgress) {
  const f = await getFFmpeg();
  const ext = ((file.name || '').match(/\.([a-z0-9]{2,4})$/i) || [, 'mp4'])[1].toLowerCase();
  const inName = 'cut_in.' + ext;
  const keep = Math.max(0.5, end - start);
  setFFProgress(p => onProgress && onProgress(p));
  try {
    await f.writeFile(inName, await fetchFile(file));
    const tries = [['mp4', ['-movflags', '+faststart']], [ext === 'mp4' ? 'mkv' : ext, []]];
    for (const [oext, extra] of tries) {
      const out = 'cut_out.' + oext;
      const args = [...(start > 0 ? ['-ss', start.toFixed(2)] : []), '-i', inName, '-t', keep.toFixed(2),
        '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...extra, out];
      const code = await ffRun(f, args);
      if (code === 0) {
        const d = await f.readFile(out);
        try { await f.deleteFile(out); } catch {}
        return { blob: new Blob([d.slice().buffer], { type: oext === 'mp4' ? 'video/mp4' : 'video/x-matroska' }), ext: oext };
      }
      try { await f.deleteFile(out); } catch {}
    }
    throw new Error('Video ဖြတ်လို့ မရပါ (ဒီဖိုင်အမျိုးအစားကို မဖြတ်နိုင်ပါ)');
  } finally {
    setFFProgress(null);
    try { await f.deleteFile(inName); } catch {}
  }
}

/* ---------- TTS ---------- */
// Microsoft often returns *no audio* to datacenter addresses (like the Worker's Cloudflare IP).
// So the phone first talks to Edge TTS itself, using a signed address the Worker hands out
// (the Worker keeps the token); if that path fails, the old Worker /tts route is used.
export const ttsInfo = { direct: 'unknown', last: '' };  // direct: 'unknown' | 'ok' | 'bad'
let ttsUrlP = null, ttsUrlAt = 0;
function ttsUrl() {
  if (!ttsUrlP || Date.now() - ttsUrlAt > 120000) {
    ttsUrlAt = Date.now();
    ttsUrlP = fetch(cfg.workerUrl + '/tts-url', { headers: ticket ? { 'x-ticket': ticket } : {} }).then(async r => {
      if (!r.ok) { const e = new Error('tts-url ' + r.status); e.noTicket = r.status === 401; throw e; }
      const j = await r.json();
      const urls = Array.isArray(j.urls) && j.urls.length ? j.urls : j.url ? [j.url] : [];
      if (!urls.length) throw new Error('tts-url empty');
      return urls;
    }).catch(e => { ttsUrlP = null; throw e; });
  }
  return ttsUrlP;
}
const xesc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const sgn = n => (n >= 0 ? '+' : '') + Math.round(n);
const rid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

let ttsGoodUrl = 0;   // which Edge TTS address worked last
async function ttsDirect(text, voice, pitch, rate) {
  let urls;
  try { urls = await ttsUrl(); } catch (e) { e.connect = !e.noTicket; throw e; }  // old Worker without /tts-url (no ticket: just skip this time)
  const order = [ttsGoodUrl, ...urls.keys()].filter((v, i, a) => a.indexOf(v) === i && v < urls.length);
  let last;
  for (const k of order) {
    try { const ab = await ttsSocket(urls[k], text, voice, pitch, rate); ttsGoodUrl = k; return ab; }
    catch (e) { last = e; if (!e.connect) throw e; }   // connected but no audio: another address will not help
  }
  throw last;
}

function ttsSocket(base, text, voice, pitch, rate) {
  const id = rid();
  return new Promise((resolve, reject) => {
    let ws, got = false, done = false;
    const chunks = [];
    const end = err => {
      if (done) return; done = true; clearTimeout(timer);
      try { ws.close(); } catch {}
      const bytes = chunks.reduce((n, c) => n + c.byteLength, 0);
      if (!err && bytes >= 200) return resolve(new Blob(chunks).arrayBuffer());
      const e = new Error(err || `phone TTS: audio ${bytes} bytes`); e.connect = !got; reject(e);
    };
    const timer = setTimeout(() => end('phone TTS timed out'), 20000);
    try { ws = new WebSocket(base + '&ConnectionId=' + id); } catch (e) { return end('phone TTS: ' + e.message); }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const ts = new Date().toString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='my-MM'><voice name='${voice}'><prosody pitch='${sgn(pitch)}Hz' rate='${sgn(rate)}%' volume='+0%'>${xesc(text)}</prosody></voice></speak>`);
    };
    ws.onmessage = ev => {
      got = true;
      const d = ev.data;
      if (typeof d === 'string') { if (d.includes('Path:turn.end')) end(); return; }
      if (!(d instanceof ArrayBuffer) || d.byteLength < 2) return;
      const hl = new DataView(d).getUint16(0);
      const head = new TextDecoder().decode(d.slice(2, 2 + hl));
      if (head.includes('Path:audio')) chunks.push(d.slice(2 + hl));
    };
    ws.onerror = () => end('phone TTS: connection refused');
    ws.onclose = () => end(got ? null : 'phone TTS: connection closed');
  });
}

async function ttsWorker(text, voice, pitch, rate) {
  const r = await fetch(cfg.workerUrl + '/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ticket ? { 'x-ticket': ticket } : {}) },
    body: JSON.stringify({ text, voice, pitch, rate })
  });
  if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
  const ab = await r.arrayBuffer();
  if (ab.byteLength < 200) throw new Error(`TTS audio မရပါ (${ab.byteLength} bytes)`);
  return ab;
}

// characters that make Microsoft finish the request without speaking: control / zero-width chars, lone surrogates
export const ttsClean = t => String(t || '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF0-\uFFFF]/g, ' ')
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ')
  .replace(/\s+/g, ' ').trim();
export const speakable = t => /[\p{L}\p{N}]/u.test(ttsClean(t));
const isNoAudio = e => /No audio|audio 0|audio မရ|audio \d+ bytes/i.test(String(e && e.message));

export async function tts(text, persona, pitchOffset = 0, rateOffset = 0, tries = 6, onRetry = null) {
  text = ttsClean(text);
  const voice = persona.voice, pitch = persona.pitch + pitchOffset;
  const rate = Math.max(-50, Math.min(100, persona.rate + rateOffset));
  let last, noAudio = 0;
  for (let k = 0; k < tries; k++) {
    let phoneErr = null;
    if (ttsInfo.direct !== 'bad') {
      try {
        const ab = await ttsDirect(text, voice, pitch, rate);
        ttsInfo.direct = 'ok'; ttsInfo.last = 'phone';
        return ab;
      } catch (e) {
        phoneErr = e;
        // the phone could not even connect (browser / network blocks it): use the Worker from now on
        if (e.connect && ttsInfo.direct === 'unknown') ttsInfo.direct = 'bad';
      }
    }
    try {
      const ab = await ttsWorker(text, voice, pitch, rate);
      ttsInfo.last = 'worker';
      return ab;
    } catch (e) {
      last = phoneErr ? new Error(phoneErr.message + ' · ' + e.message) : e;
      if (isNoAudio(e) && ++noAudio >= 3) break;     // Microsoft keeps refusing this text: let the caller try it in pieces
      if (onRetry) onRetry(last);
      await sleep(Math.min(5000, 700 * (k + 1) ** 1.5));
    }
  }
  throw last;
}

// clips already made in this session: re-rendering with the same text / voice / pitch / speed skips the network
const TTS_MAX = 1500;
const ttsMemo = new Map();
async function ttsCached(text, persona, pitch, rate, onRetry, tries = 6) {
  const key = [persona.voice, persona.pitch + pitch, Math.max(-50, Math.min(100, persona.rate + rate)), text].join('|');
  const hit = ttsMemo.get(key);
  if (hit) return hit.slice(0);                    // always hand out a copy: ffmpeg.writeFile transfers (empties) the buffer
  const ab = await tts(text, persona, pitch, rate, tries, onRetry);
  ttsMemo.set(key, ab.slice(0));
  if (ttsMemo.size > TTS_MAX) ttsMemo.delete(ttsMemo.keys().next().value);
  return ab;
}

// last resort for a line Microsoft will not speak: say it in smaller pieces and join the mp3 data
async function ttsPieces(text, persona, pitch, rate) {
  const parts = ttsClean(text).split(/(?<=[။၊,.!?;:])\s*|\s+(?=\S{2,})/).filter(speakable);
  const pieces = [], cap = Math.min(60, Math.ceil(ttsClean(text).length / 2));   // always really smaller than the line
  for (const p of parts) {
    const last = pieces[pieces.length - 1];
    if (last && (last + ' ' + p).length <= cap) pieces[pieces.length - 1] = last + ' ' + p; else pieces.push(p);
  }
  if (pieces.length < 2) throw new Error('no smaller pieces');
  const out = [];
  for (const p of pieces) {
    try { out.push(new Uint8Array(await ttsCached(p, persona, pitch, rate, null, 3))); } catch (e) { if (!isNoAudio(e)) throw e; }
  }
  if (!out.length) throw new Error('No audio for any piece');
  const all = new Uint8Array(out.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of out) { all.set(a, o); o += a.length; }
  return all.buffer;
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

/* ---- output geometry: aspect ratio (crop / blurred padding), zoom ---- */
const even = n => Math.max(2, Math.round(n / 2) * 2);
const RATIOS = { '9:16': 9 / 16, '3:4': 3 / 4, '16:9': 16 / 9, '1:1': 1 };
export function outGeometry(sz, fx) {
  const W = even(sz.w), H = even(sz.h);
  const r = fx && RATIOS[fx.ratio];
  if (!r) {
    // "fast" option: shrink a large original-ratio video to 720p — at most 720 on the short side and 1280 on the
    // long side (1920x1080 -> 1280x720, 1080x1080 -> 720x720, 1080x1920 -> 720x1280)
    const k = fx && fx.fast ? Math.min(1, 1280 / Math.max(W, H), 720 / Math.min(W, H)) : 1;
    if (k < 1) return { W, H, OW: even(W * k), OH: even(H * k), ratio: false, scaled: true };
    return { W, H, OW: W, OH: H, ratio: false };
  }
  const long = Math.min(Math.max(W, H), 1280);
  const OW = r <= 1 ? even(long * r) : even(long), OH = r <= 1 ? even(long) : even(long / r);
  return { W, H, OW, OH, ratio: true };
}

/* ---- video filter graph: ratio -> mirror -> zoom -> blurred band -> burned-in subtitles -> watermark/logo ---- */
// Scaling uses fast_bilinear (bilinear for the zoom-in): ffmpeg's default bicubic is so slow in WebAssembly that
// shrinking to 720p made the multi-core encode slower than not shrinking at all.
// subs: {y} (input 2 = png sequence); g: geometry from outGeometry(); ovl: input index of the watermark/logo png (0 = none)
function buildFx(fx, subs, g, ovl = 0) {
  const mirror = !!(fx && fx.mirror), blur = !!(fx && fx.blur);
  const zoom = Math.max(1, Math.min(3, (+(fx && fx.zoom) || 100) / 100));
  const geo = !!(g && g.ratio), doZoom = zoom > 1.001 && g;
  if (!mirror && !blur && !subs && !geo && !doZoom && !ovl) return '';   // nothing to re-encode: keep the fast stream copy
  const gr = [];
  let cur = '[0:v]', n = 0;
  const lbl = () => `[t${n++}]`;
  if (fx && fx.cap30) { const o = lbl(); gr.push(`${cur}fps=30${o}`); cur = o; }        // 60 fps source -> 30 fps (half the frames to encode)
  if (!geo && g && g.scaled) { const o = lbl(); gr.push(`${cur}scale=${g.OW}:${g.OH}:flags=fast_bilinear${o}`); cur = o; }
  if (geo) {
    const o = lbl();
    if (fx.fit === 'pad') {
      gr.push(`${cur}split[p1][p2]`);
      gr.push(`[p1]scale=${g.OW}:${g.OH}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${g.OW}:${g.OH},scale=${even(g.OW / 6)}:${even(g.OH / 6)}:flags=fast_bilinear,gblur=sigma=6:steps=2,scale=${g.OW}:${g.OH}:flags=fast_bilinear[pbg]`);
      gr.push(`[p2]scale=${g.OW}:${g.OH}:force_original_aspect_ratio=decrease:flags=fast_bilinear[pfg]`);
      gr.push(`[pbg][pfg]overlay=x=(W-w)/2:y=(H-h)/2${o}`);
    } else {
      gr.push(`${cur}scale=${g.OW}:${g.OH}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${g.OW}:${g.OH}${o}`);
    }
    cur = o;
  }
  if (mirror) { const o = lbl(); gr.push(`${cur}hflip${o}`); cur = o; }
  if (doZoom) {
    const o = lbl();
    gr.push(`${cur}crop=${even(g.OW / zoom)}:${even(g.OH / zoom)},scale=${g.OW}:${g.OH}:flags=bilinear${o}`);
    cur = o;
  }
  if (blur) {
    const h = (Math.max(3, Math.min(60, +fx.blurH || 15)) / 100).toFixed(3);   // band height, fraction of video height
    const p = (Math.max(0, Math.min(100, +fx.blurY)) / 100).toFixed(3);        // 0 = top, 1 = bottom
    const o = lbl();
    gr.push(`${cur}split[s1][s2]`);
    const sig = Math.max(2, Math.min(40, ((+fx.blurS || 50) / 100) * 40)).toFixed(1);   // blur strength (sigma)
    const op = Math.max(0.2, Math.min(1, (+fx.blurO || 100) / 100));                    // how solid the blurred band is
    const alpha = op < 0.99 ? `,format=yuva420p,colorchannelmixer=aa=${op.toFixed(2)}` : '';
    gr.push(`[s2]crop=w=iw:h=trunc(ih*${h}/2)*2:x=0:y=trunc((ih-oh)*${p}/2)*2,gblur=sigma=${sig}:steps=2${alpha}[bl]`);
    gr.push(`[s1][bl]overlay=x=0:y=trunc((H-h)*${p}/2)*2${o}`);
    cur = o;
  }
  if (subs) { const o = lbl(); gr.push(`${cur}[2:v]overlay=x=0:y=${subs.y}:shortest=1${o}`); cur = o; }
  if (ovl) { const o = lbl(); gr.push(`${cur}[${ovl}:v]overlay=x=0:y=0${o}`); cur = o; }
  gr.push(`${cur}format=yuv420p[v]`);
  return gr.join(';');
}

/* ---- subtitle font (kept in Cache Storage after the first time) ---- */
const FONT_CACHE = 'subfont-v1', FONT_KEY = '/recap-sub-font', FONT_NAME = 'RecapSubFont';
const SYS_FONTS = `'Noto Sans Myanmar','Padauk','Myanmar Text','Pyidaungsu',sans-serif`;
const FONT_URLS = [
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-myanmar@latest/myanmar-700-normal.woff2',
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-myanmar@latest/myanmar-400-normal.woff2'
];
let curFace = null, fontLoaded = false;
// fonts bundled with the app: pick either one from the Font dropdown (no upload needed)
const BUILTIN = {
  pt16: { label: 'PT16 Burmese Bold', family: 'RecapPT16', data: PT16_B64 },
  akk: { label: 'အက္ခရာ ရိုဘို (Akkhayar Robo)', family: 'RecapAkkhayar', data: AKK_B64 }
};
export const BUILTIN_FONTS = Object.entries(BUILTIN).map(([id, b]) => ({ id, label: b.label }));
const bLoad = {};
const b64ToBuf = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
function loadBuiltinFont(id) {
  const b = BUILTIN[id];
  if (!b) return Promise.resolve(true);
  if (!bLoad[id]) {
    bLoad[id] = (async () => {
      const ab = b64ToBuf(b.data);
      const face = new FontFace(b.family, ab);   // same path as the working custom font
      await face.load();
      document.fonts.add(face);
      if (!document.fonts.check(`700 32px '${b.family}'`, 'မြန်မာ')) throw new Error('Font အသုံးမပြုနိုင်ပါ');
      return true;
    })().catch(e => { delete bLoad[id]; throw e; });
  }
  return bLoad[id];
}
// sel: 'system' | 'pt16' | 'akk' | 'custom'
export const subFontFamily = sel =>
  (sel === 'custom' ? `'${FONT_NAME}',` : BUILTIN[sel] ? `'${BUILTIN[sel].family}',` : '') + SYS_FONTS;
export async function ensureSubFont(sel) {
  if (sel === 'custom') return loadSubFont();
  if (BUILTIN[sel]) return loadBuiltinFont(sel);
  return true;
}

async function installFont(ab) {
  const face = new FontFace(FONT_NAME, ab);
  await face.load();                       // throws if the file is not a valid font
  if (curFace) { try { document.fonts.delete(curFace); } catch {} }
  document.fonts.add(face);
  curFace = face; fontLoaded = true;
}
export async function loadSubFont() {
  if (fontLoaded) return true;
  try {
    const c = await caches.open(FONT_CACHE);
    const r = await c.match(FONT_KEY);
    if (!r) return false;
    await installFont(await r.arrayBuffer());
    return true;
  } catch { return false; }
}
export async function saveSubFont(blob) {
  const ab = await blob.arrayBuffer();
  await installFont(ab);
  try { const c = await caches.open(FONT_CACHE); await c.put(FONT_KEY, new Response(new Blob([ab]))); } catch {}
}
export async function downloadDefaultFont() {
  for (const u of FONT_URLS) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await saveSubFont(await r.blob());
      return;
    } catch {}
  }
  throw new Error('Font ဒေါင်းလုဒ် မရပါ — Font ဖိုင်ကို ကိုယ်တိုင် တင်ပါ');
}

function videoSize(file) {
  return new Promise(res => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { res({ w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(url); };
    v.onerror = () => { res(null); URL.revokeObjectURL(url); };
    setTimeout(() => res(null), 6000);
    v.src = url;
  });
}

// word-wrap Burmese text (no spaces) with Intl.Segmenter when the browser has it
function wrapLines(ctx, text, maxW) {
  let units;
  try { units = [...new Intl.Segmenter('my', { granularity: 'word' }).segment(text)].map(s => s.segment); }
  catch { units = [...text]; }
  const lines = [];
  let cur = '';
  for (const u of units) {
    const t = cur + u;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur.trim()); cur = u.replace(/^\s+/, ''); }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

// draws every subtitle line as a transparent PNG strip and lists them (with timings) for ffmpeg's concat demuxer
async function makeSubTrack(f, { file, videoDur, burmese, placed, fx }) {
  const sz = fx.geo ? { w: fx.geo.OW, h: fx.geo.OH } : await videoSize(file);     // subtitles are drawn on the OUTPUT frame size
  if (!sz || !sz.w || !sz.h) throw new Error('video size');
  const { w: W, h: H } = sz;
  const s = fx.subs;
  const family = subFontFamily(s.font);
  let fontFailed = false;
  try { await ensureSubFont(s.font); } catch { fontFailed = true; }
  const px = Math.max(12, Math.round(H * (s.size / 100)));
  let font = `700 ${px}px ${family}`;
  try { await document.fonts.load(font, 'မြန်မာ'); } catch {}
  // safety: make sure the chosen font really paints on a canvas; otherwise use the phone font
  const inked = fnt => {
    try {
      const c = document.createElement('canvas'); c.width = 400; c.height = 120;
      const x = c.getContext('2d'); x.font = fnt; x.textBaseline = 'middle'; x.fillStyle = '#000';
      x.fillText('မြန်မာစာ', 10, 60);
      const d = x.getImageData(0, 0, 400, 120).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true;
    } catch {}
    return false;
  };
  if (BUILTIN[s.font] || s.font === 'custom') {
    const t = `700 60px ${family}`;
    if (!inked(t)) await new Promise(r => setTimeout(r, 300));
    if (!inked(t)) { font = `700 ${px}px ${SYS_FONTS}`; fontFailed = true; }
  }
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = font;
  const maxW = W * 0.92;

  const items = [];
  placed.forEach((p, i) => { if (p && burmese[i]) items.push({ i, p, text: burmese[i] }); });
  if (!items.length) throw new Error('no lines');
  items.forEach((it, k) => {
    it.lines = wrapLines(ctx, it.text, maxW);
    const next = items[k + 1];
    it.start = it.p.start;
    it.end = Math.min(it.p.end + 0.15, next ? next.p.start : Infinity);
  });
  const maxL = Math.min(4, Math.max(1, ...items.map(x => x.lines.length)));
  const lh = Math.round(px * 1.35);
  const bandH = Math.ceil(lh * maxL + px * 0.5);

  // vertical centre: middle of the blur band if blur is on, otherwise the chosen position
  let cy;
  if (fx.blur) { const bh = (H * fx.blurH) / 100; cy = (fx.blurY / 100) * (H - bh) + bh / 2; }
  else cy = (s.y / 100) * H;
  const y = Math.round(Math.max(0, Math.min(H - bandH, cy - bandH / 2)));

  cv.width = W; cv.height = bandH;
  const names = [];
  // each line gets its own canvas so the PNG encodes (the slow part on phones) can run 4 at a time
  const draw = async (name, lines) => {
    const c = document.createElement('canvas'); c.width = W; c.height = bandH;
    const x = c.getContext('2d');
    if (lines) {
      x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      x.lineWidth = Math.max(2, px * 0.16); x.strokeStyle = s.outline; x.fillStyle = s.color;
      const L = lines.slice(0, maxL);
      const top = (bandH - L.length * lh) / 2 + lh / 2;
      L.forEach((t, j) => { const yy = top + j * lh; x.strokeText(t, W / 2, yy); x.fillText(t, W / 2, yy); });
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await f.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
    names.push(name);
  };

  const jobs = [['sub_blank.png', null]];
  let t = 0, list = '';
  const add = (name, d) => { if (d > 0.001) list += `file '${name}'\nduration ${d.toFixed(3)}\n`; };
  for (const it of items) {
    const st = Math.max(it.start, t);
    if (st > t) add('sub_blank.png', st - t);
    const name = `sub_${it.i}.png`;
    jobs.push([name, it.lines]);
    add(name, it.end - st);
    t = Math.max(t, it.end);
  }
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const [n, l] = jobs[next++]; await draw(n, l); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  add('sub_blank.png', Math.max(videoDur - t, 0) + 5);
  list += `file 'sub_blank.png'\n`;
  await f.writeFile('subs.txt', new TextEncoder().encode(list));
  names.push('subs.txt');
  return { y, files: names, fontFailed };
}

// watermark text + circular logo drawn once onto a transparent PNG the size of the output frame
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('logo')); i.src = src; });
async function makeOverlay(f, fx, g) {
  const wm = fx.wm && fx.wm.on && String(fx.wm.text || '').trim() ? fx.wm : null;
  const lg = fx.logo && fx.logo.on && fx.logo.data ? fx.logo : null;
  if (!wm && !lg) return null;
  const W = g.OW, H = g.OH, m = Math.round(Math.min(W, H) * 0.035);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const place = (pos, w, h) => ({
    x: pos.endsWith('l') ? m : W - m - w,
    y: pos.startsWith('t') ? m : H - m - h
  });
  if (lg) {
    try {
      const img = await loadImg(lg.data);
      const d = Math.round(Math.min(W, H) * (Math.max(5, Math.min(40, +lg.size || 14)) / 100));
      const p = place(lg.pos || 'tr', d, d);
      ctx.save(); ctx.beginPath(); ctx.arc(p.x + d / 2, p.y + d / 2, d / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      const k = Math.max(d / img.width, d / img.height);                          // cover-fit into the circle
      ctx.drawImage(img, p.x + (d - img.width * k) / 2, p.y + (d - img.height * k) / 2, img.width * k, img.height * k);
      ctx.restore();
    } catch {}
  }
  if (wm) {
    const px = Math.max(10, Math.round(Math.min(W, H) * (Math.max(2, Math.min(10, +wm.size || 4)) / 100)));
    try { await ensureSubFont(fx.subs && fx.subs.font); } catch {}
    const fam = subFontFamily(fx.subs && fx.subs.font);
    try { await document.fonts.load(`700 ${px}px ${fam}`, wm.text); } catch {}
    ctx.font = `700 ${px}px ${fam}`; ctx.textBaseline = 'top';
    const tw = Math.ceil(ctx.measureText(wm.text).width), th = Math.round(px * 1.3);
    const p = place(wm.pos || 'br', tw, th);
    ctx.globalAlpha = 0.75; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, px * 0.14);
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
    ctx.strokeText(wm.text, p.x, p.y); ctx.fillText(wm.text, p.x, p.y);
  }
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  await f.writeFile('ovl.png', new Uint8Array(await blob.arrayBuffer()));
  return true;
}

function dubStats(placed, maxTempo) {
  const d = placed.filter(Boolean).map(p => p.drift);
  const longLines = [];
  placed.forEach((p, i) => { if (p && p.natural > p.slot * maxTempo * 1.02) longLines.push({ i, ratio: (p.slot * maxTempo) / p.natural }); });
  return { lateCount: d.filter(x => x > 0.5).length, maxDrift: Math.max(0, ...d), longLines };
}

export async function renderDub({ file, videoDur, segs, burmese, persona, pitch, rate = 0, fx = null, keepTalk = 0, keepGap = 0, offset = 0, maxTempo = 1.7, dubGain = 1.6, onProgress }) {
  const n = segs.length;
  const f = await getFFmpeg();
  // flog: last 400 log lines (for error reports); fhead: first lines of the current run (input stream info)
  const flog = [], fhead = [];
  const onLog = ({ message }) => { const m = String(message); flog.push(m); if (flog.length > 400) flog.shift(); if (fhead.length < 150) fhead.push(m); };
  try { f.on('log', onLog); } catch {}
  const ctx = new OfflineAudioContext(1, Math.ceil((videoDur + 30) * SR), SR);
  // seconds spent in each stage, shown on the result page
  const timing = {};
  let tMark = performance.now();
  const lap = k => { const t = performance.now(); timing[k] = (timing[k] || 0) + (t - tMark) / 1000; tMark = t; };
  let inName = null, temp = false;
  try {
    // 1) TTS (3 in parallel; drops to 2 as soon as any request has to be retried) — 0..50%
    // A line Microsoft will not speak is tried in smaller pieces, then left silent (listed on the result page);
    // too many of those, or any other error (network), stops the render.
    const raw = new Array(n).fill(null);
    const todo = [...Array(n).keys()].filter(i => burmese[i] && speakable(burmese[i]));
    const total = todo.length || 1;
    const skipped = [];
    const maxSkip = Math.max(2, Math.floor(total * 0.1));
    let done = 0, failed = false, lanes = 3;
    const slowDown = () => { lanes = 2; };
    const run = async lane => {
      while (todo.length && !failed && lane < lanes) {   // one line failed for good -> the other workers stop too
        const i = todo.shift();
        try { raw[i] = await ttsCached(burmese[i], persona, pitch, rate, slowDown); }
        catch (e) {
          if (!isNoAudio(e)) { failed = true; throw e; }
          try { raw[i] = await ttsPieces(burmese[i], persona, pitch, rate); }
          catch (e2) {
            if (!isNoAudio(e2) && !/no smaller pieces/.test(e2.message)) { failed = true; throw e2; }
            skipped.push(i);
            if (skipped.length > maxSkip) {
              failed = true;
              throw new Error(`TTS: စာကြောင်း ${skipped.length} ကြောင်း အသံမထွက်ပါ (ID: ${skipped.sort((a, b) => a - b).join(', ')}) — ` + e.message);
            }
          }
        }
        done++;
        onProgress((done / total) * 0.5, `မြန်မာအသံ ထုတ်နေပါတယ် (${done}/${total})`);
      }
    };
    onProgress(0, `မြန်မာအသံ ထုတ်နေပါတယ် (0/${todo.length})`);
    await Promise.all([0, 1, 2].map(run));
  lap('tts');

    // 2) fit each clip into its time slot — 50..75%
    setFFProgress(null);
    const placed = new Array(n).fill(null);
    const clips = [];
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      onProgress(0.5 + (i / n) * 0.25, `အသံကို ဗီဒီယိုအချိန်နဲ့ ကိုက်အောင် ညှိနေပါတယ် (${i + 1}/${n})`);
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
        // one thread is plenty for a short clip; on the multi-core build many quick runs with automatic threads could hang
        const code = await ffRun(f, [...mtArgs(), ...mtIn(1), '-i', 's.mp3', '-filter:a', tempoChain(tempo), '-ar', String(SR), '-ac', '1', ...mtIn(1), 's.wav']);
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

    lap('fit');
    // 3) mix all clips into one track — 75..85%
    onProgress(0.76, 'အသံတွေကို တစ်ဆက်တည်း ပေါင်းနေပါတယ်');
    for (const c of clips) {
      const src = ctx.createBufferSource();
      src.buffer = c.buf;
      src.connect(ctx.destination);
      src.start(c.start, c.lead, c.len);
    }
    const mixed = await ctx.startRendering();
    const wavBytes = encodeWav(mixed);
    lap('mix');
    onProgress(0.85, 'ဗီဒီယိုဖိုင်ကို ပြင်ဆင်နေပါတယ်');

    // 4) mux with video — 85..100%
    inName = keptInput;
    if (inName) {
      try { const l = await f.listDir('/'); if (!l.some(x => x.name === inName)) inName = null; } catch { inName = null; }
    }
    if (!inName) {
      inName = 'v.' + extOf(file); temp = true;
      try { await f.writeFile(inName, await fetchFile(file)); }
      catch { throw new Error('Video ဖိုင်ကို ပြန်ဖတ်မရပါ — "Video ပြန်ရွေးပြီး ပြန်စမည်" ကိုနှိပ်ပါ'); }
    }
    await f.writeFile('mix.wav', wavBytes);
    lap('input');
    let ffLabel = 'ဗီဒီယိုဖိုင်ကို ပြင်ဆင်နေပါတယ်';
    setFFProgress(p => onProgress(0.85 + p * 0.15, p > 0.97 ? 'နောက်ဆုံးအဆင့် — ဗီဒီယိုဖိုင် သိမ်းနေပါတယ်' : ffLabel));
    const wantMix = keepTalk > 0 || keepGap > 0;
    let geo = null;
    if (fx) {
      const needGeo = fx.ratio && fx.ratio !== 'orig' || +fx.zoom > 100 || (fx.subs && fx.subs.on) || (fx.wm && fx.wm.on) || (fx.logo && fx.logo.on) || (fx.fast && (fx.mirror || fx.blur));
      if (needGeo) {
        let sz = null;
        try { sz = await videoSize(file); } catch {}
        if (!(sz && sz.w && sz.h)) {                                   // browser can't decode this codec -> ask ffmpeg itself
          try {
            flog.length = 0; await ffRun(f, ['-i', inName]);
            const t = flog.join('\n'), m = t.match(/Video:[^\n]*?[ ,](\d{2,5})x(\d{2,5})/), rot = t.match(/rotation of (-?[\d.]+)/);
            if (m) { sz = { w: +m[1], h: +m[2] }; if (rot && Math.abs(Math.round(+rot[1])) % 180 === 90) sz = { w: sz.h, h: sz.w }; }
          } catch {}
        }
        if (sz && sz.w && sz.h) geo = outGeometry(sz, fx);
      }
      fx = { ...fx, geo };
    }
    let subs = null, ovl = false;
    if (geo && fx && ((fx.wm && fx.wm.on) || (fx.logo && fx.logo.on))) {
      onProgress(0.855, 'Watermark / Logo ထည့်ဖို့ ပြင်ဆင်နေပါတယ်');
      try { ovl = !!(await makeOverlay(f, fx, geo)); } catch { ovl = false; }
      lap('overlay');
    }
    if (fx && fx.subs && fx.subs.on) {
      onProgress(0.86, 'မြန်မာစာတန်းထိုးတွေ ရေးဆွဲနေပါတယ်');
      try { subs = await makeSubTrack(f, { file, videoDur, burmese, placed, fx }); } catch { subs = null; }
      lap('subs');
    }
    const ovlIdx = ovl ? (subs ? 3 : 2) : 0;
    // "30 fps" option: only lower the frame rate when the source is faster (60 fps); 24/25/30 fps stay as they are
    if (fx && fx.fps30) {
      let srcFps = 0;
      try {
        flog.length = 0; fhead.length = 0; await ffRun(f, ['-i', inName]);
        const m = fhead.join('\n').match(/Video:[^\n]*?([\d.]+) fps/); srcFps = m ? +m[1] : 0;
      } catch (e) { if (e && e.mtStall) throw e; }
      fx = { ...fx, cap30: srcFps > 31 };
    }
    const fxFilter = buildFx(fx, subs, geo, ovlIdx);
    const mixHead = wantMix
      ? `[0:a]volume='${gainExpr(duckIntervals(segs, placed), keepTalk, keepGap)}':eval=frame[o];[1:a]volume=${dubGain.toFixed(2)},apad[d];[o][d]amix=inputs=2:duration=first:dropout_transition=0,volume=2`
      : '';
    // build the list of ffmpeg attempts for a given video filter ('' = copy the video stream untouched)
    const build = (vf, withSubs, withOvl = false) => {
      const vMap = vf ? ['-map', '[v]'] : ['-map', '0:v:0'];
      const enc = vf ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p', ...mtEnc()] : ['-c:v', 'copy'];
      const tail = ['-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', 'out.mp4'];
      const base = [...mtArgs(), ...mtIn(mainDec()), '-i', inName, ...mtIn(1), '-i', 'mix.wav', ...(withSubs ? [...mtIn(1), '-f', 'concat', '-safe', '0', '-i', 'subs.txt'] : []), ...(withOvl ? [...mtIn(1), '-i', 'ovl.png'] : [])];
      const list = [];
      if (wantMix) {
        for (const lim of [',alimiter=limit=0.95:level=0', '']) {
          const fc = (vf ? vf + ';' : '') + `${mixHead}${lim}[a]`;
          list.push({ mix: true, args: [...base, '-filter_complex', fc, ...vMap, '-map', '[a]', ...enc, ...tail] });
        }
      }
      list.push({
        mix: false,
        args: vf
          ? [...base, '-filter_complex', vf, ...vMap, '-map', '1:a:0', ...enc, ...tail]
          : [...base, ...vMap, '-map', '1:a:0', ...enc, ...tail]
      });
      return list;
    };
    const plans = [build(fxFilter, !!subs, ovl)];
    if (fx && fx.blur && +fx.blurO < 100) {                       // if the see-through blur is not supported, try a solid one
      const solid = buildFx({ ...fx, blurO: 100 }, subs, geo, ovlIdx);
      if (solid !== fxFilter) plans.push(build(solid, !!subs, ovl));
    }
    if (subs && ovl) { const f2 = buildFx(fx, subs, geo, 0); plans.push(build(f2, true, false)); }       // without watermark / logo
    if ((subs || ovl) && buildFx(fx, null, geo, 0)) plans.push(build(buildFx(fx, null, geo, 0), false, false));
    if (fxFilter) plans.push(build('', false));
    lap('prep');
    // progress text: say what this pass is putting together
    const fxNames = [];
    if (geo && geo.ratio) fxNames.push('အချိုး');
    if (fx && +fx.zoom > 100) fxNames.push('Zoom');
    if (fx && fx.mirror) fxNames.push('Mirror');
    if (fx && fx.blur) fxNames.push('Blur');
    if (subs) fxNames.push('စာတန်းထိုး');
    if (ovl) fxNames.push('Watermark/Logo');
    if (fx && fx.cap30) fxNames.push('30fps');
    let tries = 0;
    let code = -1, usedMix = false, fxFailed = false, diag = '';
    outer: for (let p = 0; p < plans.length; p++) {
      for (const a of plans[p]) {
        const vfOn = a.args.includes('[v]');
        ffLabel = tries++ ? 'ပထမနည်း မရလို့ တခြားနည်းနဲ့ ပြန်ကြိုးစားနေပါတယ်'
          : vfOn && fxNames.length ? `ဗီဒီယိုကို ${fxNames.join('၊ ')} နဲ့ ပြန်ထုတ်ပြီး အသံပေါင်းနေပါတယ်`
          : a.mix ? 'မြန်မာအသံ၊ မူရင်းအသံနဲ့ ဗီဒီယို ပေါင်းနေပါတယ်' : 'မြန်မာအသံနဲ့ ဗီဒီယို ပေါင်းနေပါတယ်';
        onProgress(0.86, ffLabel);
        flog.length = 0; fhead.length = 0; flog.push(`#plan ${p + 1} ${a.mix ? 'mix' : 'nomix'}`);
        code = await ffRun(f, a.args);
        if (code !== 0 && !diag) diag = flog.filter(x => x.length < 300).slice(-14).join('\n');
        if (code === 0) { usedMix = a.mix; fxFailed = !!fxFilter && p > 0; break outer; }
        try { await f.deleteFile('out.mp4'); } catch {}
      }
    }
    if (code !== 0) throw new Error('Video ပေါင်းစပ်မှု မအောင်မြင်ပါ (ffmpeg error)');
    lap('encode');
    // source video size / frame rate, read from ffmpeg's own log of the successful pass
    let src = null;
    const sm = fhead.join('\n').match(/Stream #0:\d+[^\n]*?Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?([\d.]+) fps/);
    if (sm) src = { w: +sm[1], h: +sm[2], fps: +sm[3] };
    // what was actually written: size after 720p / ratio, frame rate after the 30 fps option (null = stream copy)
    let outV = null;
    if (src && fxFilter && !fxFailed) outV = { w: geo ? geo.OW : src.w, h: geo ? geo.OH : src.h, fps: fx && fx.cap30 ? 30 : src.fps };
    if (fx && fx.subs && fx.subs.on && !subs) fxFailed = true;
    try { f.off('log', onLog); } catch {}
    if (fx && fx.subs && fx.subs.on && !subs) diag = (diag ? diag + '\n' : '') + 'subtitle track build failed' + (subs === null ? '' : '');
    const fontFailed = !!(subs && subs.fontFailed);
    const fellBack = wantMix && !usedMix;
    const out = await f.readFile('out.mp4');
    for (const x of [temp ? inName : null, 'mix.wav', 'out.mp4', ovl ? 'ovl.png' : null, ...(subs ? subs.files : [])]) { if (x) { try { await f.deleteFile(x); } catch {} } }
    lap('save');
    setFFProgress(null);
    onProgress(1, 'ပြီးပါပြီ 🎉');
    return { video: new Blob([out.slice().buffer], { type: 'video/mp4' }), placed, fellBack, fxFailed, fontFailed, diag, geoOk: !!geo, ovlOk: ovl, subsOk: !!subs, stats: dubStats(placed, maxTempo), timing, tries, src, engine: engineInfo(), out: outV, skipped: skipped.sort((a, b) => a - b) };
  } catch (e) {
    // failed part-way: free the leftover work files so a retry doesn't run out of memory
    try { f.off('log', onLog); } catch {}
    setFFProgress(null);
    try {
      for (const x of await f.listDir('/')) {
        if (!x.isDir && x.name !== keptInput && (x.name === inName && temp || /^(s\.mp3|s\.wav|mix\.wav|out\.mp4|ovl\.png|subs\.txt|sub_.*\.png)$/.test(x.name))) {
          try { await f.deleteFile(x.name); } catch {}
        }
      }
    } catch {}
    throw e;
  }
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
