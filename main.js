import './style.css';
import * as L from './lib.js';

const $ = (s, r = document) => r.querySelector(s);
const state = {
  step: 1, file: null, videoDur: 0, lang: 'zh', segs: [], sourceLines: [],
  burmese: [], personaId: 'BB', pitch: 0, keepTalk: 0.05, keepGap: 1, offset: 0, maxTempo: 1.7, dubGain: 1.6, result: null, busy: false
};
const STEPS = ['Upload', 'Source Text', 'Burmese', 'Result'];
const view = $('#view');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
const bar = () => `<div class="bar"><i id="fill"></i></div><div class="pct"><span id="ptxt">…</span><b id="pnum">0%</b></div>`;
function setProg(frac, text) {
  const f = $('#fill'); if (!f) return;
  f.style.width = Math.round(frac * 100) + '%';
  $('#pnum').textContent = Math.round(frac * 100) + '%';
  if (text) $('#ptxt').textContent = text;
}
const showErr = (e) => { const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message || String(e); view.appendChild(d); };
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

const canGo = n => !state.busy && n !== state.step &&
  (n === 1 || (n === 2 && state.segs.length > 0) || (n === 3 && state.burmese.length > 0) || (n === 4 && !!state.result));
function renderStepper() {
  $('#stepper').innerHTML = STEPS.map((s, i) => {
    const n = i + 1, cls = n === state.step ? 'on' : n < state.step ? 'done' : '';
    return `<span class="${cls} ${canGo(n) ? 'link' : ''}" data-n="${n}"><b>${n}</b>${s}</span>`;
  }).join('');
  $('#stepper').querySelectorAll('.link').forEach(el => { el.onclick = () => go(+el.dataset.n); });
}
function go(step) { state.step = step; render(); window.scrollTo(0, 0); }
function render() { renderStepper(); [null, step1, step2, step3, step4][state.step](); }

