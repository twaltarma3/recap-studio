/* ---------- Thumbnail helper: find shots of the main character, hand one to ChatGPT with a ready prompt ---------- */
// The app only picks the picture; ChatGPT suggests titles / designs and draws the 3D thumbnail itself.

/* ---- face detector (MediaPipe, ~13 MB engine served from /mediapipe/, model in /models/) ---- */
let detP = null;
function faceDetector() {
  if (!detP) {
    detP = (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(new URL('/mediapipe', location.href).href);
      return FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE', minDetectionConfidence: 0.5
      });
    })().catch(e => { detP = null; throw e; });
  }
  return detP;
}

/* ---- reading frames from the video ---- */
function openVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
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

// picture quality: sharp, not too dark / bright (middle band only, so burned-in captions don't count)
function quality(c) {
  const w = c.width, y0 = Math.floor(c.height * 0.1), h = Math.max(4, Math.floor(c.height * 0.72) - y0);
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, y0, w, h).data;
  const L = new Float32Array(w * h); let sum = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += L[p]; }
  let sharp = 0, n = 0;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) { const p = y * w + x; sharp += Math.abs(L[p + 1] - L[p - 1]) + Math.abs(L[p + w] - L[p - w]); n++; }
  const mean = sum / (w * h);
  return sharp / Math.max(1, n) - (mean < 45 ? (45 - mean) : mean > 215 ? (mean - 215) : 0);
}

/**
 * Sample the video and return 6 shots that best show the main character: one big, clear face (close-ups first),
 * from different parts of the video. Falls back to sharp, well-exposed frames if no face is found.
 * Each result: { t, img (preview data URL), face: {x,y,w,h} in 0..1 or null }
 */
export async function pickCharacterShots(src, { samples = 36, keep = 6, onProgress } = {}) {
  let det = null;
  try { det = await faceDetector(); } catch (e) { console.warn('face detector unavailable', e); }
  const v = await openVideo(src);
  const dur = v.duration && isFinite(v.duration) ? v.duration : 0;
  if (!dur) throw new Error('Video အရှည်ကို ဖတ်လို့ မရပါ');
  const all = [];
  for (let i = 0; i < samples; i++) {
    const t = dur * (0.04 + 0.92 * (i + 0.5) / samples);
    await seek(v, t);
    const c = toCanvas(v, 480);
    let face = null, fs = 0;
    if (det) {
      try {
        const faces = (det.detect(c).detections || [])
          .map(d => ({ b: d.boundingBox, s: (d.categories && d.categories[0] && d.categories[0].score) || 0 }))
          .filter(f => f.b && f.s >= 0.55);
        if (faces.length) {
          const big = faces.reduce((a, b) => (b.b.width * b.b.height > a.b.width * a.b.height ? b : a));
          face = { x: big.b.originX / c.width, y: big.b.originY / c.height, w: big.b.width / c.width, h: big.b.height / c.height };
          const area = face.w * face.h;
          // a large face = close-up of a character; crowds and tiny faces score lower
          fs = Math.min(area, 0.25) * 400 + big.s * 20 - (faces.length > 3 ? 15 : 0) - (face.y + face.h > 0.85 ? 10 : 0);
        }
      } catch {}
    }
    all.push({ t, face, s: fs + quality(c) * 0.6, img: c.toDataURL('image/jpeg', 0.82) });
    if (onProgress) onProgress((i + 1) / samples);
  }
  v.removeAttribute('src'); v.load();
  const withFace = all.filter(f => f.face);
  const pool = (withFace.length >= 3 ? withFace : all).sort((a, b) => b.s - a.s);
  const pick = [];
  for (const gap of [dur * 0.08, dur * 0.04, 0]) {
    for (const f of pool) if (pick.length < keep && !pick.includes(f) && pick.every(p => Math.abs(p.t - f.t) >= gap)) pick.push(f);
  }
  return { dur, faces: withFace.length, shots: pick };
}

/**
 * The chosen frame, full size, as a JPEG for ChatGPT. The bottom band (where recap videos burn in their
 * subtitles) is cut off, but never into the character's face.
 */
