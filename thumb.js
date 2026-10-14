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
  const v = await openVideo(src);
  await seek(v, shot.t);
  const W = Math.min(1920, v.videoWidth), H = Math.round(W * v.videoHeight / v.videoWidth);
  const faceBottom = shot.face ? shot.face.y + shot.face.h : 0;
  const cut = Math.max(0, Math.min(0.18, 1 - faceBottom - 0.04));
  const h = Math.round(H * (1 - cut));
  const c = document.createElement('canvas'); c.width = W; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, v.videoWidth, v.videoHeight * (1 - cut), 0, 0, W, h);
  v.removeAttribute('src'); v.load();
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
}

// what the user pastes into ChatGPT together with the picture
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