/* ---------------- Step 1 ---------------- */
function step1() {
  view.innerHTML = `
    <h2>Step 1: Video တင်ပါ</h2>
    <p class="muted">Recap လုပ်မည့် video ကို ရွေးချယ်ပါ။ (အသံကို အရင်ဆွဲထုတ်ပါမည်)</p>
    <label class="drop ${state.file ? 'has' : ''}" for="f">
      <input id="f" type="file" accept="video/*" hidden />
      <b>${state.file ? state.file.name : 'နှိပ်၍ Video File ရွေးချယ်ပါ'}</b>
      <span class="muted small">${state.file ? (state.file.size / 1048576).toFixed(1) + ' MB' : 'MP4, MOV, WEBM, MKV · ၁၀ မိနစ်အထိ'}</span>
    </label>
    <label>မူရင်းစကားပြောဘာသာ
      <select id="lang">
        ${[['zh', 'Chinese 中文'], ['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['auto', 'Auto detect']]
          .map(([v, t]) => `<option value="${v}" ${v === state.lang ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>
    <button id="next" class="btn primary" ${state.file ? '' : 'disabled'}>Step 1: စာသားထုတ်မည် (Next)</button>`;
  $('#f').onchange = e => { state.file = e.target.files[0] || null; state.segs = []; L.forgetInput(); step1(); };
  $('#lang').onchange = e => { state.lang = e.target.value; };
  $('#next').onclick = () => {
    if (!L.cfg.workerUrl || !L.cfg.aaiKey) { toast('Settings ထဲမှာ key အရင်ထည့်ပါ'); $('#settings').showModal(); return; }
    state.segs.length ? go(2) : transcribeFlow();
  };
}

async function transcribeFlow() {
  state.step = 2; state.busy = true; renderStepper();
  view.innerHTML = `<h2>စာသား ထုတ်နေသည်…</h2><p class="muted">Video ကို ဖွင့်မထားဘဲ ခဏစောင့်ပါ။</p>${bar()}`;
  try {
    setProg(0.02, 'Engine ပြင်ဆင်နေသည်');
    await L.getFFmpeg();
    state.videoDur = await L.videoDuration(state.file);
    setProg(0.05, 'အသံ ဆွဲထုတ်နေသည်');
    const wav = await L.extractAudio(state.file, p => setProg(0.05 + p * 0.2, 'အသံ ဆွဲထုတ်နေသည်'));
    const names = { uploading: 'AssemblyAI သို့ တင်နေသည်', queued: 'တန်းစီစောင့်နေသည်', processing: 'စာသားပြောင်းနေသည်' };
    let tick = 0.3;
    state.segs = await L.transcribe(wav, state.lang, st => { tick = Math.min(tick + 0.04, 0.95); setProg(tick, names[st] || st); });
    state.burmese = []; state.busy = false;
    go(2);
  } catch (e) {
    view.innerHTML = `<h2>အမှားရှိနေပါသည်</h2>`; showErr(e);
    state.busy = false; renderStepper();
    view.insertAdjacentHTML('beforeend', `<button class="btn primary" id="back">Upload သို့ ပြန်သွားမည်</button>`);
    $('#back').onclick = () => go(1);
  }
}

/* ---------------- Step 2 ---------------- */
function step2() {
  view.innerHTML = `
    <div class="row"><h2>Step 2: မူရင်းစာသားကို စစ်ဆေးပါ</h2><button class="ghost" id="back">Back</button></div>
    <p class="muted">စာကြောင်းတစ်ကြောင်းလျှင် အချိန်တစ်ခု ကိုက်ထားသည်။ စာကြောင်းအရေအတွက် မပြောင်းပါနှင့်။ (${state.segs.length} lines)</p>
    <textarea id="src">${state.segs.map(s => s.text).join('\n').replace(/</g, '&lt;')}</textarea>
    <button id="copy" class="btn block">📋 Copy Full Prompt</button>
    <div class="panel">
      <b>🤖 Gemini App ဖြင့် ဘာသာပြန်ရန် (Free)</b>
      <p class="muted small">Prompt ကို Copy ကူးပြီး Gemini တွင် Paste လုပ်ပါ။ ရလာသော JSON ကို အောက်တွင် ထည့်ပါ။</p>
      <a class="link" href="https://gemini.google.com/app" target="_blank" rel="noopener">Gemini App ဖွင့်မည် ↗</a>
      <label>Gemini မှ ရလာသော JSON
        <textarea id="json" class="short" placeholder='{"translations": ["မြန်မာစာ ၁", "မြန်မာစာ ၂", ...]}'></textarea>
      </label>
      <button id="next" class="btn primary">Step 2: ဘာသာပြန်အတည်ပြုမည် (Next)</button>
    </div>`;
  if (state.burmese.length) $('#json').value = JSON.stringify({ translations: state.burmese }, null, 1);
  $('#src').oninput = () => {
    const l = $('#src').value.split('\n').map(x => x.trim());
    if (l.length === state.segs.length) l.forEach((t, i) => { state.segs[i].text = t; });
  };
  const syncSrc = () => {
    const lines = $('#src').value.split('\n').map(x => x.trim());
    if (lines.length !== state.segs.length) { toast(`စာကြောင်း ${lines.length} / ${state.segs.length} မကိုက်ပါ`); return false; }
    lines.forEach((t, i) => { state.segs[i].text = t; });
    return true;
  };
  $('#back').onclick = () => go(1);
  $('#copy').onclick = async () => {
    if (!syncSrc()) return;
    const text = L.buildPrompt(state.segs);
    try { await navigator.clipboard.writeText(text); toast('Prompt ကူးပြီးပါပြီ'); }
    catch { $('#json').value = text; toast('ကူးမရပါ — အောက်ကနေ ရွေးကူးပါ'); }
  };
  $('#next').onclick = () => {
    try {
      const t = L.parseTranslations($('#json').value);
      if (t.length !== state.segs.length) toast(`အရေအတွက် မကိုက်ပါ (${t.length}/${state.segs.length}) — Step 3 မှာ ပြင်ပါ`);
      state.burmese = state.segs.map((_, i) => t[i] || '');
      go(3);
    } catch (e) { toast(e.message); }
  };
}

/* ---------------- Step 3 ---------------- */
let previewAudio;
function step3() {
  const voices = L.PERSONAS.map(p => `
    <div class="voice ${p.id === state.personaId ? 'sel' : ''}" data-id="${p.id}">
      <div class="av ${p.g === 'Male' ? 'm' : 'f'}">${p.id}</div>
      <b>${p.name}</b><small>${p.g}</small>
      <button data-prev="${p.id}">▶ Preview</button>
    </div>`).join('');
  view.innerHTML = `
    <div class="row"><h2>Step 3: မြန်မာဘာသာပြန်ကို စစ်ဆေးပါ</h2><button class="ghost" id="back">Back</button></div>
    <p class="muted">တစ်ကြောင်းလျှင် စာတစ်ကြောင်း။ (${state.segs.length} lines)</p>
    <textarea id="mm" style="min-height:300px">${state.burmese.join('\n').replace(/</g, '&lt;')}</textarea>
    <div class="row" style="margin-top:20px"><b>အသံရွေးချယ်ပါ</b><span class="muted small">${L.PERSONAS.length} Voice Personas</span></div>
    <div class="voices">${voices}</div>
    <div class="panel">
      <div class="row"><b>ဝါး/ကြည် (Pitch Offset)</b><span id="pv">${state.pitch >= 0 ? '+' : ''}${state.pitch}Hz</span></div>
      <input id="pitch" type="range" min="-30" max="30" value="${state.pitch}" />
      <div class="row muted small"><span>-30Hz (ဝါး)</span><span>+30Hz (ကြည်)</span></div>
      <div class="row" style="margin-top:14px"><b>🎬 စကားမပြောတဲ့နေရာ မူရင်းအသံ</b><span id="gv">${Math.round(state.keepGap * 100)}%</span></div>
      <input id="gap" type="range" min="0" max="100" value="${state.keepGap * 100}" />
      <div class="row" style="margin-top:14px"><b>🗣 စကားပြောနေစဉ် မူရင်းအသံ</b><span id="tv">${Math.round(state.keepTalk * 100)}%</span></div>
      <input id="talk" type="range" min="0" max="50" value="${state.keepTalk * 100}" />
      <p class="muted small">Action၊ ဂီတ၊ ဆူညံသံ အပိုင်းတွေကို မူရင်းအသံနဲ့ ပြန်ကြားရမယ်။ နှစ်ခုလုံး 0% ထားရင် မူရင်းအသံ လုံးဝမပါပါ။</p>
      <details style="margin-top:12px"><summary><b>⚙ ပိုမိုချိန်ညှိရန်</b></summary>
        <div class="row" style="margin-top:12px"><b>⏱ မြန်မာသံ အချိန်ရွှေ့</b><span id="ov">${state.offset.toFixed(1)}s</span></div>
        <input id="offs" type="range" min="-10" max="10" value="${Math.round(state.offset * 10)}" />
        <p class="muted small">အနှုတ် = စောစေ၊ အပေါင်း = နောက်ဆုတ်</p>
        <div class="row"><b>🚀 အမြန်ဆုံး အသံမြန်နှုန်း</b><span id="mv">${state.maxTempo.toFixed(1)}×</span></div>
        <input id="mtempo" type="range" min="12" max="20" value="${Math.round(state.maxTempo * 10)}" />
        <div class="row" style="margin-top:12px"><b>🔊 မြန်မာသံ ပမာဏ</b><span id="dv">${Math.round(state.dubGain * 100)}%</span></div>
        <input id="dgain" type="range" min="100" max="250" value="${Math.round(state.dubGain * 100)}" />
      </details>
    </div>
    <button id="next" class="btn primary">Step 3: အသံထုတ်ပြီး Video ပေါင်းမည်</button>`;

  const read = () => {
    const lines = $('#mm').value.split('\n').map(x => x.trim());
    return lines;
  };
  $('#mm').oninput = () => { state.burmese = read(); };
  $('#back').onclick = () => { state.burmese = read(); go(2); };
  $('#pitch').oninput = e => { state.pitch = +e.target.value; $('#pv').textContent = (state.pitch >= 0 ? '+' : '') + state.pitch + 'Hz'; };
  $('#gap').oninput = e => { state.keepGap = +e.target.value / 100; $('#gv').textContent = e.target.value + '%'; };
  $('#talk').oninput = e => { state.keepTalk = +e.target.value / 100; $('#tv').textContent = e.target.value + '%'; };
  $('#offs').oninput = e => { state.offset = +e.target.value / 10; $('#ov').textContent = state.offset.toFixed(1) + 's'; };
  $('#mtempo').oninput = e => { state.maxTempo = +e.target.value / 10; $('#mv').textContent = state.maxTempo.toFixed(1) + '×'; };
  $('#dgain').oninput = e => { state.dubGain = +e.target.value / 100; $('#dv').textContent = e.target.value + '%'; };
  view.querySelectorAll('.voice').forEach(el => el.onclick = e => {
    if (e.target.dataset.prev) return;
    state.personaId = el.dataset.id;
    view.querySelectorAll('.voice').forEach(v => v.classList.toggle('sel', v === el));
  });
  view.querySelectorAll('[data-prev]').forEach(b => b.onclick = async () => {
    const p = L.PERSONAS.find(x => x.id === b.dataset.prev);
    b.textContent = '…';
    try {
      const ab = await L.tts('မင်္ဂလာပါ၊ ဒီအသံနဲ့ ဇာတ်ကြောင်းကို ပြောပြပေးပါမယ်။', p, state.pitch);
      previewAudio?.pause();
      previewAudio = new Audio(URL.createObjectURL(new Blob([ab], { type: 'audio/mpeg' })));
      previewAudio.play();
    } catch (e) { toast(e.message.slice(0, 80)); }
    b.textContent = '▶ Preview';
  });
  $('#next').onclick = () => {
    state.burmese = read();
    if (state.burmese.length !== state.segs.length) {
      toast(`စာကြောင်း ${state.burmese.length} / ${state.segs.length} မကိုက်ပါ`); return;
    }
    state.result = null;
    go(4);
  };
}

/* ---------------- Step 4 ---------------- */
async function step4() {
  if (state.result) return showResult();
  state.busy = true; renderStepper();
  view.innerHTML = `<h2>Step 4: Video ပေါင်းနေသည်…</h2>
    <p class="muted">ဒီ tab ကို ဖွင့်ထားပါ၊ screen မပိတ်ပါနှင့်။</p>${bar()}`;
  let wake; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  try {
    const persona = L.PERSONAS.find(p => p.id === state.personaId);
    const { video, placed, fellBack, stats } = await L.renderDub({
      file: state.file, videoDur: state.videoDur, segs: state.segs, burmese: state.burmese,
      persona, pitch: state.pitch, keepTalk: state.keepTalk, keepGap: state.keepGap,
      offset: state.offset, maxTempo: state.maxTempo, dubGain: state.dubGain, onProgress: setProg
    });
    state.result = { video, url: URL.createObjectURL(video), srt: L.buildSrt(state.burmese, placed), stats };
    showResult();
    if (fellBack) toast('မူရင်းအသံ ရောစပ်မရလို့ မြန်မာအသံချည်းပဲ ထည့်ထားပါတယ်');
  } catch (e) {
    view.innerHTML = `<h2>အမှားရှိနေပါသည်</h2>`; showErr(e);
    view.insertAdjacentHTML('beforeend', `<button class="btn primary" id="retry">ပြန်စမည်</button>
      <label class="btn block" for="repick" style="display:block;text-align:center;cursor:pointer">🎞 Video ပြန်ရွေးပြီး ပြန်စမည်<input id="repick" type="file" accept="video/*" hidden /></label>
      <button class="btn block" id="back">Step 3 သို့ ပြန်သွားမည်</button>`);
    $('#retry').onclick = () => step4();
    $('#repick').onchange = async ev => {
      const nf = ev.target.files[0]; if (!nf) return;
      try { await L.forgetInput(); state.file = nf; state.videoDur = await L.videoDuration(nf); } catch (e2) { toast(e2.message); return; }
      step4();
    };
    $('#back').onclick = () => go(3);
  } finally { wake?.release?.(); state.busy = false; renderStepper(); }
}

function showResult() {
  view.innerHTML = `
    <h2>Step 4: ရလဒ်များ (Results)</h2>
    <video src="${state.result.url}" controls playsinline></video>
    <p class="muted small">${state.result.stats && state.result.stats.lateCount
      ? `⏱ နောက်ကျတဲ့ စာကြောင်း ${state.result.stats.lateCount} ကြောင်း (အများဆုံး ${state.result.stats.maxDrift.toFixed(1)} စက္ကန့်)။ ဘာသာပြန်စာကို တိုအောင်ပြင်ရင် ပိုကိုက်ပါမယ်။`
      : '✅ မြန်မာသံ အချိန်ကိုက်ညီပါတယ်'}</p>
    <button id="dl" class="btn primary">⬇ Video Download (.mp4)</button>
    <button id="srt" class="btn block">Download Subtitles (.srt)</button>
    <div class="row" style="margin-top:14px">
      <button id="back" class="ghost">‹ အသံရွေးချယ်မှုသို့</button>
      <button id="again" class="ghost">Video အသစ်</button>
    </div>`;
  const base = state.file.name.replace(/\.[^.]+$/, '');
  $('#dl').onclick = () => download(state.result.video, base + '_recap.mp4');
  $('#srt').onclick = () => download(new Blob([state.result.srt], { type: 'text/plain' }), base + '_burmese.srt');
  $('#back').onclick = () => { state.result = null; go(3); };
  $('#again').onclick = () => { Object.assign(state, { file: null, segs: [], burmese: [], result: null }); go(1); };
}

/* ---------------- settings ---------------- */
const dlg = $('#settings');
$('#openSettings').onclick = () => {
  $('#workerUrl').value = localStorage.getItem('workerUrl') || '';
  $('#aaiKey').value = localStorage.getItem('aaiKey') || '';
  dlg.showModal();
};
$('#saveSettings').onclick = () => {
  localStorage.setItem('workerUrl', $('#workerUrl').value.trim());
  localStorage.setItem('aaiKey', $('#aaiKey').value.trim());
  toast('သိမ်းပြီးပါပြီ');
};

render();
if (!L.cfg.workerUrl || !L.cfg.aaiKey) $('#openSettings').click();