export async function shotBlob(src, shot) {
  const c = await shotCanvas(src, shot);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
}
// the chosen frame at full size, bottom subtitle band cut off (never into the face)
export async function shotCanvas(src, shot) {
  const v = await openVideo(src);
  await seek(v, shot.t);
  const W = Math.min(1920, v.videoWidth), H = Math.round(W * v.videoHeight / v.videoWidth);
  const faceBottom = shot.face ? shot.face.y + shot.face.h : 0;
  const cut = Math.max(0, Math.min(0.18, 1 - faceBottom - 0.04));
  const h = Math.round(H * (1 - cut));
  const c = document.createElement('canvas'); c.width = W; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, v.videoWidth, v.videoHeight * (1 - cut), 0, 0, W, h);
  v.removeAttribute('src'); v.load();
  c.faceCut = cut;
  return c;
}

/* ---- ready-made thumbnail: the shot cropped to the platform's shape, with the Burmese title on top ---- */
export const THUMB_SIZES = { '9:16': [720, 1280], '3:4': [960, 1280], '16:9': [1280, 720] };
// split a Burmese title into at most 2 lines that fit maxW (by words, else by letters)
function wrapTitle(ctx, text, maxW) {
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter('my', { granularity: 'grapheme' }).segment(text)].map(x => x.segment) : [...text];
  const words = text.includes(' ') ? text.split(/\s+/) : null;
  const pieces = words && words.every(w => ctx.measureText(w).width <= maxW) ? words.map((w, i) => (i ? ' ' : '') + w) : seg;
  const lines = ['']; for (const p of pieces) {
    const tryL = lines[lines.length - 1] + p;
    if (ctx.measureText(tryL.trim()).width <= maxW || !lines[lines.length - 1]) lines[lines.length - 1] = tryL;
    else lines.push(p.trimStart());
  }
  return lines.map(l => l.trim()).filter(Boolean);
}
/**
 * frame: canvas from shotCanvas(); face: {x,y,w,h} 0..1 of the original frame or null; title: Burmese text
 * ratio: key of THUMB_SIZES; font: CSS font family (already loaded).
 * subTop: where the video's burned-in subtitles start (0..1 of the original frame), kept out of the picture.
 * Returns a canvas.
 */
export function composeThumb(frame, face, title, ratio, font, { subTop = 0 } = {}) {
  const [TW, TH] = THUMB_SIZES[ratio] || THUMB_SIZES['16:9'];
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const ctx = c.getContext('2d');
  // crop: cover the canvas, centred on the face, with the face a little below the middle (room for the title)
  const cut = frame.faceCut || 0, fw = frame.width;
  // usable height: above the subtitles, but never cutting into the face
  const faceBot = face ? (face.y + face.h) / (1 - cut) + 0.02 : 0;
  const keep = subTop > 0.4 ? Math.min(1, Math.max(subTop / (1 - cut) - 0.01, faceBot)) : 1;
  const fh = frame.height, uh = fh * keep, sc = Math.max(TW / fw, TH / uh);
  const fx = face ? (face.x + face.w / 2) * fw : fw / 2;
  const fy = face ? Math.min(1, (face.y + face.h / 2) / (1 - cut)) * fh : fh * 0.45;
  let ox = TW / 2 - fx * sc, oy = TH * (TH > TW ? 0.56 : 0.52) - fy * sc;
  ox = Math.min(0, Math.max(TW - fw * sc, ox)); oy = Math.min(0, Math.max(TH - uh * sc, oy));
  ctx.drawImage(frame, ox, oy, fw * sc, fh * sc);
  // light grade: a bit more contrast, dark top for the title, soft vignette
  const top = ctx.createLinearGradient(0, 0, 0, TH * 0.42);
  top.addColorStop(0, 'rgba(0,0,0,.78)'); top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top; ctx.fillRect(0, 0, TW, TH * 0.42);
  const vg = ctx.createRadialGradient(TW / 2, TH / 2, Math.min(TW, TH) * 0.35, TW / 2, TH / 2, Math.hypot(TW, TH) * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, TW, TH);
  // title: big yellow letters with a thick dark outline, up to 2 lines, shrunk until it fits
  const t = String(title || '').trim();
  if (t) {
    const maxW = TW * 0.88;
    let size = Math.round(Math.min(TW, TH) * (TW > TH ? 0.13 : 0.12)), lines;
    for (; size > 18; size -= 2) {
      ctx.font = `${size}px ${font}`;
      lines = wrapTitle(ctx, t, maxW);
      if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= maxW)) break;
    }
    ctx.font = `${size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    const lh = size * 1.55, y0 = TH * 0.045;
    lines.slice(0, 2).forEach((l, i) => {
      const y = y0 + i * lh;
      ctx.shadowColor = 'rgba(255,190,0,.55)'; ctx.shadowBlur = size * 0.35;
      ctx.lineWidth = size * 0.2; ctx.strokeStyle = '#120a00'; ctx.strokeText(l, TW / 2, y);
      ctx.shadowBlur = 0;
      const g = ctx.createLinearGradient(0, y, 0, y + size * 1.3);
      g.addColorStop(0, '#fff6b0'); g.addColorStop(0.45, '#ffd21f'); g.addColorStop(1, '#ff9f00');
      ctx.fillStyle = g; ctx.fillText(l, TW / 2, y);
    });
  }
  // thin gold frame
  const m = Math.round(Math.min(TW, TH) * 0.025), lw = Math.max(3, Math.round(Math.min(TW, TH) * 0.007)), r = m * 1.4;
  ctx.lineWidth = lw; ctx.strokeStyle = '#e8b64a';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(m, m, TW - 2 * m, TH - 2 * m, r) : ctx.rect(m, m, TW - 2 * m, TH - 2 * m); ctx.stroke();
  return c;
}

// what the user pastes into ChatGPT together with the picture
// Premium: 5 Burmese titles from Gemini (one per line)
export function titlesPrompt(burmese) {
  const story = burmese.filter(Boolean).join(' ').slice(0, 6000);
  return `Read this Burmese movie-recap story and write 5 short, catchy Burmese thumbnail titles for YouTube / TikTok.
