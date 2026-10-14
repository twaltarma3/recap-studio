/* ---------- Thumbnail maker: pick a frame from the video, add a title, 3:4 (1080x1440) in one of 5 styles ---------- */
import { ensureSubFont, subFontFamily } from './lib.js';

export const THUMB_W = 1080, THUMB_H = 1440;

export const STYLES = [
  { id: 'blue', name: 'ဇာတ်လမ်း ခေါင်းစဉ် (အပြာအနား)', desc: 'ပုံအပြည့်၊ အဖြူစာလုံး အပြာအနားထူ၊ နောက်ဆုံးစာကြောင်း ပိုကြီး' },
  { id: 'mystery', name: 'အနက်နောက်ခံ ထူးဆန်း', desc: 'မှောင်မှောင်၊ ရွှေရောင်ဘောင်၊ အောက်ဘက် ရွှေစာလုံးကြီး' },
  { id: 'pop', name: 'ရောင်စုံ Pop', desc: 'အရောင်တောက်တောက်၊ အဝါစာလုံး ပန်းနုရောင်အနား' },
  { id: 'doc', name: 'Documentary စွန့်စားခန်း', desc: 'အပေါ် ခေါင်းစဉ်ဘား၊ အောက် အနီရောင်စာတန်း' },
  { id: 'epic', name: 'လျှို့ဝှက် Epic', desc: 'အလင်းတန်းများ၊ ရွှေ+ဖြူ ခေါင်းစဉ် အလယ်' },
  { id: 'recap', name: 'ရုပ်ရှင် Recap', desc: 'အပြာရောင် tone၊ အနီရောင် ခေါင်းစဉ်ဘောက်စ်' }
];

/* ---- reading frames from the video ---- */
function openVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    const done = ok => { clearTimeout(tm); v.onloadeddata = v.onerror = null; ok ? res(v) : rej(new Error('ဒီ Video ကနေ ပုံထုတ်လို့ မရပါ')); };
    const tm = setTimeout(() => done(false), 20000);
    v.onloadeddata = () => done(v.videoWidth > 0);
    v.onerror = () => done(false);
    v.src = src;
  });
}
function seek(v, t) {
  return new Promise(res => {
    const fin = () => { clearTimeout(tm); v.removeEventListener('seeked', fin); requestAnimationFrame(() => res()); };
    const tm = setTimeout(fin, 4000);
    v.addEventListener('seeked', fin);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05));
  });
}
const toCanvas = (v, w) => {
  const h = Math.round(w * v.videoHeight / v.videoWidth);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  return c;
};

// how good a frame looks as a thumbnail: sharp, colourful, not too dark / bright
function score(c) {
  const { width: w, height: h } = c;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let sumL = 0, sharp = 0, n = 0, rgS = 0, rgQ = 0, ybS = 0, ybQ = 0;
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b; L[p] = l; sumL += l;
    const rg = r - g, yb = 0.5 * (r + g) - b;
    rgS += rg; rgQ += rg * rg; ybS += yb; ybQ += yb * yb;
  }
  const N = w * h;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const p = y * w + x; sharp += Math.abs(L[p + 1] - L[p - 1]) + Math.abs(L[p + w] - L[p - w]); n++;
  }
  const mean = sumL / N;
  const rgM = rgS / N, ybM = ybS / N;
  const colour = Math.sqrt(Math.max(0, rgQ / N - rgM * rgM) + Math.max(0, ybQ / N - ybM * ybM)) + 0.3 * Math.hypot(rgM, ybM);
  const exposure = mean < 45 ? (45 - mean) * 1.5 : mean > 210 ? (mean - 210) * 1.5 : 0;
  return sharp / Math.max(1, n) * 1.6 + colour * 0.5 - exposure;
}

