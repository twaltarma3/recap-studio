// same isolation headers as public/_headers, so the multi-core engine also works with `npm run dev` / `preview`
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default {
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation }
};
