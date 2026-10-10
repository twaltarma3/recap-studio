import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

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