// sample frames evenly (skipping the very start / end) and return the best ones, best first
export async function pickFrames(src, { samples = 18, keep = 6, onProgress } = {}) {
  const v = await openVideo(src);
  const dur = v.duration && isFinite(v.duration) ? v.duration : 0;
  if (!dur) throw new Error('Video အရှည်ကို ဖတ်လို့ မရပါ');
  const out = [];
  for (let i = 0; i < samples; i++) {
    const t = dur * (0.06 + 0.88 * (i + 0.5) / samples);
    await seek(v, t);
    const small = toCanvas(v, 160);
    out.push({ t, s: score(small), img: toCanvas(v, 360).toDataURL('image/jpeg', 0.8) });
    if (onProgress) onProgress((i + 1) / samples);
  }
  v.removeAttribute('src'); v.load();
  // best first, but from different parts of the video (not six frames of the same scene)
  const sorted = out.sort((a, b) => b.s - a.s), pick = [];
  for (const gap of [dur * 0.1, dur * 0.05, 0]) {
    for (const f of sorted) if (pick.length < keep && !pick.includes(f) && pick.every(p => Math.abs(p.t - f.t) >= gap)) pick.push(f);
  }
  return { dur, frames: pick };
}

// the full-size frame used for the thumbnail
export async function grabFrame(src, t) {
  const v = await openVideo(src);
  await seek(v, t);
  const c = toCanvas(v, Math.min(1920, v.videoWidth));
  v.removeAttribute('src'); v.load();
  return c;
}

/* ---- drawing ---- */
// split a line into pieces it may break at: the spaces the writer put first; a piece still too wide is cut at
// Burmese word boundaries (Intl.Segmenter), else at characters
const segWords = text => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter('my', { granularity: 'word' }).segment(text)].map(s => s.segment);
  } catch {}
  return [...text];
};
function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const pieces = [];
    for (const tok of para.trim().split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok) || ctx.measureText(tok).width <= maxW) pieces.push(tok);
      else pieces.push(...segWords(tok));
    }
    let line = '';
    for (const w of pieces) {
      const next = line + w;
      if (line.trim() && ctx.measureText(next.trim()).width > maxW) { lines.push(line.trim()); line = w.trimStart(); }
      else line = next;
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}
// largest font size where the text fits in maxLines lines
function fitText(ctx, text, family, maxW, start, min, maxLines) {
  for (let size = start; size >= min; size -= 4) {
    ctx.font = `700 ${size}px ${family}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  ctx.font = `700 ${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, maxW).slice(0, maxLines) };
}
function drawCover(ctx, img, W, H, focus = 0.5) {
  const s = Math.max(W / img.width, H / img.height);
  const dw = img.width * s, dh = img.height * s;
  const x = (W - dw) * Math.max(0, Math.min(1, focus)), y = (H - dh) / 2;
  ctx.drawImage(img, x, y, dw, dh);
}
const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

// text block, lines centred on cx, first baseline at y; returns the bottom
function drawLines(ctx, lines, cx, y, size, paint) {
  const lh = size * 1.55;
  lines.forEach((l, i) => paint(l, cx, y + i * lh));
  return y + (lines.length - 1) * lh;
}

/**
 * Draw one thumbnail.
 * ctx: 2d context of a canvas sized w x h (3:4); img: frame canvas; o: { style, title, sub, focus, font }
 */
