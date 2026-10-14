import { createReadStream, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// same isolation headers as public/_headers, so the multi-core engine also works with `npm run dev` / `preview`
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

// MediaPipe face-detector engine (wasm), served from our own site at /mediapipe/ (no CDN: works with require-corp).
// Copied from node_modules at build time so the ~13 MB files are not kept in the repository.
const MP_DIR = 'node_modules/@mediapipe/tasks-vision/wasm';
const MP_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
const mediapipe = {
  name: 'mediapipe-wasm',
  configureServer(server) {
    server.middlewares.use('/mediapipe/', (req, res, next) => {
      const f = (req.url || '').replace(/^\//, '').split('?')[0];
      if (!MP_FILES.includes(f)) return next();
      res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      createReadStream(join(MP_DIR, f)).pipe(res);
    });
  },
  writeBundle(opts) {
    const out = join(opts.dir || 'dist', 'mediapipe');
    mkdirSync(out, { recursive: true });
    for (const f of MP_FILES) if (existsSync(join(MP_DIR, f))) copyFileSync(join(MP_DIR, f), join(out, f));
  }
};

export default {
  plugins: [mediapipe],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation }
};