Rules for the titles: spoken Burmese (not formal written style), 12-25 characters each, no emoji, no hashtags, no numbering, no quotes. Each title must make a Burmese viewer NEED to click: use a different hook for each one — a secret (…ရဲ့ လျှို့ဝှက်ချက်), a shocking twist or reveal, a strong emotion (betrayal, revenge, forbidden love), a mystery question, or an underdog / rich-poor contrast. Name the key character by role (အဖေ၊ သမီး၊ ဆင်းရဲသား၊ သူဌေးမ …), never by a foreign name. Tease, but never give away the ending.
Return ONLY a JSON object: {"titles": ["...", "...", "...", "...", "..."]}

Story:
${story}`;
}
export function parseTitles(text) {
  try {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    const t = JSON.parse(text.slice(a, b + 1)).titles;
    if (Array.isArray(t)) return t.map(x => String(x).trim()).filter(Boolean).slice(0, 5);
  } catch {}
  return text.split('\n').map(x => x.replace(/^\s*[\d.)\-•]+\s*/, '').replace(/^["“]|["”]$/g, '').trim()).filter(Boolean).slice(0, 5);
}
// Premium: post caption + hashtags for TikTok / Facebook
export function captionPrompt(burmese) {
  const story = burmese.filter(Boolean).join(' ').slice(0, 6000);
  return `Read this Burmese movie-recap story and write the post text for uploading the video to TikTok / Facebook.