export function drawThumb(ctx, w, h, img, o) {
  const u = w / THUMB_W;                                   // all sizes below are for 1080 wide
  const fam = subFontFamily(o.font || 'pt16');
  const title = (o.title || '').trim() || 'ခေါင်းစဉ် ဒီမှာ ရေးပါ';
  const sub = (o.sub || '').trim();
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  const style = o.style || 'blue';

  const filters = {
    blue: 'saturate(1.18) contrast(1.06) brightness(1.03)',
    mystery: 'brightness(0.72) contrast(1.2) saturate(0.85)',
    pop: 'saturate(1.55) contrast(1.15) brightness(1.06)',
    doc: 'contrast(1.12) saturate(0.95)',
    epic: 'brightness(0.82) contrast(1.15) saturate(1.1) sepia(0.25)',
    recap: 'saturate(0.8) contrast(1.08)'
  };
  ctx.filter = filters[style] || 'none';
  if (img) drawCover(ctx, img, w, h, o.focus);
  else { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, h); }
  ctx.filter = 'none';

  const grad = (y0, y1, stops) => { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([p, c]) => g.addColorStop(p, c)); return g; };

  if (style === 'blue') {
    // soft dark fade under the title so it reads on any picture
    ctx.fillStyle = grad(h * 0.6, h, [[0, 'rgba(0,10,40,0)'], [1, 'rgba(0,10,40,.55)']]); ctx.fillRect(0, h * 0.6, w, h * 0.4);
    const maxW = w - 90 * u;
    let { size, lines } = fitText(ctx, title, fam, maxW, 112 * u, 50 * u, 3);
    // the last line is the "punch": bigger, as long as it still fits
    let big = size;
    if (lines.length > 1) {
      const last = lines[lines.length - 1];
      for (big = Math.round(size * 1.45); big > size; big -= 4 * u) { ctx.font = `700 ${big}px ${fam}`; if (ctx.measureText(last).width <= maxW) break; }
    }
    const sizes = lines.map((_, i) => (i === lines.length - 1 && lines.length > 1 ? big : size));
    const gaps = sizes.map(sz => sz * 1.5);
    const total = gaps.reduce((a, b) => a + b, 0);
    let y = h - 150 * u - (sub ? 60 * u : 0) - total + sizes[0];
    const yEnd = [];
    lines.forEach((l, i) => {
      const sz = sizes[i];
      ctx.font = `700 ${sz}px ${fam}`;
      ctx.shadowColor = 'rgba(0,0,30,.75)'; ctx.shadowBlur = 24 * u; ctx.shadowOffsetY = 6 * u;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = sz * 0.34; ctx.strokeText(l, w / 2, y);     // thin white outer edge
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#1238d6'; ctx.lineWidth = sz * 0.24; ctx.strokeText(l, w / 2, y);     // thick royal-blue outline
      ctx.fillStyle = '#ffffff'; ctx.fillText(l, w / 2, y);
      yEnd.push(y);
      if (i < lines.length - 1) y += sizes[i + 1] * 1.5;
    });
    // golden light streak under the title
    const ly = yEnd[yEnd.length - 1] + sizes[sizes.length - 1] * 0.55;
    const lg = ctx.createLinearGradient(w * 0.1, 0, w * 0.9, 0);
    lg.addColorStop(0, 'rgba(255,190,60,0)'); lg.addColorStop(0.5, 'rgba(255,236,170,1)'); lg.addColorStop(1, 'rgba(255,190,60,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lg; ctx.fillRect(w * 0.1, ly - 2.5 * u, w * 0.8, 5 * u);
    const flare = ctx.createRadialGradient(w / 2, ly, 0, w / 2, ly, 90 * u);
    flare.addColorStop(0, 'rgba(255,240,190,.95)'); flare.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = flare; ctx.fillRect(w / 2 - 90 * u, ly - 90 * u, 180 * u, 180 * u);
    ctx.restore();
    if (sub) {
      ctx.font = `700 ${44 * u}px ${fam}`;
      ctx.strokeStyle = '#1238d6'; ctx.lineWidth = 10 * u; ctx.strokeText(sub, w / 2, h - 90 * u, w - 120 * u);
      ctx.fillStyle = '#fff'; ctx.fillText(sub, w / 2, h - 90 * u, w - 120 * u);
    }
  }

  if (style === 'mystery') {
    const v = ctx.createRadialGradient(w / 2, h * 0.42, w * 0.2, w / 2, h * 0.5, w * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.85)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = grad(h * 0.5, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.92)']]); ctx.fillRect(0, h * 0.5, w, h * 0.5);
    // gold frame
    ctx.strokeStyle = '#d4a63a'; ctx.lineWidth = 12 * u; ctx.strokeRect(30 * u, 30 * u, w - 60 * u, h - 60 * u);
    ctx.strokeStyle = 'rgba(255,224,138,.6)'; ctx.lineWidth = 3 * u; ctx.strokeRect(52 * u, 52 * u, w - 104 * u, h - 104 * u);
    const { size, lines } = fitText(ctx, title, fam, w - 200 * u, 124 * u, 56 * u, 3);
    const lh = size * 1.55, top = h - 150 * u - (lines.length - 1) * lh - (sub ? 70 * u : 0);
    const g = grad(top - size, top + lines.length * lh, [[0, '#fff3c4'], [0.5, '#ffd34d'], [1, '#c98b12']]);
    drawLines(ctx, lines, w / 2, top, size, (l, x, y) => {
      ctx.shadowColor = 'rgba(255,190,60,.55)'; ctx.shadowBlur = 30 * u;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 14 * u; ctx.strokeText(l, x, y);
      ctx.shadowBlur = 0; ctx.fillStyle = g; ctx.fillText(l, x, y);
    });
    if (sub) { ctx.font = `700 ${46 * u}px ${fam}`; ctx.fillStyle = '#f2f2f2'; ctx.fillText(sub, w / 2, h - 110 * u); }
  }

  if (style === 'pop') {
    const gl = ctx.createRadialGradient(w * 0.8, h * 0.15, 0, w * 0.8, h * 0.15, w * 0.9);
    gl.addColorStop(0, 'rgba(255,170,90,.45)'); gl.addColorStop(1, 'rgba(255,80,160,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad(0, h * 0.42, [[0, 'rgba(70,0,60,.55)'], [1, 'rgba(70,0,60,0)']]); ctx.fillRect(0, 0, w, h * 0.42);
    const { size, lines } = fitText(ctx, title, fam, w - 140 * u, 136 * u, 60 * u, 3);
    drawLines(ctx, lines, w / 2, 90 * u + size, size, (l, x, y) => {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 34 * u; ctx.strokeText(l, x, y);
      ctx.strokeStyle = '#e0137a'; ctx.lineWidth = 18 * u; ctx.strokeText(l, x, y);
      ctx.fillStyle = '#ffe14d'; ctx.fillText(l, x, y);
    });
    if (sub) {
      ctx.font = `700 ${50 * u}px ${fam}`;
      const tw = Math.min(w - 120 * u, ctx.measureText(sub).width + 80 * u);
      rrect(ctx, (w - tw) / 2, h - 190 * u, tw, 100 * u, 50 * u); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = '#e0137a'; ctx.fillText(sub, w / 2, h - 122 * u, w - 160 * u);
    }
  }

  if (style === 'doc') {
    ctx.font = `700 ${100 * u}px ${fam}`;
    const { size, lines } = fitText(ctx, title, fam, w - 120 * u, 104 * u, 52 * u, 3);
    const lh = size * 1.55, band = 70 * u + lines.length * lh;
    ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(0, 0, w, band);
    ctx.fillStyle = '#ffd400'; ctx.fillRect(0, band, w, 8 * u);
    drawLines(ctx, lines, w / 2, 40 * u + size, size, (l, x, y) => { ctx.fillStyle = '#ffd400'; ctx.fillText(l, x, y); });
    ctx.fillStyle = grad(h * 0.7, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.6)']]); ctx.fillRect(0, h * 0.7, w, h * 0.3);
    const strip = sub || 'ဇာတ်လမ်း အပြည့်အစုံ';
    ctx.font = `700 ${50 * u}px ${fam}`;
    ctx.fillStyle = '#d90429'; ctx.fillRect(0, h - 170 * u, w, 110 * u);
    ctx.fillStyle = '#fff'; ctx.fillText(strip, w / 2, h - 100 * u, w - 80 * u);
  }

  if (style === 'epic') {
    // light rays from the top centre
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ox = w / 2, oy = -h * 0.08;
    for (let i = 0; i < 14; i++) {
      const a = Math.PI / 2 + (i - 6.5) * 0.075, spread = 0.022 + (i % 3) * 0.01;
      const len = h * 1.25;
      const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
      g.addColorStop(0, `rgba(255,226,160,${0.22 + (i % 2) * 0.08})`); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
      ctx.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len); ctx.closePath(); ctx.fill();
    }
    const glow = ctx.createRadialGradient(ox, h * 0.08, 0, ox, h * 0.08, w * 0.55);
    glow.addColorStop(0, 'rgba(255,230,170,.55)'); glow.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.restore();
    ctx.fillStyle = grad(h * 0.45, h, [[0, 'rgba(10,6,0,0)'], [1, 'rgba(10,6,0,.85)']]); ctx.fillRect(0, h * 0.45, w, h * 0.55);
    const { size, lines } = fitText(ctx, title, fam, w - 160 * u, 128 * u, 58 * u, 3);
    const lh = size * 1.55, top = h * 0.66 - ((lines.length - 1) * lh) / 2;
    const g = grad(top - size, top + lines.length * lh, [[0, '#ffffff'], [0.45, '#ffe6a6'], [1, '#d99a1e']]);
    drawLines(ctx, lines, w / 2, top, size, (l, x, y) => {
      ctx.shadowColor = 'rgba(255,200,90,.9)'; ctx.shadowBlur = 45 * u;
      ctx.strokeStyle = 'rgba(40,20,0,.9)'; ctx.lineWidth = 10 * u; ctx.strokeText(l, x, y);
      ctx.shadowBlur = 0; ctx.fillStyle = g; ctx.fillText(l, x, y);
    });
    if (sub) { ctx.font = `700 ${46 * u}px ${fam}`; ctx.fillStyle = '#fff'; ctx.fillText(sub, w / 2, h - 110 * u, w - 120 * u); }
  }

  if (style === 'recap') {
    ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = 'rgba(30,107,214,.55)'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad(h * 0.5, h, [[0, 'rgba(4,18,48,0)'], [1, 'rgba(4,18,48,.9)']]); ctx.fillRect(0, h * 0.5, w, h * 0.5);
    // corner badge
    ctx.font = `700 ${40 * u}px ${fam}`;
    const bw = ctx.measureText('အကျဉ်းချုပ်').width + 50 * u;
    rrect(ctx, 50 * u, 50 * u, bw, 76 * u, 14 * u); ctx.fillStyle = '#e50914'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText('အကျဉ်းချုပ်', 50 * u + bw / 2, 104 * u);
    const { size, lines } = fitText(ctx, title, fam, w - 200 * u, 108 * u, 52 * u, 3);
    const lh = size * 1.55, boxH = 60 * u + lines.length * lh, boxY = h - 120 * u - boxH;
    rrect(ctx, 60 * u, boxY, w - 120 * u, boxH, 26 * u); ctx.fillStyle = '#e50914'; ctx.fill();
    drawLines(ctx, lines, w / 2, boxY + 20 * u + size, size, (l, x, y) => { ctx.fillStyle = '#fff'; ctx.fillText(l, x, y); });
    if (sub) { ctx.font = `700 ${46 * u}px ${fam}`; ctx.fillStyle = '#dbe8ff'; ctx.fillText(sub, w / 2, boxY - 34 * u, w - 140 * u); }
  }
  ctx.restore();
}