Rules for the caption: spoken Burmese, 2-4 short lines. Line 1 is a hook (a question or a surprising fact from the story) that stops the scroll. Then 1-2 lines on the setup and the conflict, with real details from this story, without the ending. Last line asks people to watch to the end or follow (for example ဇာတ်သိမ်းကို အဆုံးထိ ကြည့်ပါ). At most 2 fitting emoji. Hashtags: 6-10 — 2-3 Burmese ones about the story and genre (e.g. #ဇာတ်လမ်းအကျဉ်း #အချစ်ဇာတ်လမ်း), plus #movierecap #shortdrama #myanmar #fyp.
Return ONLY a JSON object: {"caption": "...", "hashtags": ["#...", "#..."]}

Story:
${story}`;
}
export function parseCaption(text) {
  try {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    const o = JSON.parse(text.slice(a, b + 1));
    const tags = (Array.isArray(o.hashtags) ? o.hashtags : []).map(t => '#' + String(t).trim().replace(/^#+/, '').replace(/\s+/g, '')).filter(t => t.length > 1);
    if (o.caption) return String(o.caption).trim() + (tags.length ? '\n\n' + tags.join(' ') : '');
  } catch {}
  return text.trim();
}
// Premium, right after the video: titles + caption in one AI call
export function packPrompt(burmese) {
  const story = burmese.filter(Boolean).join(' ').slice(0, 6000);
  return `Read this Burmese movie-recap story. Write (1) 5 thumbnail titles and (2) the TikTok / Facebook post caption with hashtags.
Rules for the titles: spoken Burmese (not formal written style), 12-25 characters each, no emoji, no hashtags, no numbering, no quotes. Each title must make a Burmese viewer NEED to click: use a different hook for each one — a secret (…ရဲ့ လျှို့ဝှက်ချက်), a shocking twist or reveal, a strong emotion (betrayal, revenge, forbidden love), a mystery question, or an underdog / rich-poor contrast. Name the key character by role (အဖေ၊ သမီး၊ ဆင်းရဲသား၊ သူဌေးမ …), never by a foreign name. Tease, but never give away the ending.
Rules for the caption: spoken Burmese, 2-4 short lines. Line 1 is a hook (a question or a surprising fact from the story) that stops the scroll. Then 1-2 lines on the setup and the conflict, with real details from this story, without the ending. Last line asks people to watch to the end or follow (for example ဇာတ်သိမ်းကို အဆုံးထိ ကြည့်ပါ). At most 2 fitting emoji. Hashtags: 6-10 — 2-3 Burmese ones about the story and genre (e.g. #ဇာတ်လမ်းအကျဉ်း #အချစ်ဇာတ်လမ်း), plus #movierecap #shortdrama #myanmar #fyp.
Return ONLY a JSON object: {"titles": ["...", "...", "...", "...", "..."], "caption": "...", "hashtags": ["#...", "#..."]}

Story:
${story}`;
}

// prompt with the title already chosen: ChatGPT goes straight to drawing
export function chatgptPromptWithTitle(title) {
  return `I attached a frame from a movie. Create a YouTube / TikTok movie-recap thumbnail now (no questions):
- Re-create the main character from the attached frame as a high-quality 3D animated movie character (Pixar / Disney style): same face features, hair, clothes, expression and setting, but more dramatic and eye-catching, cinematic lighting, sharp details.
- Vertical 3:4, the highest resolution you can (Full HD quality or better).
- Put this Burmese title on the image, exactly as written, correct Myanmar Unicode spelling, big bold readable letters in an eye-catching design (strong outline / glow), not covering the face:
${title}
- No other text, subtitles, watermark or logo. Remove any text that is in the attached frame.`;
}

export function chatgptPrompt(burmese) {
  const story = burmese.filter(Boolean).join(' ').slice(0, 1800);
  return `I attached a frame from a movie. I am making a Burmese (Myanmar) movie-recap video about it and need a YouTube / TikTok thumbnail.

STEP 1 — Reply in Burmese. Do not make the image yet.
Read the story below, then give me:
A) 5 short, catchy Burmese thumbnail titles (spoken style, about 15–25 characters, makes people curious, no spoilers, no emoji).
B) 5 thumbnail design styles, each with a short name and one line describing the look (text colour, outline, position, mood / background).
Number them and ask me to choose one title and one design.

STEP 2 — After I choose, create the thumbnail image:
- Re-create the main character from the attached frame as a high-quality 3D animated movie character (Pixar / Disney style): same face features, hair, clothes, expression and setting, but more dramatic and eye-catching, cinematic lighting, sharp details.
- Vertical 3:4, the highest resolution you can (Full HD quality or better).
- Put the Burmese title I chose on the image in the design I chose: exactly as written, correct Myanmar Unicode spelling, big bold readable letters. Do not cover the character's face.
- No other text, subtitles, watermark or logo. Remove any text that is in the attached frame.

Story (Burmese):
${story}`;
}