export async function thumbBlob(img, o) {
  await ensureSubFont(o.font || 'pt16').catch(() => {});
  const c = document.createElement('canvas'); c.width = THUMB_W; c.height = THUMB_H;
  drawThumb(c.getContext('2d'), THUMB_W, THUMB_H, img, o);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}

// Gemini prompt: catchy thumbnail titles from the Burmese script
export function titlePrompt(burmese) {
  const script = burmese.filter(Boolean).join(' ').slice(0, 6000);
  return `အောက်က မြန်မာ Movie Recap ဇာတ်ကြောင်းကို ဖတ်ပြီး YouTube / TikTok Thumbnail ပေါ်မှာ ထည့်ဖို့ ဆွဲဆောင်မှုရှိတဲ့ ခေါင်းစဉ် ၅ ခု ရေးပေးပါ။

စည်းကမ်း:
- အပြောစကား (စာရေးစကား မသုံးရ)၊ လူတွေ ဖွင့်ကြည့်ချင်အောင် စပ်စုချင်စိတ် ဖြစ်စေရမယ်
- ခေါင်းစဉ် တစ်ခုကို စာလုံး ၂၅ လုံးထက် မပိုစေနဲ့
- Emoji၊ hashtag၊ ကောက်ကြောင်းအဆုံးသတ် (spoiler) မပါစေနဲ့
- ခေါင်းစဉ်တိုင်းမှာ စာလုံး ၁၅ လုံးအောက် ခေါင်းစဉ်ငယ် တစ်ခု တွဲပေးပါ

ပုံစံ (ဒီအတိုင်းပဲ ပြန်ပေးပါ):
1. ခေါင်းစဉ် | ခေါင်းစဉ်ငယ်
2. ခေါင်းစဉ် | ခေါင်းစဉ်ငယ်
...

ဇာတ်ကြောင်း:
${script}`;
}
