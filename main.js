import './style.css';
import './theme.css';
import './mobile.css';
import './design.css';
import { startIcons } from './icons.js';
import * as L from './lib.js';
import * as H from './history.js';
import * as T from './thumb.js';

const $ = (s, r = document) => r.querySelector(s);
// what the 🔒 switch on step 1 unlocks (kept at their defaults until then)
const LOCK_T = 'အချိုး · Zoom · 720p · Blur · Freeze ပြင်မည်';
const DEFAULTS = { pitch: 10, rate: 25, keepTalk: 0, keepGap: 0.3, offset: 0, maxTempo: 2.0, dubGain: 1.8 };
const state = {
  step: 1, showSrc: false, file: null, videoDur: 0, lang: 'auto', segs: [], sourceLines: [],
  burmese: [], genders: null, audioBlob: null, personaId: 'TH', ...DEFAULTS, result: null, busy: false, origSegs: null,
  fxMirror: false, fxBlur: true, blurH: 15, blurY: 100, blurS: 50, blurO: 100, previewUrl: null, previewFor: null,
  pStyle: 'chat', fxRatio: 'orig', fxFit: 'crop', fxZoom: 100, fxFast: true, fxHD: false, fxFps30: true, fxUnlock: false, wmOn: false, wmText: '', wmPos: 'br', wmSize: 4, wmOp: 75,
  logoOn: false, logoData: null, logoPos: 'tr', logoSize: 14, tab: 'video',
  frzOn: false, frzA: 4, frzB: 2, frzZoom: 'out', frzAmt: 20,
  fxSubs: false, subS: 4, subY: 88, subC: '#ffffff', subO: '#000000', subFont: 'akk', fontOk: false
};
// access codes: on only when the Worker has them set up (accessCheck answers something other than {open:true})
const acc = { on: false, ok: false, name: '', limit: 0, used: 0, left: -1, plan: 'free', expires: 0, credits: 0 };
const setQuota = r => (L.setCpm(r.cpm), Object.assign(acc, { ok: true, name: r.name || '', limit: r.limit || 0, used: r.used || 0, left: r.left ?? -1,
  ...(r.plan ? { plan: r.plan, expires: r.expires || 0, credits: r.credits || 0 } : {}) }));
// Premium is paid per video (credits); a video already paid keeps its premium features after the last credit is used
// Premium: every finished video is paid. Making a video again after it came out (to change the voice, text,
// effects…) is a new job, so it is paid again; retrying after an error stays on the same job and is free.
// The count is kept per file in the browser, so reloading the page doesn't reset it.
const baseJob = () => (state.file ? `${state.file.name}|${state.file.size}` : '');
const renders = k => { try { return JSON.parse(localStorage.getItem('rn:' + k)) || { n: 0, done: false }; } catch { return { n: 0, done: false }; } };
const saveRenders = (k, r) => { try { localStorage.setItem('rn:' + k, JSON.stringify(r)); } catch {} };
const jobId = () => { const b = baseJob(), r = b && premPlan() ? renders(b) : null; return r && r.n ? `${b}#${r.n}` : b; };
L.premium.job = jobId;
const premPlan = () => acc.on && acc.ok && acc.plan === 'premium';
const isPremium = () => premPlan() && (acc.credits > 0 || L.premium.on);
const dateTxt = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysLeft = ms => Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
const fmtN = n => Number(n || 0).toLocaleString('en-US');
const creditTxt = n => `Credit ${fmtN(n)} ကျန် (≈ ${Math.floor((n || 0) / L.CPM)} မိနစ်)`;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
// premium: what this video will cost, shown before transcription / render
function costLine(el, secs) {
  if (!el || !premPlan() || !secs) return;
  const need = L.creditCost(secs), short = need > acc.credits;
  el.hidden = false;
  el.className = short ? 'err small' : 'muted small';
  el.innerHTML = `💎 ${mmss(secs)} video = <b>${fmtN(need)} credit</b>${short ? ` — ကျန် ${fmtN(acc.credits)} ပဲ ရှိပါတယ်` : ` · ကျန် ${fmtN(acc.credits)}`}`;
}
const quotaTxt = () => premPlan() ? creditTxt(acc.credits) : acc.limit > 0 ? `ယနေ့ ကျန် ${acc.left}/${acc.limit} ပုဒ်` : 'အကန့်အသတ် မရှိ';
const STEPS = ['ဗီဒီယိုတင်', 'မူရင်းစာသား', 'ဘာသာပြန်', 'ရလဒ်'];
const view = $('#view');
const selFont = () => (state.subFont === 'custom' && !state.fontOk) ? 'system' : state.subFont;
let page = 'free'; // 'free' | 'premium' | 'keys' | 'guide' | 'history'

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
// progress card: a ring with the %, what is happening now, the stages (One-Click Auto shows all four), time and tips
const PSTEPS = [['text', '📝', 'စာသားထုတ်'], ['tr', '✨', 'ဘာသာပြန်'], ['voice', '🎙', 'အသံထုတ်'], ['video', '🎬', 'Video ပေါင်း']];
const stageOf = t => /ဘာသာပြန်/.test(t) ? 'tr'
  : /မြန်မာအသံ|အသံကို|အသံတွေ/.test(t) ? 'voice'        // before 'video': "အသံကို ဗီဒီယိုအချိန်နဲ့ ညှိ…" is still the voice
  : /ဗီဒီယို|Video|Watermark|စာတန်းထိုး|သိမ်းနေ|ပြီးပါပြီ/.test(t) ? 'video' : 'text';
const RING = 2 * Math.PI * 54;
// the run's checklist: when each stage started and ended (One-Click Auto keeps it across its three pages)
let prun = null;
// seconds each stage took per minute of video on this phone, learnt from earlier runs (for the time left)
const stageRates = () => { try { return JSON.parse(localStorage.getItem('stageRates') || '{}') || {}; } catch { return {}; } };
function learnRates() {
  const mins = (state.videoDur || 0) / 60; if (!prun || !(mins > 0.1)) return;
  const r = stageRates();
  for (const k of prun.stages) if (prun.start[k] && prun.end[k]) { const v = (prun.end[k] - prun.start[k]) / 1000 / mins; r[k] = r[k] ? r[k] * 0.6 + v * 0.4 : v; }
  try { localStorage.setItem('stageRates', JSON.stringify(r)); } catch {}
}
const bar = (stages = state.autoRun ? PSTEPS.map(x => x[0]) : []) => {
  const key = stages.join();
  if (!prun || prun.key !== key || prun.done || !state.autoRun) prun = { key, stages, start: {}, end: {}, cur: null, t0: Date.now() };
  prun.phaseT0 = Date.now(); prun.f = 0;
  return `<div class="prog">
  <div class="prog-ring"><svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="pgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#009cfd"/><stop offset=".55" stop-color="#00c5fe"/><stop offset="1" stop-color="#f5c451"/></linearGradient></defs>
    <circle cx="60" cy="60" r="54" class="pr-track"/><circle cx="60" cy="60" r="54" class="pr-fill" id="pring" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${RING.toFixed(1)}"/>
  </svg><b id="pnum">0%</b></div>
  <div class="prog-now"><span id="ptxt">စတင်နေပါတယ်</span><span class="pdots"><i></i><i></i><i></i></span></div>
  <div class="prog-sub" id="psub"></div>
  <div class="bar"><i id="fill"></i></div>
  ${stages.length > 1 ? `<div class="prog-list">${PSTEPS.filter(x => stages.includes(x[0])).map(([k, ic, t]) => `<div data-st="${k}"><em>${ic}</em><span>${t}</span><small></small></div>`).join('')}</div>` : ''}
  <div class="ptime">⏱ ကြာချိန် <b id="ptime">0:00</b><span id="pleft"></span></div>
  <p class="prog-tip" id="ptip"></p>
</div>`;
};
// the video is out: close the checklist and keep how long each stage took on this phone
function finishRun() {
  if (!prun || prun.done) return;
  if (prun.cur) prun.end[prun.cur] = Date.now();
  prun.done = true; learnRates();
}
// time left: from earlier runs on this phone (each stage's seconds per minute of video) and from this page's
// speed so far; the larger of the two, since a page's % can creep near its end
function timeLeft() {
  if (!prun || !prun.cur || prun.done) return null;
  const now = Date.now(), el = (now - prun.phaseT0) / 1000, f = prun.f;
  const r = stageRates(), mins = (state.videoDur || 0) / 60, rest = prun.stages.slice(prun.stages.indexOf(prun.cur));
  const byRuns = mins && rest.every(k => r[k])
    ? rest.reduce((t, k) => t + (k === prun.cur ? Math.max(0, r[k] * mins - (now - prun.start[k]) / 1000) : r[k] * mins), 0) : null;
  let bySpeed = null;
  if (prun.cur !== 'text' && prun.cur !== 'tr' && f >= 0.05 && f < 1 && el >= 5) {   // their % only creeps while the server works
    const later = rest.slice(1).filter(k => !(prun.cur === 'voice' && k === 'video'));   // voice + video share one page
    if (later.every(k => r[k] && mins)) bySpeed = el * (1 - f) / f + later.reduce((t, k) => t + r[k] * mins, 0);
  }
  const left = Math.max(byRuns ?? -1, bySpeed ?? -1);
  return left < 0 ? null : Math.max(3, left);
}
function paintChecklist() {
  if (!prun) return;
  const rows = [...document.querySelectorAll('.prog-list > div')]; if (!rows.length) return;
  const r = stageRates(), mins = (state.videoDur || 0) / 60, cur = prun.stages.indexOf(prun.cur), now = Date.now();
  rows.forEach((row, i) => {
    const k = row.dataset.st, done = prun.done || i < cur, on = !prun.done && i === cur;
    row.classList.toggle('done', done); row.classList.toggle('now', on);
    const sm = row.querySelector('small');
    sm.textContent = done ? (prun.start[k] && prun.end[k] ? fmtDur((prun.end[k] - prun.start[k]) / 1000) : '')
      : on ? (prun.start[k] ? fmtDur((now - prun.start[k]) / 1000) : '')
      : (r[k] && mins ? '~' + fmtDur(r[k] * mins) : 'စောင့်ဆဲ');
  });
}
const TIPS = [
  '🎬 မင်းရဲ့ Video က Viral ဖြစ်ဖို့ အသင့်ပြင်နေပါပြီ…',
  '🔥 ပထမ ၃ စက္ကန့်မှာ ဆွဲဆောင်နိုင်ရင် ကြည့်သူတွေ အဆုံးထိ ကြည့်တတ်ပါတယ်',
  '😎 ကော်ဖီတစ်ခွက် သောက်ရင်း ခဏစောင့်ပါ ☕ — ကျန်တာ App က လုပ်ပေးပါမယ်',
  '🖼 Thumbnail လှရင် Click ပိုရပါတယ် — ပြီးရင် 3D Thumbnail ပါ လုပ်ကြည့်ပါ',
  '#️⃣ Caption + Hashtag ကို AI နဲ့ တစ်ချက်တည်း ရေးလို့ရပါတယ်',
  '💪 ပုံမှန် နေ့တိုင်းတင်ရင် Follower ပိုမြန်မြန် တက်ပါတယ်',
  '⏰ ညနေပိုင်း လူအားချိန်မှာ တင်ရင် ကြည့်သူ ပိုများတတ်ပါတယ်',
  '🎙 အသံ Speed နဲ့ Pitch ကို ကိုယ့်စိတ်ကြိုက် ချိန်လို့ရပါတယ်',
  '❄ Freeze + Zoom နဲ့ Video ကို ပိုစိတ်ဝင်စားစရာ ကောင်းအောင် လုပ်ကြည့်ပါ',
  '🔒 Video ကို ကိုယ့်ဖုန်းထဲမှာပဲ ထုတ်နေတာမို့ စိတ်ချရပါတယ်',
  '💡 ဒီ tab ကို ဖွင့်ထားပါ — Screen မပိတ်ပါနဲ့',
  '🔋 ဘက်ထရီ နည်းနေရင် အားသွင်းထားပါ'];
let tipStart = Math.floor(Math.random() * TIPS.length);
const fmtDur = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
// elapsed-time clock under the progress bar; returns a stop function that gives the seconds taken
function startClock() {
  const t0 = Date.now();
  const tick = () => {
    const sec = (Date.now() - t0) / 1000, el = $('#ptime');
    if (el) el.textContent = fmtDur(state.autoRun && prun ? (Date.now() - prun.t0) / 1000 : sec);
    const left = timeLeft(), pl = $('#pleft');
    if (pl) { prun.leftShown = left == null ? null : prun.leftShown == null ? left : prun.leftShown * 0.7 + left * 0.3; pl.textContent = prun.leftShown == null ? '' : ` · ကျန်ချိန် ~${fmtDur(prun.leftShown)}`; }
    paintChecklist();
    // a new tip every 6 s; near the end, a "nearly there" line instead
    const tip = $('#ptip'), pc = parseInt(($('#pnum') || {}).textContent, 10) || 0;
    const k = pc >= 92 ? 'end' : String((tipStart + Math.floor(sec / 6)) % TIPS.length);
    if (tip && tip.dataset.k !== k) {
      tip.dataset.k = k; tip.classList.remove('in'); void tip.offsetWidth;
      tip.textContent = k === 'end' ? '🎉 ပြီးခါနီးပါပြီ — ခဏလေးပဲ ကျန်ပါတော့တယ်…' : TIPS[+k]; tip.classList.add('in');
    }
  };
  const iv = setInterval(tick, 1000); tick();
  return () => { clearInterval(iv); return (Date.now() - t0) / 1000; };
}
function setProg(frac, text) {
  const f = $('#fill'); if (!f) return;
  const pc = Math.max(0, Math.min(100, Math.round(frac * 100)));
  f.style.width = pc + '%';
  $('#pnum').textContent = pc + '%';
  const ring = $('#pring'); if (ring) ring.style.strokeDashoffset = (RING * (1 - pc / 100)).toFixed(1);
  if (text) {
    const [main, sub] = text.split('\n');                 // an optional second line: what is in the mix, in small type
    $('#ptxt').textContent = main.replace(/[.…]+$/, '');
    const ps = $('#psub'); if (ps) ps.textContent = sub || '';
    const k = stageOf(text);
    if (prun && prun.stages.includes(k) && prun.stages.indexOf(k) > prun.stages.indexOf(prun.cur)) {   // only forwards
      if (prun.cur) prun.end[prun.cur] = Date.now();
      prun.start[k] = prun.start[k] || Date.now(); prun.cur = k;
    }
  }
  if (prun) {
    prun.f = frac;
    paintChecklist();
  }
}
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// drop extra blank lines at the end (a stray Enter) so the line count still matches
const trimTail = (lines, n) => { while (lines.length > n && lines[lines.length - 1] === '') lines.pop(); return lines; };
function clearResult() {
  state.thumb = null;                                                           // thumbnail belongs to that result
  state.rTab = 'v';
  if (state.result && state.result.url) URL.revokeObjectURL(state.result.url);   // free the old video from memory
  state.result = null;
}
// friendly hint under an error box: what to check before trying again
const errTip = html => view.insertAdjacentHTML('beforeend', `<div class="warn">${html}</div>`);
const showErr = (e) => {
  const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message || String(e); view.appendChild(d);
  if (!view.querySelector('.errhelp')) view.insertAdjacentHTML('beforeend', `<p class="muted small errhelp" style="margin:6px 0 0">မဖြေရှင်းတတ်ရင် 👉 <a href="${TG_GROUP}" target="_blank" rel="noopener"><b>👥 Support Group</b></a> မှာ မေးပါ</p>`);
};
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

// every step can be opened (to look around or set things up first); a step without its data shows a notice
const canGo = n => !state.busy && n !== state.step;
function previewOnly(ids) {
  view.insertAdjacentHTML('afterbegin', `<div class="tip" style="margin-bottom:12px">ℹ️ Video မတင်ရသေးလို့ ကြည့်ရုံပဲ ရပါသေးတယ်
    <button type="button" class="btn block" id="toStep1" style="margin-top:8px">⬆ Video တင်မည်</button></div>`);
  $('#toStep1').onclick = () => go(1);
  ids.forEach(id => { const b = $('#' + id); if (b) b.disabled = true; });
}
function renderStepper() {
  const vis = STEPS.map((s, i) => ({ s, n: i + 1 }));
  $('#stepper').innerHTML = vis.map((x, k) => {
    const n = x.n, cls = n === state.step ? 'on' : n < state.step ? 'done' : '';
    return `<span class="${cls} ${canGo(n) ? 'link' : ''}" data-n="${n}"><b>${k + 1}</b>${x.s}</span>`;
  }).join('');
  $('#stepper').querySelectorAll('.link').forEach(el => { el.onclick = () => go(+el.dataset.n); });
}
function go(step, opts = {}) { state.step = step; state.renderNow = !!opts.render; render(); window.scrollTo(0, 0); }
function render() {
  delete view.dataset.rt;                                            // the result tabs only apply on the result page
  histUrls.forEach(u => URL.revokeObjectURL(u)); histUrls = [];      // leaving / redrawing History: free its videos
  const stp = $('#stepper');
  if (acc.on && !acc.ok && !['code', 'admin', 'guide'].includes(page)) page = 'code';   // no valid code yet
  if (page === 'free' && premPlan()) page = 'premium';                                    // Premium codes work in the Premium tab
  // the editor: Free Recap for free codes, the Premium tab for Premium codes (others see how to buy)
  if (page === 'free' || (page === 'premium' && premPlan())) {
    stp.style.display = '';
    renderStepper();
    [null, step1, step2, step3, step4][state.step]();
  } else {
    stp.style.display = 'none';
    ({ premium: pagePremium, keys: pageKeys, guide: pageGuide, history: pageHistory, code: pageCode, admin: pageAdmin, cut: pageCut }[page])();
  }
  syncMenu();
}

/* ---------------- menu (hamburger + drawer) ---------------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }
function syncMenu() {
  document.querySelectorAll('.ditem').forEach(b => b.classList.toggle('on', b.dataset.p === page));
  const dc = $('#dCode'), da = $('#dAdmin');
  if (dc) { dc.hidden = !acc.on; $('#dCodeTxt').textContent = acc.ok ? `${acc.name} · ${quotaTxt()}` : 'Code ထည့်ရန်'; }
  if (da) da.hidden = !L.access.adminPass;
}
function openPage(p) {
  closeDrawer();
  if (state.busy) { toast('လုပ်ဆောင်နေစဉ် မပြောင်းနိုင်ပါ — ပြီးအောင်စောင့်ပါ'); return; }
  page = p; render(); window.scrollTo(0, 0);
}
function buildMenu() {
  const top = $('.top'), h1 = $('.top h1');
  const brand = document.createElement('div'); brand.className = 'brand';
  const burger = document.createElement('button');
  burger.className = 'burger'; burger.setAttribute('aria-label', 'Menu');
  burger.innerHTML = '<i></i><i></i><i></i>';
  top.insertBefore(brand, h1); brand.append(burger, h1);
  document.body.insertAdjacentHTML('beforeend', `
    <div id="scrim"></div>
    <nav id="drawer">
      <div class="dhead"><b>Menu</b><button class="ghost" id="dclose">✕</button></div>
      <button class="ditem" data-p="free"><span>🎬</span><b>Free Recap</b><small>Gemini နဲ့ ကိုယ်တိုင် ဘာသာပြန်</small></button>
      <button class="ditem" data-p="premium"><span>💎</span><b>Premium</b><small>Auto ဘာသာပြန် · Key မလို</small></button>
      <button class="ditem" data-p="keys"><span>⚙</span><b>API Key Settings</b><small>AssemblyAI Key · FFmpeg Engine</small></button>
      <button class="ditem" data-p="guide"><span>📖</span><b>အသုံးပြုပုံ လမ်းညွှန်</b><small>အဆင့်လိုက် ရှင်းလင်းချက်</small></button>
      <a class="ditem" href="${TG_GROUP}" target="_blank" rel="noopener" style="text-decoration:none"><span>👥</span><b>Support Group</b><small>မေးချင်တာ Telegram မှာ မေးပါ</small></a>
      <button class="ditem" data-p="history"><span>🗂</span><b>မှတ်တမ်း (History)</b><small>နောက်ဆုံး ထုတ်ထားတဲ့ Video ၂ ခု</small></button>
      <button class="ditem" data-p="cut"><span>✂</span><b>Video ဖြတ်မည်</b><small>အစ / အဆုံး ကို ပြန်မပေါင်းဘဲ အမြန်ဖြတ်</small></button>
      <button class="ditem" data-p="code" id="dCode" hidden><span>🔑</span><b>Access Code</b><small id="dCodeTxt">…</small></button>
      <button class="ditem" data-p="admin" id="dAdmin" hidden><span>🛡</span><b>Admin</b><small>Code ထုတ်ရန် · Limit စီမံရန်</small></button>
    </nav>`);
  burger.onclick = openDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#dclose').onclick = closeDrawer;
  document.querySelectorAll('.ditem[data-p]').forEach(b => { b.onclick = () => {
    if (b.dataset.p === 'free' && premPlan()) toast('💎 Premium Code နဲ့ ဝင်ထားလို့ Premium tab မှာ သုံးပါ');
    openPage(b.dataset.p);
  }; });
  setupInstall();
  $('#openSettings').onclick = () => openPage('keys');
}

/* ---------------- install as an app (home screen, full screen) ---------------- */
let installEvt = null;
function setupInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;                                     // already running as the installed app
  $('#drawer').insertAdjacentHTML('beforeend', `
    <button class="ditem dinstall" id="installApp" hidden><span>📲</span><b>App အဖြစ် ထည့်မည်</b><small>Home screen မှာ icon နဲ့ အပြည့် ဖွင့်ရန်</small></button>`);
  const btn = $('#installApp');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; btn.hidden = false; });
  addEventListener('appinstalled', () => { btn.hidden = true; installEvt = null; toast('✅ App ထည့်ပြီးပါပြီ — Home screen က icon နဲ့ ဖွင့်ပါ'); });
  if (ios) btn.hidden = false;                                // Safari has no install prompt: show the steps instead
  btn.onclick = async () => {
    closeDrawer();
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; btn.hidden = true; return; }
    toast(ios ? 'Safari ရဲ့ Share (⬆) → "Add to Home Screen" ကို နှိပ်ပါ' : 'Browser menu (⋮) → "Add to Home screen / Install app" ကို နှိပ်ပါ');
  };
}

/* ---------------- Usage guide ---------------- */
function pageGuide() {
  const sec = (n, title, body, open) =>
    `<details ${open ? 'open' : ''}><summary><span class="n">${n}</span><span>${title}</span></summary><div class="gbody">${body}</div></details>`;
  view.innerHTML = `
    <h2>📖 အသုံးပြုပုံ လမ်းညွှန်</h2>
    <p class="muted small">ခေါင်းစဉ်ကို နှိပ်ပြီး ဖတ်ပါ။ အဆင့် ၁ ကနေ အစဉ်လိုက် လိုက်လုပ်ရင် ရပါပြီ။</p>
    <div class="guide">
      ${sec(1, 'အစပိုင်း — တစ်ကြိမ်ပဲ လုပ်ရမယ်', `
        <ol>
          <li>ဘယ်ဘက်အပေါ်က <b>☰ Menu</b> ကိုနှိပ်ပြီး <b>API Key Settings</b> ကိုဖွင့်ပါ။</li>
          <li><b>AssemblyAI API Key</b> ထည့်ပါ။ မရှိသေးရင် <b>Get Free Key</b> ကနေ အခမဲ့ယူပါ။</li>
          <li><b>🔎 စစ်ဆေးမည်</b> ကိုနှိပ်ပါ။ ✅ ပေါ်မှ <b>သိမ်းမည်</b> ကိုနှိပ်ပါ။ (Worker URL ကို app ထဲမှာ ထည့်ပေးထားပြီးသားပါ)</li>
          <li><b>Device Video Engine</b> မှာ <b>⬇ Install</b> ကိုနှိပ်ပါ။ (~31MB၊ Wi-Fi နဲ့ တစ်ကြိမ်ပဲ ဒေါင်းရပြီး ဖုန်းထဲမှာ သိမ်းထားပေးပါတယ်)</li>
        </ol>
        <div class="tip">💡 Key တွေကို ဒီဖုန်း browser ထဲမှာပဲ သိမ်းပါတယ်။ Browser data ဖျက်ရင် ပြန်ထည့်ရပါမယ်။</div>
        <div class="tip">🎁 <b>Key မလိုတဲ့ Code</b> — Admin က သင့် Code ကို "Key မလို" ပေးထားရင် အဆင့် ၂ နဲ့ ၃ ကို ကျော်လို့ရပါတယ် (API Key Settings မှာ <b>🎁 Admin Key</b> လို့ ပြပါမယ်)။ ကန့်သတ်ချက်:
          <ul style="margin:6px 0 0">
            <li>Video <b>၁၀ မိနစ်အထိ</b> ပဲ ရပါတယ်။</li>
            <li>တစ်ရက် စာသားထုတ်ခွင့်က Code ရဲ့ ပုဒ်ရေ × ၃ ကြိမ် ပါ။ (ဥပမာ တစ်ရက် ၁ ပုဒ် Code → ၃ ကြိမ်)</li>
            <li>ပိုသုံးချင်ရင် ကိုယ်ပိုင် AssemblyAI Key ထည့်ပါ — ကိုယ်ပိုင် Key ကို အရင်သုံးပါမယ်။</li>
          </ul></div>`, true)}

      ${sec(2, 'Video တင်ပါ', `
        <div class="tip" style="margin:0 0 10px">📲 <b>App လို အပြည့်ဖွင့်ချင်ရင်</b> — ☰ Menu → <b>App အဖြစ် ထည့်မည်</b> (ဒါမှမဟုတ် Chrome ⋮ → Add to Home screen)။ Home screen က icon နဲ့ ဖွင့်ရင် browser bar မပါဘဲ ပွင့်ပါတယ်။</div>
        <ol>
          <li><b>Video File ရွေးချယ်ပါ</b> ကိုနှိပ်ပြီး Video ရွေးပါ။ (MP4၊ MOV၊ WEBM၊ MKV — ၁၀ မိနစ်အထိ)</li>
          <li>ဒါမှမဟုတ် <b>TikTok link</b> ကို ကူးပြီး ကွက်ထဲ ထည့်ပါ (📋 နဲ့ Paste လုပ်လို့ရ) → <b>Load</b> ကိုနှိပ်ပါ။ Video ကို အလိုအလျောက် ဒေါင်းပြီး Preview မှာ ပြပေးပါမယ်။</li>
          <li><b>မူရင်းစကားပြောဘာသာ</b> ကို ရွေးပါ။ (ဥပမာ Chinese)</li>
          <li><b>စာသားထုတ်မည် (Next)</b> ကိုနှိပ်ပါ။ စကားပြောအသံကို စာသားပြောင်းပြီး အချိန်နဲ့တကွ ထုတ်ပေးပါမယ်။</li>
        </ol>
        <div class="tip">💡 ဖုန်းရဲ့ <b>Downloads</b> ဒါမှမဟုတ် <b>Movies</b> folder ထဲက ဖိုင်ကို ရွေးပါ။ Telegram၊ Google Photos ကနေ တိုက်ရိုက်ရွေးရင် ဖိုင်ဖတ်မရတာ ဖြစ်တတ်ပါတယ်။</div>`)}

      ${sec(3, 'စာသားစစ်၊ Gemini နဲ့ ဘာသာပြန်', `
        <ol>
          <li>ထွက်လာတဲ့ စာသားကို စစ်ပါ။ မှားတာရှိရင် ပြင်ပါ။ <b>စာကြောင်းအရေအတွက် မပြောင်းပါနဲ့။</b></li>
          <li><b>📋 Prompt ကူးပြီး Gemini ဖွင့်မည်</b> ကိုနှိပ်ပါ — Prompt ကူးပြီး Gemini ပွင့်လာပါမယ်။</li>
          <li>Gemini မှာ Prompt ကို Paste လုပ်ပြီး ပို့ပါ။</li>
          <li>Gemini ပေးတဲ့ <b>JSON ကို အကုန်ကူး</b>ပြီး အောက်က JSON ကွက်ထဲ Paste လုပ်ပါ။</li>
          <li><b>ဘာသာပြန်အတည်ပြုမည် (Next)</b> ကိုနှိပ်ပါ။</li>
        </ol>
        <div class="tip">💡 Prompt ထဲမှာ အချိန်ဆန့်အောင် စာကြောင်းတိုတို ပြန်ဖို့ ပါပြီးသားပါ။</div>`)}

      ${sec(4, 'စာသား၊ အသံ၊ Effects', `
        <b>မြန်မာစာ ပြင်ခြင်း</b>
        <ul><li>တစ်ကြောင်းလျှင် စာတစ်ကြောင်းပါ။ မကိုက်ရင် စာကြောင်းအရေအတွက် မကိုက်ကြောင်း ပြပါမယ်။</li></ul>
        <b>အသံ ရွေးခြင်း</b>
        <ul>
          <li><b>သီဟ</b> (ယောက်ျား)၊ <b>နီလာ</b> (မိန်းမ) ကို ရွေးပြီး <b>▶ Preview</b> နှိပ်ပြီး နားထောင်ပါ။</li>
          <li>Pitch (ဝါး/ကြည်)၊ အမြန်နှုန်းကို လိုသလို ညှိပါ။</li>
        </ul>
        <b>မူရင်းအသံ ချိန်ညှိခြင်း</b>
        <ul>
          <li><b>🎬 စကားမပြောတဲ့နေရာ</b> — action၊ ဂီတ၊ ဆူညံသံကို မူရင်းအသံ ပြန်ကြားရမယ့် ပမာဏ။</li>
          <li><b>🗣 စကားပြောနေစဉ်</b> — မြန်မာသံပြောနေစဉ် မူရင်းအသံကို လျှော့ပေးမယ့် ပမာဏ။ 0% ဆို လုံးဝမကြားရပါ။</li>
          <li>Slider တွေ အမှားမရွေ့အောင် <b>🔒 လော့ခ်</b> ချထားပါတယ်။ ပြင်ချင်ရင် 🔒 ကိုနှိပ်ပါ။ <b>↺ ပုံမှန်သို့ ပြန်ထားမည်</b> နဲ့ ပြန်ထားလို့ရပါတယ်။</li>
          <li><b>⚙ ပိုမိုချိန်ညှိရန်</b> — ⏱ မြန်မာသံ အချိန်ရွှေ့၊ 🚀 အမြန်ဆုံး အသံမြန်နှုန်း၊ 🔊 မြန်မာသံ ပမာဏ။</li>
        </ul>
        <b>🎞 Video Effects (လိုမှ ဖွင့်ပါ)</b>
        <ul>
          <li><b>↔ Mirror</b> — Video ကို ဘယ်ညာ လှန်ပါတယ်။</li>
          <li><b>🌫 Blur</b> — မူရင်းစာတန်းထိုးကို ဖုံးပါတယ်။ အမြင့်၊ အပေါ်အောက်နေရာ၊ Blur အား၊ အရောင်ရင့်မှုကို Preview ကြည့်ပြီး ညှိပါ။</li>
          <li><b>💬 မြန်မာစာတန်းထိုး</b> — Font ရွေးပါ၊ စာလုံးအရွယ်ကို <b>− / +</b> နဲ့ ညှိပါ၊ နေရာနဲ့ အရောင်ရွေးပါ။</li>
        </ul>
        <div class="warn">⚠ Ratio၊ Zoom၊ Mirror၊ Blur၊ စာတန်းထိုး၊ Watermark၊ Logo တစ်ခုခု ဖွင့်ရင် Video ကို ပြန် encode လုပ်ရလို့ ပိုကြာပါတယ် (ဖုန်းမှာ ငါးမိနစ်ထက်မက ကြာနိုင်ပါတယ်)။ မဖွင့်ရင် အရင်လိုပဲ မြန်ပါတယ်။</div>
        <p style="margin:10px 0 0">အားလုံးပြီးရင် <b>အသံထုတ်ပြီး Video ပေါင်းမည်</b> ကိုနှိပ်ပါ။</p>`)}

      ${sec(5, 'ရလဒ်', `
        <ol>
          <li>% bar ပြေးနေစဉ် <b>ဒီ tab ကို ဖွင့်ထားပါ၊ screen မပိတ်ပါနဲ့၊ refresh မလုပ်ပါနဲ့။</b></li>
          <li>ပြီးရင် Video ကို ကြည့်ပါ။ <b>Download</b> နဲ့ Video ကိုသိမ်းပါ၊ <b>.srt</b> နဲ့ စာတန်းထိုးဖိုင်ကိုလည်း သိမ်းလို့ရပါတယ်။</li>
          <li><b>⚠ ရှည်လွန်းတဲ့ စာကြောင်း</b> ပေါ်ရင် — <b>တိုအောင်ခိုင်းမည့် Prompt ကူးမည်</b> ကိုနှိပ်ပြီး Gemini မှာ paste လုပ်ပါ။ ရလာတဲ့ JSON ကို <b>မူရင်းစာသား</b> အဆင့်မှာ ထည့်ပြီး Video ပြန်ထုတ်ပါ။</li>
          <li>ပြန်ပြင်ချင်ရင် အပေါ်က <b>1 / 2 / 3</b> အဆင့်ဘားကို နှိပ်ပြီး ပြန်သွားနိုင်ပါတယ်။</li>
          <li>ထုတ်ပြီးသား Video တွေကို <b>☰ Menu → မှတ်တမ်း (History)</b> မှာ ပြန်ကြည့်၊ ပြန်ဒေါင်းလို့ ရပါတယ် (နောက်ဆုံး ၂ ခု၊ ၂၄ နာရီအတွင်း)။</li>
        </ol>`)}

      ${sec(6, '⚡ Multi-core Engine (Video ပိုမြန်အောင်)', `
        <p style="margin:0">ဖုန်းရဲ့ CPU core အားလုံးကို သုံးပြီး Video ပေါင်းလို့ ပုံမှန်ထက် <b>၂ ဆလောက် ပိုမြန်</b> နိုင်ပါတယ်။ (ပုံမှန် Engine က core တစ်ခုတည်းပဲ သုံးပါတယ်)</p>
        <b>ဖွင့်နည်း</b>
        <ol>
          <li><b>☰ Menu → API Key Settings</b> ကိုဖွင့်ပါ။</li>
          <li><b>Device Video Engine</b> အောက်က <b>⚡ Multi-core Engine</b> ကို ✅ ခြစ်ပါ။</li>
          <li><b>⬇ Install</b> ကိုနှိပ်ပြီး Engine (~32MB) ကို တစ်ကြိမ် ဒေါင်းပါ။ (Wi-Fi နဲ့ ဒေါင်းပါ)</li>
          <li>Video ထုတ်ပြီးရင် ရလဒ်က <b>📊 အဆင့်အလိုက် ကြာချိန်</b> မှာ <b>⚙ Engine: ⚡ Multi-core</b> လို့ ပေါ်ရင် အလုပ်လုပ်နေပါပြီ။</li>
        </ol>
        <div class="warn">⚠ <b>RAM နည်းတဲ့ ဖုန်း / ဖုန်းအဟောင်း</b> (RAM 4GB နဲ့အောက်၊ ဈေးပေါ်ဖုန်း) တွေမှာ <b>မဖွင့်ပါနဲ့</b>။ Memory ပိုစားလို့ ဖုန်းလေးတာ၊ ပူတာ၊ browser ပိတ်သွားတာ ဖြစ်နိုင်ပါတယ်။ ပုံမှန် Engine နဲ့ပဲ သုံးပါ။</div>
        <div class="tip">💡 Video ထုတ်နေတုန်း Multi-core ရပ်သွားရင် app က <b>ပုံမှန် Engine နဲ့ အလိုအလျောက် ပြန်ထုတ်</b> ပေးပါတယ်။ ခဏခဏ ဖြစ်နေရင် ✅ ကို ပြန်ဖြုတ်ထားပါ။ iPhone (Safari) အချို့မှာ မရပါ — ခလုတ်ကို နှိပ်လို့မရရင် အဲဒါပါ။</div>`)}

      ${sec(7, 'အကြံပြုချက်များ', `
        <ul>
          <li>အရင်ဆုံး <b>၁-၂ မိနစ်လောက် Video တိုတိုလေး</b> နဲ့ စမ်းပါ။</li>
          <li>မူရင်းအသံ ကျယ်ပြီး မြန်မာသံကို ဖုံးနေရင် <b>🗣 စကားပြောနေစဉ်</b> ကို ပိုလျှော့ပါ။</li>
          <li>မြန်မာသံ အချိန်မကိုက်ရင် <b>⏱ အချိန်ရွှေ့</b> ကို ညှိပါ။ စာကြောင်းရှည်နေရင် Gemini ကို ပိုတိုအောင် ခိုင်းပါ။</li>
          <li>Page ကို refresh လုပ်ရင် စာသားတွေ ပျောက်ပါတယ်။</li>
          <li>AssemblyAI free plan မှာ လစဉ်သုံးခွင့် ကန့်သတ်ချက် ရှိပါတယ်။</li>
        </ul>`)}

      ${sec(8, 'ပြဿနာ ဖြေရှင်းနည်း', `
        <ul>
          <li><b>စာသားထုတ်တဲ့နေရာမှာ Error တက်ရင်</b> — <b>VPN</b> ချိတ်ထားရင် ဖြုတ်ပြီး ပြန်ကြိုးစားပါ။ Wi-Fi / Internet ကိုလည်း စစ်ပါ။</li>
          <li><b>Video ပေါင်းနေတဲ့နေရာမှာ Error တက်ရင်</b> (ဥပမာ "TTS 500"၊ "refused connection") — <b>Wi-Fi / Internet</b> ကောင်းမကောင်း အရင်စစ်ပြီး <b>ပြန်စမည်</b> ကိုနှိပ်ပါ။ ပြင်ထားတာတွေ မပျောက်ပါဘူး။</li>
          <li><b>အသံမထွက်ရင် / "TTS audio မရပါ"</b> — API Key Settings မှာ <b>🔎 စစ်ဆေးမည်</b> နဲ့ Key နဲ့ ချိတ်ဆက်မှုကို စစ်ပါ။</li>
          <li><b>"File could not be read"</b> — Video ကို Downloads/Movies ထဲကနေ ပြန်ရွေးပါ။ ရလဒ် အဆင့်မှာ <b>🎞 Video ပြန်ရွေးပြီး ပြန်စမည်</b> ကိုနှိပ်ပါ။</li>
          <li><b>စာတန်းထိုး Font မပေါ်ရင်</b> — Font dropdown အောက်က အခြေအနေစာကို ကြည့်ပါ။ ❌ ဆိုရင် တခြား Font ရွေးပါ။</li>
          <li><b>Video ထုတ်တာ အရမ်းကြာရင်</b> — Mirror၊ Blur၊ စာတန်းထိုး ကို ပိတ်လိုက်ပါ။</li>
          <li><b>⚡ Multi-core Engine ဖွင့်ပြီး အဆင်မပြေရင်</b> (ရပ်နေတာ၊ app ပိတ်သွားတာ) — API Key Settings မှာ <b>⚡ Multi-core Engine</b> ကို ပြန်ပိတ်ပါ။ ရပ်သွားရင် app က ပုံမှန် Engine နဲ့ အလိုအလျောက် ပြန်ထုတ်ပေးပါတယ်။</li>
          <li><b>Engine ဒေါင်းမရရင်</b> — API Key Settings မှာ <b>Cache ဖျက်မည်</b> ပြီး <b>Install</b> ပြန်နှိပ်ပါ။</li>
        </ul>`)}
    </div>
    <button class="btn primary" id="toFree">Free Recap သို့ သွားမည်</button>`;
  $('#toFree').onclick = () => openPage('free');
}

/* ---------------- History ---------------- */
let histUrls = [];
const ago = ms => {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'အခုလေးတင်' : m < 60 ? `${m} မိနစ်က` : `${Math.floor(m / 60)} နာရီက`;
};
const left = ms => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m < 60 ? `${m} မိနစ်` : `${Math.floor(m / 60)} နာရီ`;
};
async function pageHistory() {
  view.innerHTML = `
    <h2>🗂 မှတ်တမ်း (History)</h2>
    <p class="muted small">နောက်ဆုံး ထုတ်ထားတဲ့ Video <b>၂ ခု</b>ကို ဒီဖုန်းမှာ <b>၂၄ နာရီ</b> သိမ်းထားပေးပါတယ်။ အသစ်ထုတ်ရင် အဟောင်းဆုံးကို ဖျက်ပြီး ၂၄ နာရီကျော်ရင်လည်း အလိုအလျောက် ဖျက်ပါမယ်။ လိုချင်တာကို Download လုပ်ထားပါ။</p>
    <div id="hlist"><p class="muted">ဖွင့်နေသည်…</p></div>`;
  let items;
  try { items = await H.histList(); }
  catch { $('#hlist').innerHTML = '<div class="err">မှတ်တမ်း ဖွင့်မရပါ (ဒီ browser က သိမ်းခွင့် မပေးပါ)</div>'; return; }
  if (page !== 'history') return;
  const box = $('#hlist');
  if (!items.length) {
    box.innerHTML = `<div class="hempty">📭<p>မှတ်တမ်း မရှိသေးပါ</p><small class="muted">Video ထုတ်ပြီးတိုင်း ဒီမှာ အလိုအလျောက် ပေါ်လာပါမယ်။</small></div>
      <button class="btn primary" id="toFree">Video ထုတ်ရန် သွားမည်</button>`;
    $('#toFree').onclick = () => openPage('free');
    return;
  }
  const now = Date.now();
  box.innerHTML = items.map(it => `
    <div class="hitem" data-id="${it.id}">
      <div class="hhead">
        <b class="hname">${esc(it.name)}</b>
        <span class="badge">${(it.size / 1048576).toFixed(1)} MB</span>
      </div>
      <div class="muted small">🕒 ${ago(now - it.created)} · ${it.dur ? '🎞 ' + fmtDur(it.dur) + ' · ' : ''}${it.took ? '⏱ ထုတ်ချိန် ' + fmtDur(it.took) : ''}</div>
      <div class="muted small">🗑 ${left(it.created + H.KEEP_MS - now)} နေရင် အလိုအလျောက် ဖျက်ပါမယ်</div>
      <div class="hvid"></div>
      <div class="hbtns">
        <button class="btn" data-a="play">▶ ကြည့်</button>
        <button class="btn primary" data-a="mp4">⬇ Video</button>
        <button class="btn" data-a="srt" ${it.srt ? '' : 'disabled'}>⬇ .srt</button>
        <button class="btn danger" data-a="del" aria-label="ဖျက်မည်">🗑</button>
      </div>
    </div>`).join('') + `<button class="btn block danger" id="hclear">🗑 မှတ်တမ်း အားလုံး ဖျက်မည်</button>`;
  const byId = new Map(items.map(it => [it.id, it]));
  box.querySelectorAll('.hitem button').forEach(b => b.onclick = async () => {
    const card = b.closest('.hitem'), it = byId.get(+card.dataset.id);
    const base = it.name.replace(/\.[^.]+$/, '');
    if (b.dataset.a === 'play') {
      const slot = card.querySelector('.hvid');
      if (slot.firstChild) { slot.innerHTML = ''; b.textContent = '▶ ကြည့်'; return; }
      const u = URL.createObjectURL(it.video); histUrls.push(u);
      slot.innerHTML = `<video src="${u}" controls playsinline autoplay></video>`;
      b.textContent = '✕ ပိတ်';
    } else if (b.dataset.a === 'mp4') download(it.video, base + '_recap.mp4');
    else if (b.dataset.a === 'srt') download(new Blob([it.srt], { type: 'text/plain' }), base + '_burmese.srt');
    else if (b.dataset.a === 'del') {
      if (!confirm('ဒီ Video ကို မှတ်တမ်းထဲက ဖျက်မလား?')) return;
      try { await H.histDel(it.id); toast('ဖျက်ပြီးပါပြီ'); } catch { toast('ဖျက်မရပါ'); }
      render();
    }
  });
  $('#hclear').onclick = async () => {
    if (!confirm('မှတ်တမ်း အားလုံးကို ဖျက်မလား?')) return;
    try { await H.histClear(); toast('အားလုံး ဖျက်ပြီးပါပြီ'); } catch { toast('ဖျက်မရပါ'); }
    render();
  };
}

/* ---------------- Premium tab for codes that aren't Premium: what it gives and how to buy ---------------- */
function pagePremium() {
  const row = (icon, t, d) => `<li><span>${icon}</span><div><b>${t}</b><small>${d}</small></div></li>`;
  view.innerHTML = `
    <h2>💎 Premium</h2>
    <p class="muted">Video ထုတ်တဲ့ အလုပ်ရှုပ်တဲ့ အဆင့်တွေကို App က အလိုအလျောက် လုပ်ပေးပါတယ်။ ဒီ tab ကို 💎 Premium Code ရှိသူတွေပဲ သုံးလို့ရပါတယ်။</p>
    <ul class="plist">
      ${row('🔑', 'AssemblyAI Key မလို', 'Key ဖွင့်စရာ၊ ထည့်စရာ မလိုဘဲ စာသားထုတ်လို့ရ')}
      ${row('✨', 'Auto ဘာသာပြန်', 'Gemini မှာ Copy/Paste မလုပ်ရတော့ဘဲ ခလုတ်တစ်ချက်နဲ့ မြန်မာလို ဘာသာပြန်')}
      ${row('🖼', 'Auto Thumbnail ခေါင်းစဉ်', 'ဇာတ်ကြောင်းကနေ ခေါင်းစဉ် ၃ ခု ထုတ်ပေး — ရွေးပြီး ChatGPT ကို တန်းပို့')}
      ${row('🎟', 'တစ်ရက် ကန့်သတ်ချက် မရှိ', `ဝယ်ထားတဲ့ Credit ရှိသလောက် ထုတ်လို့ရ — ၁ မိနစ် = ${L.CPM} credit (စက္ကန့်နဲ့ တွက်၊ ဥပမာ 1:30 = ${L.creditCost(90)})၊ ထုတ်ပြီးသား Video ကို ပြန်ထုတ်ရင်လည်း နှုတ်ပါတယ် (Error တက်လို့ ပြန်စရင် မနှုတ်)`)}
      ${row('📝', 'Caption + Hashtag', 'TikTok / Facebook မှာ တင်ဖို့ စာနဲ့ Hashtag ကို AI က ရေးပေး')}
    </ul>
    <div class="kbox"><b>Premium ဘယ်လိုရမလဲ</b>
      <ol class="muted small" style="margin:8px 0 0;padding-left:20px;line-height:1.9">
        <li>Telegram Bot ကိုဖွင့်ပြီး <b>💎 Credit ဝယ်မည်</b> ကိုနှိပ်ပါ</li>
        <li>Package ရွေးပြီး ငွေလွှဲ Screenshot ပို့ပါ</li>
        <li>💎 Premium Code (သို့) Credit ထပ်ဖြည့်ပေးပါမယ်</li>
        <li>☰ Menu → 🔑 Access Code → <b>Code ပြောင်းမည်</b> ကနေ Code အသစ် ထည့်ပါ</li>
      </ol>
      <a class="btn primary block" href="${TG_BOT}" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:10px;text-decoration:none">🤖 Telegram မှာ ဝယ်မည်</a></div>
    <button class="btn block" id="toFree">🎬 Free Recap နဲ့ ဆက်သုံးမည်</button>`;
  $('#toFree').onclick = () => openPage('free');
}

const TG_BOT = 'https://t.me/RecapStudioMyanmar_bot';
const TG_GROUP = 'https://t.me/Clipzatmm';

/* ---------------- API Key Settings ---------------- */
let ffBusy = false, ffCached = false;
function pageKeys() {
  view.innerHTML = `
    <h2>API Keys Settings</h2>
    <p class="muted small">Key တွေကို ဒီဖုန်း browser ထဲမှာပဲ သိမ်းပါတယ်။</p>

    <div class="kbox">
      <div class="krow">
        <b>AssemblyAI API Key<br><span class="muted small" style="font-weight:400">(အသံဖိုင် စာသားပြောင်းရန်)</span></b>
        <div class="badges"><span class="badge ${L.premium.on || L.freeKey.on ? 'ok' : 'req'}">${L.premium.on ? '💎 Premium — Key မလို' : L.freeKey.on ? '🎁 Key မလို' : 'Required'}</span><span class="badge" id="aaiBadge"></span></div>
      </div>
      ${L.premium.on ? '<p class="tip small" style="margin:8px 0 0">💎 Premium Code နဲ့ ဝင်ထားလို့ AssemblyAI key မထည့်လည်း စာသားထုတ်လို့ရပါတယ်။</p>'
        : L.freeKey.on ? '<div class="tip" style="margin-top:10px">🎁 <b>Key ထည့်စရာ မလိုပါ</b> — Admin က သင့် Code ကို Key မလိုအောင် ပေးထားပါတယ်။ ကိုယ်ပိုင် Key ရှိရင်တော့ ထည့်ထားလို့ရပါတယ် (ကိုယ်ပိုင် Key ကို အရင်သုံးပါမယ်)။</div>' : ''}
      <p style="margin:8px 0 10px"><a class="link small" href="https://www.assemblyai.com/dashboard/signup" target="_blank" rel="noopener">Get Free Key ↗</a></p>
      <div class="keyfield">
        <input id="kAai" type="password" autocomplete="off" placeholder="AssemblyAI API Key" />
        <button class="icon" id="kDel" title="ဖျက်မည်">🗑</button>
        <button class="icon" id="kEye" title="ပြမည်">👁</button>
      </div>
      <div class="two">
        <button class="btn" id="kTest">🔎 စစ်ဆေးမည်</button>
        <button class="btn primary" id="kSave">သိမ်းမည်</button>
      </div>
    </div>

    <div class="kbox">
      <div class="krow">
        <b>🔊 မြန်မာအသံ (TTS) စစ်ဆေးရန်<br><span class="muted small" style="font-weight:400">Video မထုတ်ဘဲ အသံတစ်ကြောင်း စမ်းထုတ်ကြည့်ရန်</span></b>
        <span class="badge" id="ttsBadge">—</span>
      </div>
      <button class="btn block" id="ttsTest">🔎 မြန်မာအသံ စစ်ဆေးမည်</button>
      <div id="ttsOut" class="small" style="margin-top:10px" hidden></div>
    </div>

    <div class="kbox">
      <div class="krow">
        <b>Device Video Engine<br><span class="muted small" style="font-weight:400">(FFmpeg WASM ~31MB)</span></b>
        <span class="badge" id="ffBadge">…</span>
      </div>
      <p class="muted small" style="margin:8px 0 0">Video ပေါင်းဖို့ Engine ကို တစ်ကြိမ်ပဲ ဒေါင်းရပြီး ဖုန်းထဲမှာ သိမ်းထားပေးပါတယ်။</p>
      <div id="ffProg" hidden>${'<div class="bar"><i id="ffFill"></i></div>'}</div>
      <div class="two">
        <button class="btn danger" id="ffClear">🗑 Cache ဖျက်မည်</button>
        <button class="btn primary" id="ffInstall">⬇ Install</button>
      </div>
      <label class="mtrow">
        <input id="ffMt" type="checkbox" ${L.mtWanted() ? 'checked' : ''} ${L.mtSupported() ? '' : 'disabled'} />
        <span><b>⚡ Multi-core Engine</b> <span class="badge">စမ်းသပ်ဆဲ</span></span>
      </label>
      <p class="muted small" id="mtNote" style="margin:6px 0 0"></p>
    </div>`;

  $('#kAai').value = localStorage.getItem('aaiKey') || '';

  const upd = () => {
    const k = localStorage.getItem('aaiKey') || '';
    const dirty = $('#kAai').value.trim() !== k;
    const ok = !!k, b = $('#aaiBadge');
    const free = !ok && L.freeKey.on;                       // no own key, but the owner's spare key covers this code
    b.textContent = dirty ? 'Unsaved' : ok ? 'Active' : free ? '🎁 Admin Key' : 'Not set';
    b.className = 'badge' + (!dirty && (ok || free) ? ' ok' : '');
  };
  $('#kAai').oninput = upd;
  $('#kEye').onclick = () => { const i = $('#kAai'); i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#kDel').onclick = () => { $('#kAai').value = ''; localStorage.removeItem('aaiKey'); upd(); toast('Key ဖျက်ပြီးပါပြီ'); };
  $('#kSave').onclick = () => {
    localStorage.setItem('aaiKey', $('#kAai').value.trim());
    upd(); toast('သိမ်းပြီးပါပြီ');
  };
  $('#kTest').onclick = async () => {
    localStorage.setItem('aaiKey', $('#kAai').value.trim());
    upd();
    if (!L.cfg.aaiKey) { toast('AssemblyAI Key ကို အရင်ထည့်ပါ'); return; }
    try {
      const r = await fetch(`${L.cfg.workerUrl}/aai/v2/transcript?limit=1`, { headers: { authorization: L.cfg.aaiKey } });
      if (r.status === 401 || r.status === 403) throw new Error('Key မမှန်ပါ');
      if (!r.ok) throw new Error('Server ပြန်ကြားချက်: ' + r.status);
      toast('✅ Key မှန်ပါတယ်');
    } catch (e) { toast(e.message === 'Failed to fetch' ? 'Worker ကို ချိတ်ဆက်မရပါ' : e.message); }
  };
  upd();

  /* TTS check: one short line straight through the Worker, showing the full error if it fails */
  $('#ttsTest').onclick = async () => {
    const b = $('#ttsTest'), out = $('#ttsOut'), badge = $('#ttsBadge');
    b.disabled = true; out.hidden = false; out.className = 'small muted'; out.textContent = 'စမ်းနေပါတယ်…';
    const t0 = performance.now();
    L.ttsInfo.direct = 'unknown';   // the check always tries the phone path again
    try {
      const ab = await L.tts('မင်္ဂလာပါ၊ အသံစမ်းသပ်နေပါတယ်။', L.PERSONAS[0], 0, 0, 1);
      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      badge.textContent = 'OK'; badge.className = 'badge ok';
      out.className = 'tip'; out.textContent = `✅ အသံရပါတယ် (${(ab.byteLength / 1024).toFixed(0)} KB · ${sec} စက္ကန့်)`;
      try { new Audio(URL.createObjectURL(new Blob([ab], { type: 'audio/mpeg' }))).play().catch(() => {}); } catch {}
    } catch (e) {
      badge.textContent = 'Error'; badge.className = 'badge req';
      out.className = 'err';
      out.textContent = String((e && e.message) || e) === 'Failed to fetch' ? 'Worker ကို ချိတ်ဆက်မရပါ (Internet / VPN စစ်ပါ)' : String((e && e.message) || e);
    }
    b.disabled = false;
  };

  /* FFmpeg card */
  const mtNote = () => {
    const n = $('#mtNote'); if (!n) return;
    const cores = navigator.hardwareConcurrency || '?';
    n.textContent = !L.mtSupported()
      ? 'ဒီ browser မှာ Multi-core မရပါ — ပုံမှန် Engine ကိုပဲ သုံးပါမယ်။'
      : L.engineInfo().fellBack
        ? '⚠ Multi-core Engine အဆင်မပြေလို့ (စတင်မရ / ရပ်သွား) ဒီတစ်ခေါက် ပုံမှန် Engine ကို သုံးနေပါတယ်။ ဆက်ဖြစ်နေရင် ပိတ်ထားပါ။'
        : L.mtWanted()
          ? `✅ ဖွင့်ထားပါတယ် — ဖုန်းရဲ့ core ${cores} ခုလုံး သုံးပြီး Video ပေါင်းပါမယ်။ အဆင်မပြေရင် (ရပ်နေတာ၊ app ပိတ်သွားတာ) ဒီခလုတ်ကို ပြန်ပိတ်ပါ။`
          : `ဖွင့်ရင် ဖုန်းရဲ့ core ${cores} ခုလုံး သုံးလို့ Video ပေါင်းတာ ပိုမြန်နိုင်ပါတယ်။ Engine (~32MB) ကို တစ်ကြိမ် ထပ်ဒေါင်းရပါမယ်။`;
  };
  $('#ffMt').onchange = e => {
    L.setMtWanted(e.target.checked);
    toast(e.target.checked ? '⚡ Multi-core ဖွင့်ပြီးပါပြီ — Install ကိုနှိပ်ပြီး Engine ဒေါင်းပါ' : 'ပုံမှန် Engine ကို ပြန်သုံးပါမယ်');
    mtNote(); ffRefresh();
  };
  mtNote();
  const ffRefresh = async () => {
    ffCached = await L.ffmpegCached();
    const b = $('#ffBadge'), i = $('#ffInstall'); if (!b || !i) return;
    b.textContent = ffCached ? 'Cached (Ready)' : 'Not installed';
    b.className = 'badge' + (ffCached ? ' ok' : '');
    i.textContent = ffCached ? '⬇ Re-test Download' : '⬇ Install';
  };
  $('#ffClear').onclick = async () => {
    if (ffBusy) return;
    await L.ffmpegClear(); toast('Cache ဖျက်ပြီးပါပြီ'); ffRefresh();
  };
  $('#ffInstall').onclick = async () => {
    if (ffBusy) return;
    ffBusy = true;
    const prog = $('#ffProg'), fill = $('#ffFill'), badge = $('#ffBadge');
    $('#ffInstall').disabled = true; $('#ffClear').disabled = true; prog.hidden = false;
    try {
      if (ffCached) await L.ffmpegClear();
      await L.getFFmpeg(p => {
        const f = $('#ffFill'), b = $('#ffBadge');
        if (f) f.style.width = Math.round(p * 100) + '%';
        if (b) { b.textContent = 'Downloading ' + Math.round(p * 100) + '%'; b.className = 'badge'; }
      });
      const en = L.engineInfo();
      toast(en.fellBack ? '⚠ Multi-core မရလို့ ပုံမှန် Engine နဲ့ အဆင်သင့်ပါပြီ' : en.kind === 'mt' ? '✅ ⚡ Multi-core Engine အဆင်သင့်ပါပြီ' : '✅ Engine အဆင်သင့်ပါပြီ');
      mtNote();
    } catch (e) { toast((e.message || 'ဒေါင်းလုဒ် မအောင်မြင်ပါ').slice(0, 80)); }
    finally {
      ffBusy = false;
      if ($('#ffInstall')) { $('#ffInstall').disabled = false; $('#ffClear').disabled = false; $('#ffProg').hidden = true; }
      ffRefresh();
    }
  };
  ffRefresh();
}

/* ---------------- Step 1 ---------------- */
function previewUrl() {
  if (state.previewFor !== state.file) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = state.file ? URL.createObjectURL(state.file) : null;
    state.previewFor = state.file;
  }
  return state.previewUrl;
}

const pmBtn = (id, t) => `<button type="button" class="ghost" id="${id}" style="width:48px;height:48px;padding:0;margin:0;flex:none;font-size:26px;line-height:1">${t}</button>`;
const pmRow = (id, min, max, step, val) => `<div style="display:flex;align-items:center;gap:8px;margin-top:6px">${pmBtn(id + 'M', '−')}<input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" style="flex:1;margin:0" />${pmBtn(id + 'P', '+')}</div>`;

const posChips = () => [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']].map(([k, t]) => `<button type="button" class="chip" data-p="${k}">${t}</button>`).join('');
const RATIO_NUM = { '9:16': 9 / 16, '3:4': 3 / 4, '16:9': 16 / 9, '1:1': 1 };
function fileToLogo(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('ပုံ မဖွင့်နိုင်ပါ')); };
    img.src = u;
  });
}

function previewBlock() {
  const url = previewUrl();
  const chk = 'width:22px;height:22px;padding:0;margin:0';
  return `
    <div class="panel fx">
      <b>🎞 Video Effects <span class="muted small" style="font-weight:400">(လိုမှ ဖွင့်ပါ)</span></b>
      <p class="muted small" style="margin:6px 0 0">အောက်က Tab တွေမှာ ရွေးပြီး Preview မှာ ကြည့်ချိန်ပါ။ (Preview မှာ အသံမပါပါ)</p>
      <div id="pvSticky" style="position:sticky;top:64px;z-index:4;background:#1e1e22;margin:10px -6px 0;padding:6px 6px 4px;border-radius:14px;box-shadow:0 8px 14px -6px rgba(0,0,0,.7)">
      <div id="pvBox" style="position:relative;margin:0 auto;border-radius:14px;overflow:hidden;background:#000">
        <div id="pvInner" style="position:relative;width:100%;height:100%;transform-origin:center">
          <video id="pvBg" src="${url}" playsinline muted preload="metadata" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(18px) brightness(.8);transform:scale(1.15);margin:0;border-radius:0"></video>
          <video id="pvVid" src="${url}" playsinline muted preload="metadata" style="display:block;position:relative;width:100%;margin:0;border-radius:0"></video>
        </div>
        <div id="pvBlur" style="display:none;position:absolute;left:0;right:0;pointer-events:none;box-sizing:border-box;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(255,255,255,.08);border-top:1px dashed rgba(255,255,255,.8);border-bottom:1px dashed rgba(255,255,255,.8)"></div>
        <div id="pvSub" style="display:none;position:absolute;left:4%;right:4%;text-align:center;pointer-events:none;transform:translateY(-50%);line-height:1.35;font-weight:700">မြန်မာစာတန်းထိုး နမူနာ စာကြောင်း</div>
        <div id="pvWm" style="display:none;position:absolute;pointer-events:none;font-weight:700;color:#fff;opacity:.75;white-space:nowrap;text-shadow:0 0 3px #000,0 0 3px #000"></div>
        <img id="pvLogo" alt="" style="display:none;position:absolute;pointer-events:none;border-radius:50%;object-fit:cover" />
      </div>
      <div class="row" style="margin-top:8px;gap:8px">
        <button class="ghost" id="pvPlay" type="button">▶</button>
        <input id="pvSeek" type="range" min="0" max="1000" value="0" style="flex:1" />
        <span id="pvT" class="muted small" style="white-space:nowrap">0:00</span>
      </div>
      </div>
      <div class="tabs" id="fxTabs">
        <button type="button" data-tab="video">🎬 Video</button>
        <button type="button" data-tab="caps">💬 စာတန်း</button>
        <button type="button" data-tab="extra">✨ Extras</button>
      </div>
      <div class="pane" data-pane="video">
        <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
          <input id="fxUnlock" type="checkbox" style="${chk}" ${state.fxUnlock ? 'checked' : ''} />
          <span id="fxUnlockT">${state.fxUnlock ? '🔓' : '🔒'} ${LOCK_T}</span>
        </label>
        <p class="muted small" style="margin:4px 0 0">ပုံမှန် Setting (မူရင်းအချိုး · Zoom 100% · 720p · 30fps · Blur ဖွင့် · Freeze ပိတ်) နဲ့ သော့ခတ်ထားပါတယ်။ ပြောင်းချင်မှ ဖွင့်ပါ။</p>
        <div id="lockBox" class="lockbox ${state.fxUnlock ? '' : 'locked'}" ${state.fxUnlock ? '' : 'inert'}>
        <b style="display:block;margin-top:14px">📐 အချိုး (Ratio)</b>
        <div class="chips" id="ratioChips">
          ${[['orig', 'မူရင်း'], ['9:16', '9:16'], ['3:4', '3:4'], ['16:9', '16:9'], ['1:1', '1:1']].map(([k, t]) => `<button type="button" class="chip" data-r="${k}">${t}</button>`).join('')}
        </div>
        <div id="fitBox" hidden>
          <div class="chips" id="fitChips" style="margin-top:8px">
            <button type="button" class="chip" data-f="crop">✂ Crop (အပြည့်)</button>
            <button type="button" class="chip" data-f="pad">🌫 Blur နောက်ခံ</button>
          </div>
        </div>
        <div class="row" style="margin-top:14px"><b>🔍 Zoom</b><span id="fxZoomV">${state.fxZoom}%</span></div>
        ${pmRow('fxZoom', 100, 250, 10, state.fxZoom)}
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="fxFast" type="checkbox" style="${chk}" ${state.fxFast ? 'checked' : ''} />
        ⚡ မြန်မြန်ထုတ် (720p)
      </label>
      <p class="muted small" style="margin:4px 0 0">Effect တစ်ခုခု ဖွင့်ထားရင် Video ကို 720p နဲ့ ထုတ်လို့ ပိုမြန်ပါတယ်။ Effect မဖွင့်ရင် မူရင်းအတိုင်းပါ။</p>
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="fxFps30" type="checkbox" style="${chk}" ${state.fxFps30 ? 'checked' : ''} />
        🎞 30 fps နဲ့ ထုတ်မည်
      </label>
      <p class="muted small" style="margin:4px 0 0">မူရင်း 60 fps Video တွေကို 30 fps နဲ့ ထုတ်လို့ ၂ ဆလောက် ပိုမြန်ပါတယ် (TikTok/Facebook မှာ ကွာခြားမှု မသိသာပါ)။ 30 fps နဲ့အောက် Video တွေကို မထိပါ။</p>
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="fxBlur" type="checkbox" style="${chk}" ${state.fxBlur ? 'checked' : ''} />
        🌫 Blur (စာတန်းထိုး ဖုံးမည်)
      </label>
      <div id="blurBox" ${state.fxBlur ? '' : 'hidden'}>
        <button type="button" class="btn block" id="blurAuto" style="margin-top:10px" ${state.file ? '' : 'disabled'}>✨ စာတန်းနေရာ အလိုလို ရှာမည်</button>
        <p class="muted small" id="blurAutoMsg" style="margin:4px 0 0">Video ထဲက မူရင်းစာတန်းကို ရှာပြီး Blur ကို အပေါ်မှာ အလိုလို ချိန်ပေးပါတယ် (မှားရင် အောက်မှာ ပြင်ပါ)</p>
        <div class="row" style="margin-top:14px"><b>↕ အကြီးအသေး (အမြင့်)</b><span id="bhv">${state.blurH}%</span></div>
        <input id="blurH" type="range" min="3" max="40" value="${state.blurH}" />
        <div class="row" style="margin-top:14px"><b>⇅ အပေါ်အောက် နေရာ</b><span id="byv">${state.blurY}%</span></div>
        <input id="blurY" type="range" min="0" max="100" value="${state.blurY}" />
        <div class="row muted small"><span>0% (အပေါ်ဆုံး)</span><span>100% (အောက်ဆုံး)</span></div>
        <div class="row" style="margin-top:14px"><b>💧 အကြည် / အဝါး (Blur အား)</b><span id="blurSV">${state.blurS}%</span></div>
        ${pmRow('blurS', 5, 100, 5, state.blurS)}
        <div class="row muted small"><span>နည်း (ပိုကြည်)</span><span>များ (ပိုဝါး)</span></div>
        <div class="row" style="margin-top:14px"><b>🎨 အရောင်ရင့်မှု (Opacity)</b><span id="blurOV">${state.blurO}%</span></div>
        ${pmRow('blurO', 20, 100, 5, state.blurO)}
        <div class="row muted small"><span>နည်း (ပါးပါး)</span><span>100% (အပြည့်)</span></div>
      </div>
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="frzOn" type="checkbox" style="${chk}" ${state.frzOn ? 'checked' : ''} />
        ❄ Freeze + Zoom
      </label>
      <p class="muted small" style="margin:4px 0 0">Video ကို ခဏပြ → ခဏရပ် (ပုံရပ်) လုပ်ပြီး ရပ်နေတုန်း Zoom လုပ်ပေးပါတယ်။ Video အရှည် မပြောင်းပါ (ရပ်ထားတဲ့ စက္ကန့်တွေက ကျော်သွားပါတယ်)။</p>
      <div id="frzBox" ${state.frzOn ? '' : 'hidden'}>
        <div class="row" style="margin-top:14px"><b>▶ ပြမည်</b><span id="frzAV">${state.frzA} စက္ကန့်</span></div>
        ${pmRow('frzA', 1, 15, 1, state.frzA)}
        <div class="row" style="margin-top:14px"><b>❄ ရပ်မည် (Freeze)</b><span id="frzBV">${state.frzB} စက္ကန့်</span></div>
        ${pmRow('frzB', 1, 6, 0.5, state.frzB)}
        <div class="row" style="margin-top:14px"><b>🔍 ရပ်နေတုန်း</b></div>
        <div class="chips" id="frzZChips" style="margin-top:6px">
          ${[['out', '🔍 Zoom out'], ['in', '🔎 Zoom in'], ['none', 'Zoom မလုပ်']].map(([k, t]) => `<button type="button" class="chip ${state.frzZoom === k ? 'on' : ''}" data-z="${k}">${t}</button>`).join('')}
        </div>
        <div id="frzAmtBox" ${state.frzZoom === 'none' ? 'hidden' : ''}>
          <div class="row" style="margin-top:14px"><b>Zoom အား</b><span id="frzAmtV">${state.frzAmt}%</span></div>
          ${pmRow('frzAmt', 5, 50, 5, state.frzAmt)}
        </div>
      </div>
        </div>
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px;${premPlan() ? '' : 'opacity:.55'}">
        <input id="fxHD" type="checkbox" style="${chk}" ${premPlan() ? '' : 'disabled'} ${state.fxHD && premPlan() ? 'checked' : ''} />
        📺 1080p (Quality မြင့်) <span class="pbadge">💎 Premium</span>
      </label>
      <p class="muted small" style="margin:4px 0 0">${premPlan()
        ? 'Monetization အတွက် Quality မြင့်မြင့် ထုတ်ပါ။ 720p ထက် ၂ ဆလောက် ပိုကြာပါတယ်။ မူရင်း Video က 1080p မပြည့်ရင် မူရင်းအရွယ်အတိုင်းပဲ ထွက်ပါမယ်။'
        : '💎 Premium ဝယ်ထားသူတွေပဲ 1080p နဲ့ ထုတ်လို့ရပါတယ်။'}</p>
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="fxMirror" type="checkbox" style="${chk}" ${state.fxMirror ? 'checked' : ''} />
        ↔ Mirror (ဘယ်ညာ လှန်မည်)
      </label>
      </div>
      <div class="pane" data-pane="caps">
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="fxSubs" type="checkbox" style="${chk}" ${state.fxSubs ? 'checked' : ''} />
        💬 မြန်မာစာတန်းထိုး ထည့်မည်
      </label>
      <div id="subBox" ${state.fxSubs ? '' : 'hidden'}>
        <div class="row" style="margin-top:14px"><b>🔠 စာလုံး အရွယ်အစား</b><span id="ssv">${(+state.subS).toFixed(1)}%</span></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <button type="button" class="ghost" id="subSm" aria-label="လျှော့မည်" style="width:48px;height:48px;padding:0;margin:0;flex:none;font-size:26px;line-height:1">−</button>
          <input id="subS" type="range" min="3" max="12" step="0.5" value="${state.subS}" style="flex:1;margin:0" />
          <button type="button" class="ghost" id="subSp" aria-label="တိုးမည်" style="width:48px;height:48px;padding:0;margin:0;flex:none;font-size:26px;line-height:1">+</button>
        </div>
        <div id="subYBox" ${state.fxBlur ? 'hidden' : ''}>
          <div class="row" style="margin-top:14px"><b>⇅ စာတန်း အပေါ်အောက် နေရာ</b><span id="syv">${state.subY}%</span></div>
          <input id="subY" type="range" min="5" max="95" value="${state.subY}" />
        </div>
        <p class="muted small" style="margin:8px 0 0">Blur ဖွင့်ထားရင် စာတန်းကို Blur ဘားရဲ့ အလယ်မှာ ချပေးပါမယ်။</p>
        <div class="row" style="margin-top:12px">
          <label style="margin:0;display:flex;align-items:center;gap:8px">စာလုံးအရောင်
            <input id="subC" type="color" value="${state.subC}" style="width:48px;height:36px;padding:2px;margin:0" /></label>
          <label style="margin:0;display:flex;align-items:center;gap:8px">အနားသတ်
            <input id="subO" type="color" value="${state.subO}" style="width:48px;height:36px;padding:2px;margin:0" /></label>
        </div>
        <label>Font
          <select id="subFont">
            <option value="system" ${state.subFont === 'system' ? 'selected' : ''}>ဖုန်း Font (default)</option>
            ${L.BUILTIN_FONTS.map(b => `<option value="${b.id}" ${state.subFont === b.id ? 'selected' : ''}>${b.label}</option>`).join('')}
            <option value="custom" ${state.subFont === 'custom' ? 'selected' : ''} ${state.fontOk ? '' : 'disabled'}>ကိုယ်တိုင်တင်ထားတဲ့ Font</option>
          </select>
        </label>
        <div class="two">
          <button class="btn" id="fontDl" type="button">⬇ Noto Sans Myanmar ဒေါင်းမည်</button>
          <label class="btn" style="margin:0;text-align:center;cursor:pointer">📁 Font ဖိုင် တင်မည်
            <input id="fontUp" type="file" accept=".ttf,.otf,.woff,.woff2" hidden /></label>
        </div>
        <p class="muted small" id="fontSt" style="margin:8px 0 0"></p>
      </div>
      </div>
      <div class="pane" data-pane="extra">
        <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:14px">
          <input id="wmOn" type="checkbox" style="${chk}" ${state.wmOn ? 'checked' : ''} /> 🏷 Watermark စာသား
        </label>
        <div id="wmBox" ${state.wmOn ? '' : 'hidden'}>
          <input id="wmText" type="text" placeholder="ဥပမာ - @ChannelName" value="${state.wmText.replace(/"/g, '&quot;')}" style="margin-top:8px" />
          <div class="row" style="margin-top:12px"><b>နေရာ</b></div>
          <div class="chips" data-pos="wmPos">${posChips()}</div>
          <div class="row" style="margin-top:14px"><b>အရွယ်အစား</b><span id="wmSizeV">${state.wmSize}%</span></div>
          ${pmRow('wmSize', 2, 10, 1, state.wmSize)}
          <div class="row" style="margin-top:14px"><b>အရောင်မှိန်မှု (Opacity)</b><span id="wmOpV">${state.wmOp}%</span></div>
          ${pmRow('wmOp', 10, 100, 5, state.wmOp)}
        </div>
        <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:18px">
          <input id="logoOn" type="checkbox" style="${chk}" ${state.logoOn ? 'checked' : ''} /> ⭕ Logo (စက်ဝိုင်း)
        </label>
        <div id="logoBox" ${state.logoOn ? '' : 'hidden'}>
          <label class="btn" style="display:block;margin:8px 0 0;text-align:center;cursor:pointer" id="logoPick"><span id="logoPickTxt">🖼 ${state.logoData ? 'Logo ပြောင်းမည်' : 'Logo ပုံ ရွေးမည်'}</span>
            <input id="logoUp" type="file" accept="image/*" hidden /></label>
          <div class="row" style="margin-top:12px"><b>နေရာ</b></div>
          <div class="chips" data-pos="logoPos">${posChips()}</div>
          <div class="row" style="margin-top:14px"><b>အရွယ်အစား</b><span id="logoSizeV">${state.logoSize}%</span></div>
          ${pmRow('logoSize', 5, 40, 1, state.logoSize)}
        </div>
      </div>
      <p class="muted small">⚠ Mirror၊ Blur၊ စာတန်းထိုး တစ်ခုခု ဖွင့်ရင် Video ကို ပြန် encode လုပ်ရလို့ ပိုကြာပါတယ် (ဖုန်းမှာ ငါးမိနစ်ထက်မက ကြာနိုင်ပါတယ်)။ မဖွင့်ရင် အရင်လိုပဲ မြန်ပါတယ်။</p>
    </div>`;
}

function bindPreview() {
  const v = $('#pvVid'), ov = $('#pvBlur');
  if (!v || !ov) return;
  const box = $('#pvBox'), inner = $('#pvInner'), bg = $('#pvBg');
  const apply = () => {
    const r = RATIO_NUM[state.fxRatio];
    const ar = r || (v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9);
    box.style.aspectRatio = String(ar); box.style.width = `min(100%, calc(36vh * ${ar}))`;
    inner.style.position = 'absolute'; inner.style.inset = '0';
    v.style.height = '100%'; v.style.objectFit = (r && state.fxFit === 'crop') ? 'cover' : 'contain';
    bg.style.display = (r && state.fxFit === 'pad') ? 'block' : 'none';
    const hd = document.querySelector('header.top'); if (hd) $('#pvSticky').style.top = hd.offsetHeight + 'px';
    inner.style.transform = `${state.fxMirror ? 'scaleX(-1) ' : ''}scale(${state.fxZoom / 100})`;
    const fb = $('#fitBox'); if (fb) fb.hidden = !r;
    document.querySelectorAll('#ratioChips .chip').forEach(c => c.classList.toggle('on', c.dataset.r === state.fxRatio));
    document.querySelectorAll('#fitChips .chip').forEach(c => c.classList.toggle('on', c.dataset.f === state.fxFit));
    document.querySelectorAll('#fxTabs button').forEach(c => c.classList.toggle('on', c.dataset.tab === state.tab));
    document.querySelectorAll('.fx .pane').forEach(p => { p.hidden = p.dataset.pane !== state.tab; });
    document.querySelectorAll('[data-pos]').forEach(g => g.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.p === state[g.dataset.pos])));
    const bw = box.clientWidth || 300, bh = box.clientHeight || 200, mn = Math.min(bw, bh), mg = Math.round(mn * 0.035);
    const place = (el, pos) => {
      el.style.left = el.style.right = el.style.top = el.style.bottom = '';
      el.style[pos.endsWith('l') ? 'left' : 'right'] = mg + 'px';
      el.style[pos.startsWith('t') ? 'top' : 'bottom'] = mg + 'px';
    };
    const wm = $('#pvWm');
    if (wm) {
      const on = state.wmOn && state.wmText.trim();
      wm.style.display = on ? 'block' : 'none';
      if (on) { wm.textContent = state.wmText; wm.style.fontSize = Math.max(8, Math.round(mn * state.wmSize / 100)) + 'px'; wm.style.fontFamily = L.subFontFamily(selFont()); wm.style.opacity = String(state.wmOp / 100); place(wm, state.wmPos); }
    }
    const lg = $('#pvLogo');
    if (lg) {
      const on = state.logoOn && state.logoData;
      lg.style.display = on ? 'block' : 'none';
      if (on) { if (lg.src !== state.logoData) lg.src = state.logoData; const d = Math.round(mn * state.logoSize / 100); lg.style.width = lg.style.height = d + 'px'; place(lg, state.logoPos); }
    }
    ov.style.display = state.fxBlur ? 'block' : 'none';
    ov.style.height = state.blurH + '%';
    const bpx = Math.max(1, Math.round((state.blurS / 100) * 40 / 2));          // ffmpeg sigma/2 ~ preview px
    ov.style.backdropFilter = ov.style.webkitBackdropFilter = `blur(${bpx}px)`;
    ov.style.opacity = String(Math.max(0.2, state.blurO / 100));
    ov.style.top = ((state.blurY / 100) * (100 - state.blurH)) + '%';
    const yb = $('#subYBox'); if (yb) yb.hidden = state.fxBlur;
    const sb = $('#pvSub');
    if (sb) {
      sb.style.display = state.fxSubs ? 'block' : 'none';
      const wh = v.clientHeight || 200;
      sb.style.fontSize = Math.max(8, Math.round(wh * state.subS / 100)) + 'px';
      sb.style.color = state.subC;
      const o = state.subO;
      sb.style.textShadow = `-1.5px -1.5px 0 ${o},1.5px -1.5px 0 ${o},-1.5px 1.5px 0 ${o},1.5px 1.5px 0 ${o},0 2px 3px ${o}`;
      sb.style.fontFamily = L.subFontFamily(selFont());
      sb.style.top = (state.fxBlur ? (state.blurY / 100) * (100 - state.blurH) + state.blurH / 2 : state.subY) + '%';
    }
  };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const bgv = $('#pvBg');
  const syncBg = () => { if (bgv.style.display === 'none') return; if (Math.abs(bgv.currentTime - v.currentTime) > 0.3) bgv.currentTime = v.currentTime; };
  v.addEventListener('play', () => { syncBg(); bgv.play().catch(() => {}); });
  v.addEventListener('pause', () => bgv.pause());
  v.addEventListener('seeked', syncBg); v.addEventListener('timeupdate', syncBg);
  $('#pvPlay').onclick = () => { v.paused ? v.play() : v.pause(); };
  v.onclick = () => $('#pvPlay').click();
  v.onplay = () => { $('#pvPlay').textContent = '⏸'; };
  v.onpause = () => { $('#pvPlay').textContent = '▶'; };
  v.ontimeupdate = () => {
    if (v.duration) $('#pvSeek').value = Math.round((v.currentTime / v.duration) * 1000);
    $('#pvT').textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration);
  };
  $('#pvSeek').oninput = e => { if (v.duration) v.currentTime = (e.target.value / 1000) * v.duration; };
  document.querySelectorAll('#fxTabs button').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; apply(); });
  document.querySelectorAll('#ratioChips .chip').forEach(b => b.onclick = () => { state.fxRatio = b.dataset.r; apply(); });
  document.querySelectorAll('#fitChips .chip').forEach(b => b.onclick = () => { state.fxFit = b.dataset.f; apply(); });
  document.querySelectorAll('[data-pos] .chip').forEach(b => b.onclick = () => { state[b.parentElement.dataset.pos] = b.dataset.p; apply(); });
  $('#wmOn').onchange = e => { state.wmOn = e.target.checked; $('#wmBox').hidden = !state.wmOn; apply(); };
  $('#wmText').oninput = e => { state.wmText = e.target.value; apply(); };
  $('#logoOn').onchange = e => { state.logoOn = e.target.checked; $('#logoBox').hidden = !state.logoOn; apply(); };
  $('#logoUp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { state.logoData = await fileToLogo(f); $('#logoPickTxt').textContent = '🖼 Logo ပြောင်းမည်'; apply(); }
    catch (err) { toast(err.message); }
  };
  $('#fxFast').onchange = e => { state.fxFast = e.target.checked; if (state.fxFast && state.fxHD) { state.fxHD = false; $('#fxHD').checked = false; } };
  $('#fxHD').onchange = e => {                                 // 1080p and 720p can't both be on
    state.fxHD = e.target.checked && premPlan();
    if (state.fxHD) { state.fxFast = false; $('#fxFast').checked = false; toast('📺 1080p နဲ့ ထုတ်ပါမယ် — ၂ ဆလောက် ပိုကြာပါမယ်'); }
  };
  $('#fxFps30').onchange = e => { state.fxFps30 = e.target.checked; };
  $('#fxUnlock').onchange = e => {
    state.fxUnlock = e.target.checked;
    const box = $('#lockBox');
    box.classList.toggle('locked', !state.fxUnlock);
    if (state.fxUnlock) box.removeAttribute('inert'); else box.setAttribute('inert', '');
    $('#fxUnlockT').textContent = (state.fxUnlock ? '🔓' : '🔒') + ' ' + LOCK_T;
  };
  $('#fxMirror').onchange = e => { state.fxMirror = e.target.checked; apply(); };
  // find the source subtitles and put the blur band on them (once per video when Blur is switched on)
  const autoBlur = async () => {
    const b = $('#blurAuto'), msg = $('#blurAutoMsg'), f = state.file;
    if (!b || !f) return;
    b.disabled = true; b.textContent = '✨ စာတန်း ရှာနေပါတယ်…';
    const r = await L.findSubBand(f).catch(() => null);
    state.blurAutoFor = f;
    if (!$('#blurAuto')) return;                              // left the page meanwhile
    b.disabled = false; b.textContent = '✨ စာတန်းနေရာ အလိုလို ရှာမည်';
    if (!r) { msg.textContent = '⚠ စာတန်း သေချာ မတွေ့ပါ — အောက်က ⇅ နဲ့ ↕ ကို ကိုယ်တိုင် ညှိပါ'; return; }
    state.blurH = Math.max(3, Math.min(40, Math.round(r.height * 100)));
    state.blurY = r.height >= 1 ? 100 : Math.max(0, Math.min(100, Math.round(r.top / (1 - r.height) * 100)));
    $('#blurH').value = state.blurH; $('#bhv').textContent = state.blurH + '%';
    $('#blurY').value = state.blurY; $('#byv').textContent = state.blurY + '%';
    msg.textContent = '✅ စာတန်းနေရာ တွေ့ပြီး Blur ချိန်ပြီးပါပြီ — Preview မှာ စစ်ကြည့်ပါ';
    apply();
  };
  $('#blurAuto')?.addEventListener('click', autoBlur);
  // Blur is on by default: put the band on this video's subtitles as soon as it is loaded
  if (state.fxBlur && state.file && state.blurAutoFor !== state.file) autoBlur();
  $('#fxBlur').onchange = e => {
    state.fxBlur = e.target.checked; $('#blurBox').hidden = !state.fxBlur; apply();
    if (state.fxBlur && state.file && state.blurAutoFor !== state.file) autoBlur();
  };
  $('#blurH').oninput = e => { state.blurH = +e.target.value; $('#bhv').textContent = e.target.value + '%'; apply(); };
  $('#blurY').oninput = e => { state.blurY = +e.target.value; $('#byv').textContent = e.target.value + '%'; apply(); };
  const bindPM = (id, key, min, max, step) => {
    const set = x => {
      state[key] = Math.max(min, Math.min(max, Math.round(x / step) * step));
      $('#' + id).value = state[key]; $('#' + id + 'V').textContent = state[key] + '%'; apply();
    };
    $('#' + id).oninput = e => set(+e.target.value);
    $('#' + id + 'M').onclick = () => set(state[key] - step);
    $('#' + id + 'P').onclick = () => set(state[key] + step);
  };
  bindPM('blurS', 'blurS', 5, 100, 5);
  $('#frzOn').onchange = e => { state.frzOn = e.target.checked; $('#frzBox').hidden = !state.frzOn; };
  for (const [id, key, min, max, step, unit] of [['frzA', 'frzA', 1, 15, 1, ' စက္ကန့်'], ['frzB', 'frzB', 1, 6, 0.5, ' စက္ကန့်'], ['frzAmt', 'frzAmt', 5, 50, 5, '%']]) {
    const set = x => { state[key] = Math.max(min, Math.min(max, Math.round(x / step) * step)); $('#' + id).value = state[key]; $('#' + id + 'V').textContent = state[key] + unit; };
    $('#' + id).oninput = e => set(+e.target.value);
    $('#' + id + 'M').onclick = () => set(state[key] - step);
    $('#' + id + 'P').onclick = () => set(state[key] + step);
  }
  view.querySelectorAll('#frzZChips .chip').forEach(b => { b.onclick = () => {
    state.frzZoom = b.dataset.z;
    view.querySelectorAll('#frzZChips .chip').forEach(x => x.classList.toggle('on', x === b));
    $('#frzAmtBox').hidden = state.frzZoom === 'none';
  }; });
  bindPM('fxZoom', 'fxZoom', 100, 250, 10);
  bindPM('wmSize', 'wmSize', 2, 10, 1);
  bindPM('wmOp', 'wmOp', 10, 100, 5);
  bindPM('logoSize', 'logoSize', 5, 40, 1);
  bindPM('blurO', 'blurO', 20, 100, 5);

  /* subtitles */
  const fontStatus = msg => {
    const o = $('#subFont option[value="custom"]'); if (o) o.disabled = !state.fontOk;
    const el = $('#fontSt'); if (!el) return;
    if (msg) { el.textContent = msg; return; }
    const b = L.BUILTIN_FONTS.find(x => x.id === state.subFont);
    el.textContent = b ? `✅ ${b.label} ကို သုံးမည်`
      : state.subFont === 'custom' ? (state.fontOk ? '✅ ကိုယ်တိုင်တင်ထားတဲ့ Font ကို သုံးမည်' : 'Font မတင်ရသေးပါ')
      : 'ဖုန်း Font ကို သုံးမည် (မြန်မာစာ ကွက်လပ်ပေါ်ရင် တခြား Font ရွေးပါ)';
  };
  const useFont = async () => {
    const b = L.BUILTIN_FONTS.find(x => x.id === selFont());
    if (b) fontStatus(`⏳ ${b.label} ဖွင့်နေသည်…`); else fontStatus();
    try { await L.ensureSubFont(selFont()); fontStatus(); }
    catch (e) { fontStatus(`❌ Font ဖွင့်မရပါ (${String((e && e.message) || e).slice(0, 80)}) — ဖုန်း Font ကို သုံးပါမယ်`); toast('Font ဖွင့်မရပါ'); }
    apply();
  };
  $('#fxSubs').onchange = e => { state.fxSubs = e.target.checked; $('#subBox').hidden = !state.fxSubs; apply(); };
  const setS = v => {
    state.subS = Math.max(3, Math.min(12, Math.round(v * 2) / 2));
    $('#subS').value = state.subS; $('#ssv').textContent = state.subS.toFixed(1) + '%'; apply();
  };
  $('#subS').oninput = e => setS(+e.target.value);
  $('#subSm').onclick = () => setS(state.subS - 0.5);
  $('#subSp').onclick = () => setS(state.subS + 0.5);
  $('#subY').oninput = e => { state.subY = +e.target.value; $('#syv').textContent = e.target.value + '%'; apply(); };
  $('#subC').oninput = e => { state.subC = e.target.value; apply(); };
  $('#subO').oninput = e => { state.subO = e.target.value; apply(); };
  $('#subFont').onchange = e => { state.subFont = e.target.value; useFont(); };
  $('#fontDl').onclick = async () => {
    const b = $('#fontDl'); b.disabled = true; b.textContent = 'ဒေါင်းနေသည်…';
    try {
      await L.downloadDefaultFont();
      state.fontOk = true; state.subFont = 'custom'; fontStatus(); $('#subFont').value = 'custom';
      toast('✅ Font အဆင်သင့်ပါပြီ');
    } catch (err) { toast((err.message || 'Font ဒေါင်းမရပါ').slice(0, 80)); }
    b.disabled = false; b.textContent = '⬇ Noto Sans Myanmar ဒေါင်းမည်';
    fontStatus(); apply();
  };
  $('#fontUp').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      await L.saveSubFont(file);
      state.fontOk = true; state.subFont = 'custom'; fontStatus(); $('#subFont').value = 'custom';
      toast('✅ Font တင်ပြီးပါပြီ');
    } catch { toast('Font ဖိုင် မမှန်ပါ (.ttf / .otf / .woff2)'); }
    fontStatus(); apply();
  };
  v.onloadedmetadata = apply;
  fontStatus();
  L.loadSubFont().then(ok => { if (ok && !state.fontOk) { state.fontOk = true; fontStatus(); apply(); } });
  useFont();
  apply();
}

// "paste a TikTok link → Load": the downloaded video is used exactly like a picked file
let linkBusy = false;
function bindLinkBox() {
  const inp = $('#lnk');
  $('#lnkPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); inp.value = L.findLink(t) || t.trim(); inp.focus(); }
    catch { toast('Paste လုပ်ခွင့် မရပါ — link ကို ကွက်ထဲမှာ ဖိပြီး Paste လုပ်ပါ'); }
  };
  inp.onkeydown = e => { if (e.key === 'Enter') $('#lnkLoad').click(); };
  $('#lnkLoad').onclick = async () => {
    if (linkBusy) return;
    const link = L.findLink(inp.value) || inp.value.trim();
    if (!link) { toast('Link ကို အရင်ထည့်ပါ'); inp.focus(); return; }
    if (!L.isTikTok(link)) { toast(/youtu/i.test(link) ? 'YouTube link ကို မရပါ — YouTube Video ကို ဖုန်းထဲ အရင်ဒေါင်းပြီး ဖိုင်အနေနဲ့ တင်ပါ' : 'TikTok link မဟုတ်ပါ'); return; }
    linkBusy = true; state.busy = true; renderStepper();
    $('#lnkErr').hidden = true;
    const btns = [$('#lnkLoad'), $('#lnkPaste'), $('#f')]; btns.forEach(b => { if (b) b.disabled = true; }); inp.disabled = true;
    $('#lnkProg').hidden = false;
    const setP = (frac, bytes) => {
      const f = $('#lnkFill'); if (!f) return;
      f.style.width = (frac ? Math.round(frac * 100) : Math.min(90, Math.round(bytes / 400000))) + '%';
      $('#lnkNum').textContent = frac ? Math.round(frac * 100) + '%' : (bytes / 1048576).toFixed(1) + ' MB';
    };
    $('#lnkTxt').textContent = 'TikTok ကနေ Video ယူနေပါတယ်…';
    try {
      const { file, duration } = await L.loadTikTok(link, setP);
      state.file = file; state.segs = []; state.origSegs = null; L.forgetInput();
      linkBusy = false; state.busy = false;
      step1(); renderStepper();
      toast(duration > 900 ? '⚠ Video က ၁၅ မိနစ်ထက် ရှည်ပါတယ် — ကြာနိုင်ပါတယ်' : '✅ TikTok Video ရပါပြီ');
    } catch (e) {
      linkBusy = false; state.busy = false; renderStepper();
      btns.forEach(b => { if (b) b.disabled = false; }); inp.disabled = false;
      $('#lnkProg').hidden = true;
      const box = $('#lnkErr');
      box.textContent = String((e && e.message) || e);
      if (e && e.detail) box.insertAdjacentHTML('beforeend', `<small style="display:block;margin-top:6px;opacity:.75;word-break:break-all">${esc(e.detail)}</small>`);
      box.hidden = false;
    }
  };
}

function step1() {
  view.innerHTML = `
    <h2>Video တင်ပါ</h2>
    ${acc.on && acc.ok ? `<p class="muted small quota">🎟 ${esc(acc.name)} · <b>${quotaTxt()}</b>${premPlan() ? ` · <span class="pbadge">💎 Premium</span>` : ''}</p>` : ''}
    ${premPlan() && !(acc.credits > 0) ? `<div class="tip">💎 Credit ကုန်နေပါပြီ — <a href="${TG_BOT}" target="_blank" rel="noopener"><b>Telegram မှာ ထပ်ဝယ်ပါ</b></a></div>` : ''}
    <label class="drop ${state.file ? 'has' : ''}" for="f">
      <input id="f" type="file" accept="video/*" hidden />
      <b>${state.file ? esc(state.file.name) : 'နှိပ်၍ Video File ရွေးချယ်ပါ'}</b>
      <span class="muted small">${state.file ? (state.file.size / 1048576).toFixed(1) + ' MB' : 'MP4, MOV, WEBM, MKV · ၁၀ မိနစ်အထိ'}</span>
    </label>
    <div class="linkbox">
      <div class="ordiv"><span>ဒါမှမဟုတ် link ထည့်ပါ</span></div>
      <div class="linkrow">
        <input id="lnk" type="url" inputmode="url" autocomplete="off" placeholder="TikTok link ကို ဒီမှာ ထည့်ပါ" />
        <button type="button" class="btn" id="lnkPaste" aria-label="Paste">📋</button>
        <button type="button" class="btn primary" id="lnkLoad">🔗 Load</button>
      </div>
      <div id="lnkErr" class="err" hidden></div>
      <div id="lnkProg" hidden><div class="bar"><i id="lnkFill"></i></div><div class="pct"><span id="lnkTxt">ဒေါင်းနေပါတယ်…</span><b id="lnkNum">0%</b></div></div>
      <p class="muted small" style="margin:6px 2px 0">Link ရနိုင်တာ: <b>TikTok</b> · YouTube Video တွေကို ဖုန်းထဲ အရင်ဒေါင်းပြီး ဖိုင်အနေနဲ့ တင်ပါ</p>
    </div>
    ${state.file ? previewBlock() : ''}
    <p id="cost" hidden></p>
    <label>မူရင်းစကားပြောဘာသာ
      <select id="lang">
        ${[['zh', 'Chinese 中文'], ['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['auto', 'Auto detect']]
          .map(([v, t]) => `<option value="${v}" ${v === state.lang ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>
    <p class="tip small" style="margin:6px 0 0">💡 Video ထဲက ပြောတဲ့ဘာသာကို ရွေးပေးပါ — တရုတ်ကားဆို <b>Chinese 中文</b>။ Auto detect က Video အစပိုင်းကို နားထောင်ပြီး ခန့်မှန်းတာမို့ အစမှာ သီချင်း၊ ဆူညံသံ ဒါမှမဟုတ် တခြားဘာသာ ရောနေရင် မှားခန့်မှန်းပြီး စာသား လွဲထွက်တတ်ပါတယ်။ ဘာသာ မှန်မှန်ရွေးထားရင် စာသားရော ဘာသာပြန်ရော ပိုမှန်ပါတယ်။</p>
    ${premPlan() ? `<div class="panel" style="margin-top:16px">
      <b>⚡ One-Click Auto <span class="pbadge">💎 Premium</span></b>
      <p class="muted small" style="margin:6px 0 10px">ဘာသာပြန်ပုံစံနဲ့ အသံကို ရွေးပြီး <b>⚡ Auto နဲ့ Video ထုတ်မည်</b> ကိုနှိပ်ရင် စာသားထုတ် → ဘာသာပြန် → အသံထုတ် → Video ပေါင်း အကုန် အလိုအလျောက် လုပ်ပေးပါမယ်။${IS_IOS ? ' 🌐 iPhone မှာ VPN (US) ဖွင့်ထားပါ။' : ''}</p>
      <b class="small">✍ ဘာသာပြန်ပုံစံ</b>
      <div class="chips" id="aStyle" style="margin:6px 0 0">${[['recap', '🔥', 'Recap', 'လှုပ်ရှား'], ['chat', '💬', 'ရိုးရိုး', 'စကားပြော'], ['dub', '🎭', 'ဇာတ်ကောင်', 'Beta']].map(([k, i, t, sub]) => `<button type="button" class="chip ${state.pStyle === k ? 'on' : ''}" data-s="${k}"><i>${i}</i><span>${t}</span><small>${sub}</small></button>`).join('')}</div>
      <p class="muted small" style="margin:6px 0 0">🎭 <b>ဇာတ်ကောင်စကား</b> (စမ်းသပ်ဆဲ) — ဇာတ်ကောင်တွေ ပြောတဲ့အတိုင်း ဘာသာပြန်ပြီး ယောကျ်ားစကားကို သီဟ၊ မိန်းမစကားကို နီလာ အသံနဲ့ အလိုလို ခွဲထုတ်ပေးပါတယ်</p>
      ${voiceBlock()}
    </div>` : ''}
    <div style="position:sticky;bottom:0;z-index:4;margin:12px -6px 0;padding:10px 6px;background:linear-gradient(180deg,rgba(20,20,23,0),#141417 35%)">
      ${premPlan() ? `<button id="autoGo" class="btn primary" style="margin:0 0 8px" ${state.file ? '' : 'disabled'}>⚡ Auto နဲ့ Video ထုတ်မည်</button>` : ''}
      <button id="next" class="btn ${premPlan() ? '' : 'primary'}" style="margin:0" ${state.file ? '' : 'disabled'}>${premPlan() ? 'အဆင့်လိုက် ကိုယ်တိုင်ပြင်မည် (Next)' : 'စာသားထုတ်မည် (Next)'}</button>
    </div>`;
  $('#f').onchange = e => { state.file = e.target.files[0] || null; state.segs = []; state.origSegs = null; L.forgetInput(); step1(); };
  $('#lang').onchange = e => { state.lang = e.target.value; };
  bindLinkBox();
  if (state.file) bindPreview();
  if (state.file) {                                         // the length: cost line (Premium) and the time-left estimate
    const f = state.file;
    L.videoDuration(f).then(d => { if (state.file === f && d) { state.videoDur = d; costLine($('#cost'), d); } }).catch(() => {});
  }
  $('#next').onclick = () => {
    if (!L.cfg.aaiKey && !L.premium.on && !L.freeKey.on) { toast('API Key အရင်ထည့်ပါ'); openPage('keys'); return; }
    state.segs.length ? go(2) : transcribeFlow();
  };
  if (premPlan()) {
    view.querySelectorAll('#aStyle .chip').forEach(c => c.onclick = () => {
      state.pStyle = c.dataset.s; view.querySelectorAll('#aStyle .chip').forEach(x => x.classList.toggle('on', x === c));
    });
    bindVoice(step1);
    // one tap: transcribe (unless done already) -> AI translation -> voice + render -> the usual result page
    $('#autoGo').onclick = () => {
      if (!(acc.credits > 0) && !L.premium.on) { toast('💎 Credit ကုန်နေပါပြီ — Telegram မှာ ထပ်ဝယ်ပါ'); return; }
      state.autoRun = true; prun = null;                      // the progress card shows all four stages until the video is out
      state.segs.length ? autoRest() : transcribeFlow(true);
    };
  }
}

// 🎭 style: man or woman for each line — the AI's guess from the story, AssemblyAI's speaker letters and the
// voice pitch; the user can still flip any line in step 3. Never fails: anything unknown gets the chosen voice.
async function ensureGenders(onStatus) {
  if (state.pStyle !== 'dub' || (state.genders && state.genders.length === state.segs.length)) return;
  if (onStatus) onStatus('ယောကျ်ား / မိန်းမ အသံ ခွဲနေပါတယ်');
  const main = L.PERSONAS.find(p => p.id === state.personaId)?.g === 'Female' ? 'F' : 'M';
  const [ai, f0] = await Promise.all([
    L.guessGenders(state.segs).catch(() => []),
    state.audioBlob ? L.linePitch(state.audioBlob, state.segs).catch(() => []) : []
  ]);
  state.genders = L.pickVoices(state.segs, ai, f0, main);
}

// One-Click Auto, after the transcript: AI translation, then straight to the render (step 4).
// Lines the AI left empty go to step 3 to fill in; an AI error goes to step 2 (Copy Full Prompt still works there).
async function autoRest() {
  state.step = 3; state.busy = true; renderStepper();
  view.innerHTML = bar();
  const stopClock = startClock();
  const t0 = Date.now(), T = Math.max(10, state.segs.length * 0.6);
  let real = 0;
  const show = () => setProg(Math.max(real, 0.9 * (1 - Math.exp(-(Date.now() - t0) / 1000 / T))), 'AI နဲ့ မြန်မာလို ဘာသာပြန်နေပါတယ်');
  show();
  const tick = setInterval(show, 500);
  try {
    const t = await L.autoTranslate(state.segs, state.pStyle, p => { real = Math.max(real, p); }).finally(() => clearInterval(tick));
    await ensureGenders(txt => setProg(0.95, txt));
    stopClock(); state.busy = false;
    state.burmese = state.segs.map((_, i) => t[i] || '');
    const miss = state.burmese.filter(x => !x).length;
    if (miss) { state.autoRun = false; toast(`⚠ ${miss} ကြောင်း ဘာသာမပြန်နိုင်ပါ — ဖြည့်ပြီး "အသံထုတ်ပြီး Video ပေါင်းမည်" ကိုနှိပ်ပါ`); go(3); return; }
    clearResult();
    go(4, { render: true });
  } catch (e) {
    stopClock(); state.busy = false; state.autoRun = false;
    go(2);
    toast(e.message.slice(0, 140));
  }
}

async function transcribeFlow(auto = false) {
  state.step = 2; state.busy = true; renderStepper();
  view.innerHTML = bar();
  const stopClock = startClock();
  try {
    setProg(0.02, 'Engine ပြင်ဆင်နေသည်');
    await L.getFFmpeg();
    state.videoDur = await L.videoDuration(state.file).catch(() => 0);   // browser can't decode some codecs; ffmpeg still can
    setProg(0.05, 'အသံ ဆွဲထုတ်နေသည်');
    const wav = await L.extractAudio(state.file, p => setProg(0.05 + p * 0.2, 'အသံ ဆွဲထုတ်နေသည်'));
    if (!state.videoDur) state.videoDur = wav.secs || 0;
    const names = { uploading: `Server သို့ ပို့နေပါသည် (${(wav.size / 1048576).toFixed(1)} MB)`, queued: 'တန်းစီစောင့်နေသည်', processing: 'စာသားထုတ်ယူနေပါသည်' };
    let tick = 0.3;
    state.origSegs = null;
    state.segs = await L.transcribe(wav, state.lang, st => { tick = Math.min(tick + 0.04, 0.95); setProg(tick, names[st] || st); },
      { speakers: state.pStyle === 'dub' && premPlan() });
    state.audioBlob = wav; state.genders = null;
    state.burmese = []; state.busy = false;
    if (premPlan()) L.accessCheck().then(r => { if (r && r.name) setQuota(r); }).catch(() => {});   // credits left after this video
    stopClock();
    if (auto) return autoRest();
    go(2);
  } catch (e) {
    stopClock();
    view.innerHTML = `<h2>အမှားရှိနေပါသည်</h2>`; showErr(e);
    errTip('⚠ <b>VPN ချိတ်ထားရင် ဖြုတ်ပြီး</b> ပြန်ကြိုးစားပါ။ Wi-Fi / Internet ကောင်းမကောင်းလည်း စစ်ပါ။ (AssemblyAI Key မှန်လားဆိုတာ API Key Settings → 🔎 စစ်ဆေးမည် နဲ့ စစ်နိုင်ပါတယ်)');
    state.busy = false; state.autoRun = false; renderStepper();
    view.insertAdjacentHTML('beforeend', `<button class="btn primary" id="back">ဗီဒီယိုတင် အဆင့်သို့ ပြန်သွားမည်</button>`);
    $('#back').onclick = () => go(1);
  }
}

/* ---------------- Step 2 ---------------- */
function step2() {
  view.innerHTML = `
    <div class="row"><h2>မူရင်းစာသားကို စစ်ဆေးပါ</h2><button class="ghost" id="back">‹ နောက်သို့</button></div>
    <p class="muted">စာကြောင်းတစ်ကြောင်းလျှင် အချိန်တစ်ခု ကိုက်ထားသည်။ စာကြောင်းအရေအတွက် မပြောင်းပါနှင့်။ (${state.segs.length} lines)</p>
    <textarea id="src">${esc(state.segs.map(s => s.text).join('\n'))}</textarea>
    <div class="chips" id="pStyle" style="margin:0 0 8px"><button type="button" class="chip" data-s="recap">🔥 Recap (လှုပ်ရှား)</button><button type="button" class="chip" data-s="chat">💬 ရိုးရိုးစကားပြော</button>${premPlan() ? '<button type="button" class="chip" data-s="dub">🎭 ဇာတ်ကောင်စကား · Beta</button>' : ''}</div>
    ${isPremium() ? `<button id="autoTr" class="btn primary block">✨ Auto ဘာသာပြန်မည် <span class="pbadge">💎 Premium</span></button>
    <p class="muted small" style="margin:4px 0 10px">ခလုတ်တစ်ချက်နဲ့ AI က မြန်မာလို ဘာသာပြန်ပေးပါမယ် (စာကြောင်းများရင် ၁ မိနစ်လောက် ကြာနိုင်ပါတယ်)။</p>` : ''}
    <button id="copy" class="btn block">📋 Prompt ကူးပြီး Gemini ဖွင့်မည်</button>
    <div class="panel">
      <b>🤖 Gemini App ဖြင့် ဘာသာပြန်ရန် (Free)</b>
      <p class="muted small">Prompt ကို Copy ကူးပြီး Gemini တွင် Paste လုပ်ပါ။ ရလာသော JSON ကို အောက်တွင် ထည့်ပါ။</p>
      <a class="link" href="https://gemini.google.com/app" target="_blank" rel="noopener">Gemini App ဖွင့်မည် ↗</a>
      <label>Gemini မှ ရလာသော JSON
        <textarea id="json" class="short" placeholder='{"translations": ["မြန်မာစာ ၁", "မြန်မာစာ ၂", ...]}'></textarea>
      </label>
      <button id="next" class="btn primary">ဘာသာပြန်အတည်ပြုမည် (Next)</button>
    </div>`;
  if (state.burmese.length) $('#json').value = JSON.stringify({ translations: state.burmese }, null, 1);
  $('#src').oninput = () => {
    const l = trimTail($('#src').value.split('\n').map(x => x.trim()), state.segs.length);
    if (l.length === state.segs.length) l.forEach((t, i) => { state.segs[i].text = t; });
  };
  const syncSrc = () => {
    const lines = trimTail($('#src').value.split('\n').map(x => x.trim()), state.segs.length);
    if (lines.length !== state.segs.length) { toast(`စာကြောင်း ${lines.length} / ${state.segs.length} မကိုက်ပါ`); return false; }
    lines.forEach((t, i) => { state.segs[i].text = t; });
    return true;
  };
  const paintS = () => document.querySelectorAll('#pStyle .chip').forEach(c => c.classList.toggle('on', c.dataset.s === state.pStyle));
  document.querySelectorAll('#pStyle .chip').forEach(c => c.onclick = () => { state.pStyle = c.dataset.s; paintS(); });
  paintS();
  $('#back').onclick = () => go(1);
  // one tap: copy the prompt and open Gemini to paste it (both inside the tap, which iPhone needs)
  $('#copy').onclick = async () => {
    if (!syncSrc()) return;
    const text = L.buildPrompt(state.segs, state.pStyle);
    let ok = copyNow(text);
    window.open('https://gemini.google.com/app', '_blank', 'noopener');
    if (!ok) { try { await navigator.clipboard.writeText(text); ok = true; } catch {} }
    if (ok) toast('📋 Prompt ကူးပြီးပါပြီ — Gemini မှာ Paste လုပ်ပြီး ပို့ပါ');
    else { $('#json').value = text; toast('ကူးမရပါ — အောက်ကနေ ရွေးကူးပါ'); }
  };
  $('#autoTr')?.addEventListener('click', async () => {
    if (!syncSrc()) return;
    const b = $('#autoTr'); b.disabled = true; state.busy = true;
    const old = b.innerHTML; b.textContent = '✨ ဘာသာပြန်နေပါတယ်… 0%';
    // the AI answers all lines in one go, with no progress on the way: show an estimate that creeps
    // towards 90% (slower for longer videos) until real progress or the answer arrives
    const t0 = Date.now(), T = Math.max(10, state.segs.length * 0.6);
    let real = 0;
    const show = () => {
      const est = 0.9 * (1 - Math.exp(-(Date.now() - t0) / 1000 / T));
      b.textContent = `✨ ဘာသာပြန်နေပါတယ်… ${Math.round(Math.max(real, est) * 100)}% · ${Math.round((Date.now() - t0) / 1000)}s`;
    };
    const tick = setInterval(show, 500);
    try {
      const t = await L.autoTranslate(state.segs, state.pStyle, p => { real = Math.max(real, p); show(); }).finally(() => clearInterval(tick));
      await ensureGenders(txt => { b.textContent = '🎭 ' + txt + '…'; });
      $('#json').value = JSON.stringify({ translations: t }, null, 1);
      const miss = t.filter(x => !x).length;
      toast(miss ? `⚠ ${miss} ကြောင်း ဘာသာမပြန်နိုင်ပါ — အဆင့် ၃ မှာ ဖြည့်ပါ (သို့) ထပ်နှိပ်ပါ` : `✅ ဘာသာပြန်ပြီးပါပြီ (${t.length} ကြောင်း) — စစ်ပြီး Next နှိပ်ပါ`);
    } catch (e) { toast(e.message.slice(0, 120)); }
    b.innerHTML = old; b.disabled = false; state.busy = false;
  });
  $('#next').onclick = async () => {
    try {
      const t = L.parseTranslations($('#json').value);
      if (t.length !== state.segs.length) toast(`အရေအတွက် မကိုက်ပါ (${t.length}/${state.segs.length}) — ဘာသာပြန် အဆင့်မှာ ပြင်ပါ`);
      state.burmese = state.segs.map((_, i) => t[i] || '');
      if (state.pStyle === 'dub') { const b = $('#next'); b.disabled = true; await ensureGenders(txt => { b.textContent = '🎭 ' + txt + '…'; }); }
      go(3);
    } catch (e) { toast(e.message); }
  };
  if (!state.segs.length) previewOnly(['copy', 'next', 'autoTr']);
}

/* ---------------- Step 3 ---------------- */
let previewAudio;
// voice + original-audio settings, shared by step 3 and the Premium one-tap panel on step 1
function voiceBlock() {
  const voices = L.PERSONAS.map(p => `
    <div class="voice ${p.id === state.personaId ? 'sel' : ''}" data-id="${p.id}">
      <div class="av ${p.g === 'Male' ? 'm' : 'f'}">${p.id}</div>
      <b>${p.name}</b><small>${p.g}</small>
      <button data-prev="${p.id}">▶ Preview</button>
    </div>`).join('');
  return `<div id="vblock">
    <div class="row" style="margin-top:20px"><b>အသံရွေးချယ်ပါ</b><span class="muted small">${L.PERSONAS.length} Voice Personas</span></div>
    <div class="voices">${voices}</div>
    <div class="panel">
      <button id="unlock" class="btn block" style="margin-top:0"></button>
      <div id="vTune" hidden>
      <div class="row" style="margin-top:14px"><b>ဝါး/ကြည် (Pitch Offset)</b><span id="pv">${state.pitch >= 0 ? '+' : ''}${state.pitch}Hz</span></div>
      <input id="pitch" type="range" min="-30" max="30" value="${state.pitch}" />
      <div class="row muted small"><span>-30Hz (ဝါး)</span><span>+30Hz (ကြည်)</span></div>
      <div class="row" style="margin-top:14px"><b>🎚 အသံမြန်နှုန်း (Speed)</b><span id="rv">${state.rate >= 0 ? '+' : ''}${state.rate}%</span></div>
      <input id="rate" type="range" min="-30" max="50" value="${state.rate}" />
      <div class="row muted small"><span>-30% (နှေး)</span><span>+50% (မြန်)</span></div>
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
    </div>
    </div>`;
}
function bindVoice(onReset) {
  const box = $('#vblock');
  $('#pitch').oninput = e => { state.pitch = +e.target.value; $('#pv').textContent = (state.pitch >= 0 ? '+' : '') + state.pitch + 'Hz'; };
  $('#rate').oninput = e => { state.rate = +e.target.value; $('#rv').textContent = (state.rate >= 0 ? '+' : '') + state.rate + '%'; };
  $('#gap').oninput = e => { state.keepGap = +e.target.value / 100; $('#gv').textContent = e.target.value + '%'; };
  $('#talk').oninput = e => { state.keepTalk = +e.target.value / 100; $('#tv').textContent = e.target.value + '%'; };
  $('#offs').oninput = e => { state.offset = +e.target.value / 10; $('#ov').textContent = state.offset.toFixed(1) + 's'; };
  $('#mtempo').oninput = e => { state.maxTempo = +e.target.value / 10; $('#mv').textContent = state.maxTempo.toFixed(1) + '×'; };
  $('#dgain').oninput = e => { state.dubGain = +e.target.value / 100; $('#dv').textContent = e.target.value + '%'; };

  // the settings stay folded (and locked) until opened, so scrolling with a finger can't move them
  const sliders = [...box.querySelectorAll('.panel input[type=range]')];
  let unlocked = false;
  const applyLock = () => {
    sliders.forEach(s => { s.disabled = !unlocked; });
    $('#vTune').hidden = !unlocked;
    $('#unlock').textContent = unlocked ? '🔓 ပြင်လို့ရပါပြီ — ပြီးရင် လော့ခ်ချရန် နှိပ်ပါ' : '🔒 ချိန်ညှိထားပြီး — ပြင်ချင်ရင် နှိပ်ပါ';
  };
  $('#unlock').onclick = () => { unlocked = !unlocked; applyLock(); };
  applyLock();
  const rs = document.createElement('button');
  rs.className = 'btn block'; rs.textContent = '↺ ပုံမှန်တန်ဖိုးသို့ ပြန်ထားမည်';
  $('#vTune').prepend(rs);
  rs.onclick = () => { Object.assign(state, DEFAULTS); onReset(); toast('ပုံမှန်တန်ဖိုး ပြန်ထားပြီးပါပြီ'); };
  box.querySelectorAll('.voice').forEach(el => el.onclick = e => {
    if (e.target.dataset.prev) return;
    state.personaId = el.dataset.id;
    box.querySelectorAll('.voice').forEach(v => v.classList.toggle('sel', v === el));
  });
  box.querySelectorAll('[data-prev]').forEach(b => b.onclick = async () => {
    const p = L.PERSONAS.find(x => x.id === b.dataset.prev);
    b.textContent = '…';
    try {
      const ab = await L.tts('မင်္ဂလာပါ၊ ဒီအသံနဲ့ ဇာတ်ကြောင်းကို ပြောပြပေးပါမယ်။', p, state.pitch, state.rate);
      if (previewAudio) { previewAudio.pause(); URL.revokeObjectURL(previewAudio.src); }
      previewAudio = new Audio(URL.createObjectURL(new Blob([ab], { type: 'audio/mpeg' })));
      previewAudio.play();
    } catch (e) { toast(e.message.slice(0, 80)); }
    b.textContent = '▶ Preview';
  });
}

// 🎭 style: lines grouped by AssemblyAI's speaker letter, biggest first
const spkGroups = () => {
  const m = new Map();
  state.segs.forEach((s, i) => { if (s.spk) { if (!m.has(s.spk)) m.set(s.spk, []); m.get(s.spk).push(i); } });
  return [...m].sort((a, b) => b[1].length - a[1].length);
};
const spkIcon = ids => { const f = ids.filter(i => state.genders[i] === 'F').length; return f === 0 ? '🔵' : f === ids.length ? '🔴' : '🟣'; };

function step3() {
  view.innerHTML = `
    <div class="row"><h2>မြန်မာဘာသာပြန်ကို စစ်ဆေးပါ</h2><button class="ghost" id="back">‹ နောက်သို့</button></div>
    <p class="muted">တစ်ကြောင်းလျှင် စာတစ်ကြောင်း။ (${state.segs.length} lines)</p>
    <textarea id="mm" style="min-height:300px">${esc(state.burmese.join('\n'))}</textarea>
    ${state.pStyle === 'dub' && state.genders ? `<div class="panel" style="margin-top:12px">
      <b>🎭 ဘယ်စာကြောင်းကို ဘယ်အသံနဲ့ ပြောမလဲ</b>
      <p class="muted small" style="margin:4px 0 8px">🔵 သီဟ (ယောကျ်ား) · 🔴 နီလာ (မိန်းမ) — မှားနေရင် နှိပ်ပြီး ပြောင်းပါ</p>
      ${spkGroups().length > 1 ? `<p class="small" style="margin:0 0 4px"><b>👥 လူတစ်ယောက်လုံး</b> <span class="muted">(အသံတူတဲ့ စာကြောင်းအားလုံး တစ်ချက်တည်း ပြောင်း)</span></p>
      <div class="chips" id="gSpk" style="margin:0 0 10px">${spkGroups().map(([k, ids]) => `<button type="button" class="chip" data-k="${esc(k)}">${spkIcon(ids)} ${esc(k)} · ${ids.length} ကြောင်း</button>`).join('')}</div>
      <p class="small" style="margin:0 0 4px"><b>📝 တစ်ကြောင်းချင်း</b></p>` : ''}
      <div id="gList" style="display:grid;gap:4px;max-height:320px;overflow:auto">${state.segs.map((s, i) => `<button type="button" class="chip" data-i="${i}" style="justify-content:flex-start;text-align:left;white-space:normal">${state.genders[i] === 'F' ? '🔴' : '🔵'} ${i + 1}. ${esc(state.burmese[i] || s.text)}</button>`).join('')}</div>
    </div>` : ''}
    ${voiceBlock()}
    <p id="cost" hidden></p>
    <button id="next" class="btn primary">အသံထုတ်ပြီး Video ပေါင်းမည်</button>`;
  costLine($('#cost'), state.videoDur);

  const read = () => {
    const lines = trimTail($('#mm').value.split('\n').map(x => x.trim()), state.segs.length);
    return lines;
  };
  $('#mm').oninput = () => { state.burmese = read(); };
  const paintG = () => {
    view.querySelectorAll('#gList .chip').forEach(c => { const i = +c.dataset.i; c.textContent = `${state.genders[i] === 'F' ? '🔴' : '🔵'} ${i + 1}. ${state.burmese[i] || state.segs[i].text}`; });
    const g = new Map(spkGroups());
    view.querySelectorAll('#gSpk .chip').forEach(c => { const ids = g.get(c.dataset.k); c.textContent = `${spkIcon(ids)} ${c.dataset.k} · ${ids.length} ကြောင်း`; });
  };
  view.querySelectorAll('#gList .chip').forEach(c => c.onclick = () => {
    const i = +c.dataset.i; state.genders[i] = state.genders[i] === 'F' ? 'M' : 'F'; paintG();
  });
  // a whole speaker (AssemblyAI's letter) at once: most lines of a voice are the same person
  view.querySelectorAll('#gSpk .chip').forEach(c => c.onclick = () => {
    const ids = new Map(spkGroups()).get(c.dataset.k);
    // mixed (🟣) → all to the majority first; all the same → switch to the other voice
    const f = ids.filter(i => state.genders[i] === 'F').length;
    const to = f === 0 ? 'F' : f === ids.length ? 'M' : f * 2 > ids.length ? 'F' : 'M';
    ids.forEach(i => { state.genders[i] = to; }); paintG();
  });
  $('#back').onclick = () => { state.burmese = read(); go(2); };
  bindVoice(() => { state.burmese = read(); step3(); });
  $('#next').onclick = () => {
    state.burmese = read();
    if (state.burmese.length !== state.segs.length) {
      toast(`စာကြောင်း ${state.burmese.length} / ${state.segs.length} မကိုက်ပါ`); return;
    }
    clearResult();
    go(4, { render: true });
  };
  if (!state.segs.length) previewOnly(['next']);
}

/* ---------------- Step 4 ---------------- */
async function step4() {
  if (state.result) return showResult();
  if (!state.renderNow) {                                   // opened from the step bar: nothing made yet
    view.innerHTML = `<h2>ရလဒ်</h2><p class="muted">Video ထုတ်ပြီးရင် ဒီမှာ ပြပါမယ်။ အဆင့် ၃ မှာ <b>အသံထုတ်ပြီး Video ပေါင်းမည်</b> ကို နှိပ်ပါ။</p>`;
    if (!state.segs.length) previewOnly([]);
    return;
  }
  state.renderNow = false;
  state.busy = true; renderStepper();
  view.innerHTML = bar(state.autoRun ? undefined : ['voice', 'video']);
  let wake; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  const stopClock = startClock();
  let mtRetry = false, crashRetry = false;
  try {
    if (acc.on) {
      // one use per video per day; re-rendering the same file again today is free
      if (premPlan()) { const b = baseJob(), r = renders(b); if (r.done) saveRenders(b, { n: r.n + 1, done: false }); }   // a video made again
      const a = await L.accessStart(jobId(), state.videoDur);
      if (a.error === 'no_credit') { setQuota(a); throw Object.assign(new Error(`💎 ဒီ Video အတွက် Credit ${fmtN(a.need)} လိုပါတယ် (ကျန် ${fmtN(a.credits)}) — Admin ဆီက ထပ်ဖြည့်ပါ`), { limit: true }); }
      if (a.error === 'limit') throw Object.assign(new Error(`ယနေ့အတွက် Video ${a.limit} ပုဒ် ထုတ်ပြီးပါပြီ`), { limit: true });
      if (a.error === 'bad_code') { acc.ok = false; throw Object.assign(new Error('Access Code မမှန်တော့ပါ (ပိတ်ထား / ဖျက်ထား)'), { badCode: true }); }
      if (a.error === 'expired') { acc.ok = false; throw Object.assign(new Error(`Code သက်တမ်း ကုန်သွားပါပြီ (${dateTxt(a.expires)})`), { badCode: true }); }
      if (!a.ticket) throw new Error('Access စစ်လို့မရပါ (' + (a.status || 'network') + ')');
      setQuota(a);
    }
    const persona = L.PERSONAS.find(p => p.id === state.personaId);
    // 🎭 style: men's lines with သီဟ, women's with နီလာ (the voice settings apply to both)
    const voices = state.pStyle === 'dub' && state.genders && state.genders.length === state.segs.length
      ? state.genders.map(g => L.PERSONAS.find(p => p.g === (g === 'F' ? 'Female' : 'Male')) || persona) : null;
    const { video, placed, fellBack, fxFailed, fontFailed, diag, geoOk, ovlOk, subsOk, stats, timing, tries, src, out, engine, skipped } = await L.renderDub({
      file: state.file, videoDur: state.videoDur, segs: state.segs, burmese: state.burmese,
      persona, voices, pitch: state.pitch, rate: state.rate,
      fx: {
        ratio: state.fxRatio, fit: state.fxFit, zoom: state.fxZoom, fast: state.fxFast, hd: state.fxHD && premPlan(), fps30: state.fxFps30,
        wm: { on: state.wmOn, text: state.wmText, pos: state.wmPos, size: state.wmSize, op: state.wmOp },
        logo: { on: state.logoOn, data: state.logoData, pos: state.logoPos, size: state.logoSize },
        freeze: { on: state.frzOn, every: state.frzA, hold: state.frzB, zoom: state.frzZoom, amount: state.frzAmt },
        mirror: state.fxMirror, blur: state.fxBlur, blurH: state.blurH, blurY: state.blurY, blurS: state.blurS, blurO: state.blurO,
        subs: { on: state.fxSubs, size: state.subS, y: state.subY, color: state.subC, outline: state.subO, font: selFont() }
      }, keepTalk: state.keepTalk, keepGap: state.keepGap,
      offset: state.offset, maxTempo: state.maxTempo, dubGain: state.dubGain, onProgress: setProg
    });
    state.diag = `geo:${geoOk} subs:${subsOk} overlay:${ovlOk} fxFailed:${fxFailed}\n${diag || ''}`;
    const took = stopClock();
    state.crashRetried = false;
    if (premPlan()) { const b = baseJob(); saveRenders(b, { ...renders(b), done: true }); }
    state.result = { video, url: URL.createObjectURL(video), srt: L.buildSrt(state.burmese, placed), stats, took, timing, tries, src, out, engine, skipped };
    finishRun();
    showResult();
    H.histAdd({ name: state.file.name, video, srt: state.result.srt, size: video.size, dur: state.videoDur, took })
      .catch(() => toast('မှတ်တမ်းထဲ သိမ်းဖို့ ဖုန်းထဲ နေရာမလောက်ပါ — Video ကို Download လုပ်ထားပါ'));
    if (fontFailed) toast('Font ဖွင့်မရလို့ ဖုန်း Font နဲ့ စာတန်းထိုး ထည့်ထားပါတယ်');
    else if (fxFailed) toast('Effect (Mirror/Blur/စာတန်းထိုး) အချို့ ထည့်မရလို့ ရတာလောက်ပဲ ထုတ်ထားပါတယ်');
    else if (fellBack) toast('မူရင်းအသံ ရောစပ်မရလို့ မြန်မာအသံချည်းပဲ ထည့်ထားပါတယ်');
  } catch (e) {
    if (e && e.mtStall) { mtRetry = true; return; }      // multi-core got stuck: run again on the normal engine (see finally)
    // the engine crashed (iPhone memory): start a fresh one and run again, once
    if (L.isEngineCrash(e) && !state.crashRetried) { state.crashRetried = true; L.dropEngine(); crashRetry = true; return; }
    view.innerHTML = `<h2>အမှားရှိနေပါသည်</h2>`; showErr(e);
    if (e && (e.limit || e.badCode)) {
      errTip(e.limit
        ? '🎟 အစမ်းသုံးခွင့်က တစ်ရက်ကို အကန့်အသတ် ရှိပါတယ်။ <b>မနက်ဖြန် (မြန်မာစံတော်ချိန် ည ၁၂ နာရီနောက်)</b> ပြန်ထုတ်လို့ရပါမယ်။ ပြင်ထားတဲ့ စာသားတွေ မပျောက်ပါဘူး — ဒီ tab ကို မပိတ်ပါနဲ့။'
        : '🔑 Code ပေးထားတဲ့သူကို ဆက်သွယ်ပြီး Code အသစ် တောင်းပါ။');
      view.insertAdjacentHTML('beforeend', `<button class="btn block" id="back">ဘာသာပြန် အဆင့်သို့ ပြန်သွားမည်</button>`);
      $('#back').onclick = () => (e.badCode ? openPage('code') : go(3));
      return;
    }
    errTip(/ticket/i.test(String(e && e.message))
      ? '🔑 Access Code နဲ့ ပြန်ဝင်ပြီး <b>ပြန်စမည်</b> ကိုနှိပ်ပါ။'
      : /No audio|အသံမထွက်/i.test(String(e && e.message))
      ? '⚠ <b>Microsoft က မြန်မာအသံ ထုတ်မပေးပါ။</b> အသံအများကြီး ဆက်တိုက်တောင်းရင် ခဏပိတ်ထားတတ်ပါတယ်။ ၁၀–၁၅ မိနစ်လောက် နားပြီး <b>ပြန်စမည်</b> ကိုနှိပ်ပါ (ရပြီးသား အသံတွေကို ပြန်မတောင်းတော့ပါဘူး)။ Error မှာပါတဲ့ ID စာကြောင်းတွေမှာ သင်္ကေတ / အင်္ဂလိပ်စာ ပါရင် မြန်မာလို ပြင်ရေးကြည့်ပါ။'
      : /TTS|fetch|network|connection/i.test(String(e && e.message))
      ? '⚠ <b>မြန်မာအသံ ထုတ်တဲ့ server နဲ့ ချိတ်ဆက်မှု ပြတ်သွားပါတယ်။</b> Wi-Fi / Internet ကောင်းမကောင်း အရင်စစ်ပြီး <b>ပြန်စမည်</b> ကိုနှိပ်ပါ။ ပြင်ထားတဲ့ စာသားနဲ့ Setting တွေ မပျောက်ပါဘူး။'
      : '⚠ Wi-Fi / Internet ကောင်းမကောင်း အရင်စစ်ပြီး <b>ပြန်စမည်</b> ကိုနှိပ်ပါ။ ဆက်ဖြစ်နေရင် Effect တချို့ (Blur၊ စာတန်းထိုး၊ Logo) ကို ပိတ်ပြီး စမ်းကြည့်ပါ။');
    view.insertAdjacentHTML('beforeend', `<button class="btn primary" id="retry">ပြန်စမည်</button>
      <label class="btn block" for="repick" style="display:block;text-align:center;cursor:pointer">🎞 Video ပြန်ရွေးပြီး ပြန်စမည်<input id="repick" type="file" accept="video/*" hidden /></label>
      <button class="btn block" id="back">ဘာသာပြန် အဆင့်သို့ ပြန်သွားမည်</button>`);
    $('#retry').onclick = () => { state.renderNow = true; step4(); };
    $('#repick').onchange = async ev => {
      const nf = ev.target.files[0]; if (!nf) return;
      try { await L.forgetInput(); state.file = nf; state.videoDur = await L.videoDuration(nf).catch(() => state.videoDur); } catch (e2) { toast(e2.message); return; }
      state.renderNow = true; step4();
    };
    $('#back').onclick = () => go(3);
  } finally {
    stopClock(); wake?.release?.(); state.busy = false; renderStepper();
    if (!mtRetry && !crashRetry) state.autoRun = false;
    if (mtRetry || crashRetry) {
      toast(mtRetry ? '⚡ Multi-core ရပ်သွားလို့ ပုံမှန် Engine နဲ့ ပြန်ထုတ်နေပါတယ်' : '⚙ Engine ကို ပြန်စပြီး ထပ်ထုတ်နေပါတယ်');
      state.renderNow = true; setTimeout(step4, 300);
    }
  }
}

function statBlock() {
  const st = state.result.stats; if (!st) return '';
  const long = st.longLines || [];
  let h = st.lateCount
    ? `<p class="muted small">⏱ နောက်ကျတဲ့ စာကြောင်း ${st.lateCount} ကြောင်း (အများဆုံး ${st.maxDrift.toFixed(1)} စက္ကန့်)</p>`
    : '<p class="muted small">✅ မြန်မာသံ အချိန်ကိုက်ညီပါတယ်</p>';
  const sk = state.result.skipped || [];
  if (sk.length) h += `<div class="warn">⚠ <b>အသံမထွက်တဲ့ စာကြောင်း ${sk.length} ကြောင်း</b> (ID: ${sk.join(', ')})<br>
    Microsoft က ဒီစာကြောင်းတွေကို အသံမထုတ်ပေးလို့ အသံမပါဘဲ ထားခဲ့ပါတယ်။ သင်္ကေတ / အင်္ဂလိပ်စာ / ကိန်းဂဏန်း တွေကို မြန်မာလို ပြင်ရေးပြီး ပြန်ထုတ်ကြည့်ပါ။</div>`;
  if (long.length) h += `<div class="panel"><b>⚠ ရှည်လွန်းတဲ့ စာကြောင်း ${long.length} ကြောင်း</b>
    <p class="muted small">ID: ${long.map(x => x.i).join(', ')}<br>အသံကို အမြန်ဆုံးချုံ့လည်း အချိန်မဆန့်ပါ။ ဒီစာကြောင်းတွေကို Gemini နဲ့ တိုအောင် ပြန်ခိုင်းပါ။</p>
    <button id="shorten" class="btn block">📋 တိုအောင်ခိုင်းမည့် Prompt ကူးမည်</button>
    <button id="toStep2" class="btn block">မူရင်းစာသား အဆင့်သို့ သွားပြီး JSON ထည့်မည်</button></div>`;
  return h;
}

// how long each render stage took, with a bar per stage so the slowest one stands out
const STAGES = [
  ['tts', '🗣 မြန်မာအသံ ထုတ်ချိန်'],
  ['fit', '⏱ အချိန်ကိုက် ညှိချိန်'],
  ['mix', '🎚 အသံပေါင်းချိန်'],
  ['input', '📥 Video ဖိုင် ပြင်ဆင်ချိန်'],
  ['overlay', '🏷 Watermark / Logo ဆွဲချိန်'],
  ['subs', '💬 စာတန်းထိုး ပုံဆွဲချိန်'],
  ['prep', '🧩 ကျန်တဲ့ ပြင်ဆင်ချိန်'],
  ['encode', '🎞 Video ပေါင်းချိန် (encode)'],
  ['save', '💾 ဖိုင်သိမ်းချိန်']
];
const secTxt = s => s < 60 ? `${s.toFixed(1)} စက္ကန့်` : fmtDur(s);
function timingBlock() {
  const r = state.result, t = r.timing; if (!t) return '';
  const max = Math.max(...STAGES.map(([k]) => t[k] || 0), 0.001);
  const rows = STAGES.filter(([k]) => t[k] >= 0.05).map(([k, label]) => `
    <div class="trow"><span>${label}</span><b>${secTxt(t[k])}</b></div>
    <div class="tbar"><i style="width:${Math.max(2, Math.round((t[k] / max) * 100))}%"></i></div>`).join('');
  const o = r.out, same = o && r.src && o.w === r.src.w && o.h === r.src.h && Math.round(o.fps) === Math.round(r.src.fps);
  const src = r.src ? `<p class="muted small" style="margin:10px 0 0">📹 မူရင်း Video: ${r.src.w}×${r.src.h} · ${Math.round(r.src.fps)} fps${o && !same ? ` → ထုတ်ထားတာ: ${o.w}×${o.h} · ${Math.round(o.fps)} fps` : ''}</p>` : '';
  const en = r.engine && r.engine.kind
    ? `<p class="muted small" style="margin:6px 0 0">⚙ Engine: ${r.engine.kind === 'mt' ? `⚡ Multi-core (core ${navigator.hardwareConcurrency || '?'} ခု)` : 'ပုံမှန် (single-core)'}${r.engine.fellBack ? ' — Multi-core အဆင်မပြေလို့' : ''}</p>` : '';
  const retry = r.tries > 1 ? `<p class="muted small" style="margin:6px 0 0">🔁 ပထမနည်း မရလို့ Video ကို ${r.tries} ကြိမ် ထုတ်ခဲ့ရပါတယ်</p>` : '';
  return `<details class="panel timing" open><summary><b>📊 အဆင့်အလိုက် ကြာချိန်</b></summary>${rows}${src}${en}${retry}</details>`;
}

function showResult() {
  // three tabs, so the video, the thumbnail and the caption each fit on the phone without long scrolling
  const tabs = [['v', '🎬 Video'], ['t', '🖼 Thumbnail'], ...(isPremium() ? [['c', '📝 Caption']] : [])];
  if (!tabs.some(([k]) => k === state.rTab)) state.rTab = 'v';
  view.dataset.rt = state.rTab;
  view.innerHTML = `
    <h2>ရလဒ်များ (Results)</h2>
    <div class="rtabs">${tabs.map(([k, l]) => `<button type="button" data-t="${k}" class="${k === state.rTab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="rvid">
    <video src="${state.result.url}" controls playsinline></video>
    ${state.result.took ? `<p class="muted small">⏱ ထုတ်ချိန် ${fmtDur(state.result.took)} · 🗂 မှတ်တမ်းထဲမှာ ၂၄ နာရီ သိမ်းထားပါတယ်</p>` : ''}
    ${timingBlock()}
    ${statBlock()}
    ${state.diag && /fxFailed:true|false\n[^]/.test(state.diag) && /fxFailed:true|failed|Error|error/i.test(state.diag) ? `<details style="margin:10px 0"><summary class="muted small">🛠 Effect log (အမှားရှာရန်)</summary><pre id="diagTxt" style="white-space:pre-wrap;font-size:11px;max-height:220px;overflow:auto">${esc(state.diag)}</pre><button class="btn block" id="diagCp" type="button">📋 Log ကူးမည်</button></details>` : ''}
    <button id="dl" class="btn primary">⬇ Video Download (.mp4)</button>
    <button id="srt" class="btn block">Download Subtitles (.srt)</button>
    </div>
    <div id="thumbBox"><button id="thumbGo" class="btn block">🖼 Thumbnail ပြုလုပ်မည် (ChatGPT 3D)</button></div>
    <div class="row" style="margin-top:14px">
      <button id="back" class="ghost">‹ အသံရွေးချယ်မှုသို့</button>
      <button id="again" class="ghost">Video အသစ်</button>
    </div>`;
  view.querySelectorAll('.rtabs button').forEach(b => {
    b.onclick = () => {
      state.rTab = view.dataset.rt = b.dataset.t;
      view.querySelectorAll('.rtabs button').forEach(x => x.classList.toggle('on', x === b));
      if (b.dataset.t !== 'v') view.querySelectorAll('.rvid video').forEach(v => v.pause());
      scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
  const base = state.file.name.replace(/\.[^.]+$/, '');
  $('#diagCp')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.diag); toast('ကူးပြီးပါပြီ'); } catch { toast('ကူးမရပါ'); } });
  $('#dl').onclick = () => download(state.result.video, base + '_recap.mp4');
  $('#srt').onclick = () => download(new Blob([state.result.srt], { type: 'text/plain' }), base + '_burmese.srt');
  $('#shorten')?.addEventListener('click', async () => {
    const t = L.buildShortenPrompt(state.segs, state.burmese, state.result.stats.longLines);
    try { await navigator.clipboard.writeText(t); toast('Prompt ကူးပြီးပါပြီ — Gemini မှာ paste လုပ်ပါ'); } catch { toast('ကူးမရပါ'); }
  });
  $('#toStep2')?.addEventListener('click', () => { state.showSrc = true; go(2); });
  $('#thumbGo').onclick = () => thumbPanel();
  if ((state.thumb && state.thumb.shots) || isPremium()) thumbPanel();   // Premium: thumbnail shots, titles and caption come by themselves
  $('#back').onclick = () => { clearResult(); go(3); };
  $('#again').onclick = () => { clearResult(); Object.assign(state, { showSrc: false, file: null, segs: [], origSegs: null, burmese: [] }); go(1); };
}


/* ---------------- Access code (people trying the app get a code with a daily limit) ---------------- */
function pageCode() {
  view.innerHTML = acc.ok ? `
    <h2>🔑 Access Code</h2>
    <div class="kbox">
      <div class="krow"><b>${esc(acc.name)}</b><span class="badge ok">Active</span></div>
      <p class="muted small" style="margin:8px 0 0">Code: <b>${esc(L.access.code)}</b></p>
      ${premPlan() ? `<p style="margin:10px 0 0"><span class="pbadge">💎 Premium</span>${acc.expires ? ` <span class="muted small">· ${dateTxt(acc.expires)} အထိ</span>` : ''}</p>` : ''}
      <p style="margin:10px 0 0">🎟 <b>${quotaTxt()}</b></p>
      <p class="muted small" style="margin:6px 0 0">${premPlan()
        ? `Video အရှည်နဲ့ တွက်ပါတယ် — ၁ မိနစ် = ${L.CPM} credit (စက္ကန့်နဲ့)။ ထုတ်ပြီးသား Video ကို ပြန်ထုတ်ရင်လည်း နှုတ်ပါတယ် (Error တက်လို့ ပြန်စရင်တော့ မနှုတ်ပါ)။`
        : 'Video တစ်ပုဒ် ထုတ်တိုင်း တစ်ခါ ရေတွက်ပါတယ်။ Video တစ်ပုဒ်တည်းကို ယနေ့ထဲ ပြန်ထုတ်ရင် ထပ်မရေတွက်ပါ။ မြန်မာစံတော်ချိန် ည ၁၂ နာရီမှာ ပြန်စပါတယ်။'}</p>
    </div>
    <button class="btn primary block" id="toFree">🎬 Video ထုတ်မည်</button>
    <button class="btn block" id="logout">Code ပြောင်းမည်</button>
    <p class="small" style="text-align:center;margin-top:18px"><a class="link" id="toAdmin">🛡 Admin</a></p>` : `
    <h2>🔑 Access Code ထည့်ပါ</h2>
    <p class="muted">ဒီ App ကို အစမ်းသုံးဖို့ Code လိုပါတယ်။ Code ပေးထားတဲ့သူဆီက ရထားတဲ့ Code ကို ထည့်ပါ။</p>
    <div class="kbox">
      <input id="codeIn" placeholder="ဥပမာ  ABCD-1234" autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase;letter-spacing:2px;font-size:20px;text-align:center" value="${esc(L.access.code)}" />
      <button class="btn primary block" id="codeGo">ဝင်မည်</button>
      <div id="codeErr" class="err" hidden></div>
    </div>
    <p class="small" style="text-align:center;margin-top:18px"><a class="link" id="toAdmin">🛡 Admin</a></p>`;
  $('#toAdmin').onclick = () => openPage('admin');
  if (acc.ok) {
    $('#toFree').onclick = () => openPage('free');
    $('#logout').onclick = () => { L.access.code = ''; acc.ok = false; render(); };
    // refresh today's count
    L.accessCheck().then(r => { if (r && r.name && page === 'code') { setQuota(r); pageCode(); syncMenu(); } }).catch(() => {});
    return;
  }
  const go_ = async () => {
    const code = $('#codeIn').value.trim().toUpperCase();
    const err = $('#codeErr'), b = $('#codeGo');
    if (!code) return;
    b.disabled = true; err.hidden = true;
    try {
      const r = await L.accessCheck(code);
      if (r.open) { acc.on = false; acc.ok = true; openPage('free'); return; }
      if (r.error === 'expired') throw new Error(`Code သက်တမ်း ကုန်သွားပါပြီ (${dateTxt(r.expires)}) — သက်တမ်းတိုးဖို့ Admin ကို ဆက်သွယ်ပါ`);
      if (r.error) throw new Error('Code မမှန်ပါ (သို့) ပိတ်ထားပါတယ်');
      L.access.code = code; setQuota(r);
      toast(`✅ ${r.name} — ${quotaTxt()}`);
      openPage(L.cfg.aaiKey || L.premium.on || L.freeKey.on ? 'free' : 'keys');
    } catch (e) {
      err.hidden = false; err.textContent = e.message === 'Failed to fetch' ? 'ချိတ်ဆက်မရပါ — Internet စစ်ပါ' : e.message;
    }
    b.disabled = false;
  };
  $('#codeGo').onclick = go_;
  $('#codeIn').onkeydown = e => { if (e.key === 'Enter') go_(); };
}

/* ---------------- Admin: make codes, set the daily limit, see who used what ---------------- */
const agoDays = t => {
  if (!t) return 'မသုံးရသေး';
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? 'အခုလေးတင်' : m < 60 ? `${m} မိနစ်က` : m < 1440 ? `${Math.floor(m / 60)} နာရီက` : `${Math.floor(m / 1440)} ရက်က`;
};
const APP_URL = 'https://recap-studio-74n.pages.dev';
const CRED_PACKS = [7000, 15000, 25000];
const AI_SAMPLE = `我去，你都干了什么？
你这么大声干嘛？不知道叫醒别人要温柔一些。
哦，现在不是讨论这的时候。你这家伙到底做了什么？
我们可是夫妻。不是你说的，我们之间要慢慢培养感情吗？
她发现自己被骗了，决定离开这个家。`;      // credit packages Admin hands out (≈ 87 / 187 / 312 minutes)
const shareText = c => `🎬 ClipZat MM${c.plan === 'premium' ? ' 💎 Premium' : ''}\nAccess Code: ${c.code}\n${c.plan === 'premium' ? `Credit ${fmtN(c.credits)} (≈ ${Math.floor((c.credits || 0) / L.CPM)} မိနစ်)` : `တစ်ရက် ${c.limit > 0 ? c.limit + ' ပုဒ်' : 'အကန့်အသတ်မရှိ'}`}${c.freeAai && c.plan !== 'premium' ? '\n🎁 AssemblyAI Key ထည့်စရာ မလို' : ''}${c.expires ? `\n${dateTxt(c.expires)} အထိ` : ''}\n${APP_URL}`;
async function shareCode(c) {
  const text = shareText(c);
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('📋 Code နဲ့ Link ကူးပြီးပါပြီ'); } catch { toast(c.code); }
}

async function pageAdmin() {
  if (!L.access.adminPass) {
    view.innerHTML = `
      <h2>🛡 Admin</h2>
      <p class="muted">Worker မှာ ထည့်ထားတဲ့ <b>ADMIN_PASS</b> ကို ရိုက်ထည့်ပါ။ ဒီဖုန်းမှာ မှတ်ထားပါမယ်။</p>
      <div class="kbox">
        <input id="apass" type="password" placeholder="Admin Password" autocomplete="current-password" />
        <button class="btn primary block" id="ago">ဝင်မည်</button>
        <div id="aerr" class="err" hidden></div>
      </div>`;
    const go_ = async () => {
      const pw = $('#apass').value.trim(); if (!pw) return;
      $('#ago').disabled = true;
      L.access.adminPass = pw;
      const r = await L.adminCall({ action: 'list' }).catch(e => ({ error: e.message }));
      if (r.codes) { syncMenu(); pageAdmin(); return; }
      L.access.adminPass = '';
      const e = $('#aerr'); e.hidden = false;
      e.textContent = r.error === 'bad_pass' ? 'Password မမှန်ပါ'
        : r.error === 'not_setup' ? 'Worker မှာ RECAP_KV နဲ့ ADMIN_PASS မထည့်ရသေးပါ (လမ်းညွှန် ကြည့်ပါ)'
        : 'ချိတ်ဆက်မရပါ: ' + (r.error || r.status);
      $('#ago').disabled = false;
    };
    $('#ago').onclick = go_;
    $('#apass').onkeydown = e => { if (e.key === 'Enter') go_(); };
    return;
  }

  view.innerHTML = `<h2>🛡 Admin</h2><p class="muted">ဖွင့်နေပါတယ်…</p>`;
  const r = await L.adminCall({ action: 'list' }).catch(e => ({ error: e.message }));
  if (page !== 'admin') return;
  if (r.error === 'bad_pass') { L.access.adminPass = ''; syncMenu(); return pageAdmin(); }
  if (!r.codes) { view.innerHTML = `<h2>🛡 Admin</h2><div class="err">ဖွင့်မရပါ: ${esc(r.error || r.status)}</div><button class="btn block" id="again">ပြန်စမ်းမည်</button>`; $('#again').onclick = pageAdmin; return; }
  L.setCpm(r.cpm);

  const used = r.codes.reduce((n, c) => n + (c.today || 0), 0);
  view.innerHTML = `
    <h2>🛡 Admin</h2>
    <p class="muted small">Code ${r.codes.length} ခု · ယနေ့ (${r.day}) စုစုပေါင်း ${used} ပုဒ် ထုတ်ထားပါတယ်</p>

    <div class="kbox">
      <b>➕ Code အသစ် ထုတ်မည်</b>
      <input id="nName" placeholder="နာမည် (ဥပမာ မောင်မောင်)" maxlength="40" style="margin-top:10px" />
      <p class="muted small" style="margin:10px 0 6px">အမျိုးအစား</p>
      <div class="chips" id="nPlan">
        <button type="button" class="chip on" data-v="free">🎟 Free</button>
        <button type="button" class="chip" data-v="premium">💎 Premium</button>
      </div>
      <div id="nFree">
      <p class="muted small" style="margin:10px 0 6px">တစ်ရက်ကို ထုတ်ခွင့်</p>
      <div class="chips" id="nLimit">
        ${[[1, '၁ ပုဒ်'], [2, '၂ ပုဒ်'], [3, '၃ ပုဒ်'], [5, '၅ ပုဒ်'], [0, '∞']].map(([v, t]) => `<button type="button" class="chip ${v === 2 ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}
      </div>
      </div>
      <div id="nPrem" hidden>
      <p class="muted small" style="margin:10px 0 6px">💎 Credit Package (၁ မိနစ် = ${L.CPM} credit)</p>
      <div class="chips" id="nCred">
        ${CRED_PACKS.map(v => `<button type="button" class="chip ${v === CRED_PACKS[1] ? 'on' : ''}" data-v="${v}">${fmtN(v)}</button>`).join('')}
      </div>
      </div>
      <button class="btn primary block" id="nGo">Code ထုတ်မည်</button>
    </div>

    <div id="codes">${r.codes.length ? r.codes.map(c => `
      <div class="kbox acode" data-c="${esc(c.code)}">
        <div class="krow"><b>${esc(c.name)}${c.plan === 'premium' ? ' <span class="pbadge">💎 Premium</span>' : ''}${c.freeAai ? ' <span class="badge ok">🎁 Key မလို</span>' : ''}</b><span class="badge ${c.active && !(c.expires && c.expires < Date.now()) ? 'ok' : 'req'}">${!c.active ? 'ပိတ်ထား' : c.expires && c.expires < Date.now() ? 'သက်တမ်းကုန်' : 'ဖွင့်ထား'}</span></div>
        <div class="codeline"><b class="ccode">${esc(c.code)}</b><button class="ghost cshare" title="Share">📤</button></div>
        <p class="muted small" style="margin:6px 0 0">${c.plan === 'premium' ? '' : `ယနေ့ <b>${c.today || 0}</b>/${c.limit > 0 ? c.limit : '∞'} · `}စုစုပေါင်း ${c.total || 0} ပုဒ် · နောက်ဆုံး ${agoDays(c.last)}</p>
        ${c.expires ? `<p class="muted small" style="margin:4px 0 0">⏳ ${dateTxt(c.expires)} အထိ (${c.expires < Date.now() ? 'ကုန်ပြီ' : daysLeft(c.expires) + ' ရက် ကျန်'}) <button class="ghost cnoexp">သက်တမ်း ဖြုတ်</button></p>` : ''}
        ${c.plan === 'premium' ? `<p style="margin:8px 0 0">💎 <b class="ccred">${creditTxt(c.credits)}</b></p>
        <div class="chips">
          ${CRED_PACKS.map(v => `<button type="button" class="chip cadd" data-n="${v}">➕ ${fmtN(v)}</button>`).join('')}
        </div>` : ''}
        <button class="btn block cplan" style="margin-top:8px">${c.plan === 'premium' ? '🎟 Free ပြောင်း' : '💎 Premium ပြောင်း'}</button>
        <div class="krow" style="margin-top:10px${c.plan === 'premium' ? ';display:none' : ''}">
          <span class="small">တစ်ရက် ထုတ်ခွင့်</span>
          <span class="limrow"><button class="ghost cminus">−</button><b class="clim">${c.limit > 0 ? c.limit : '∞'}</b><button class="ghost cplus">+</button></span>
        </div>
        <button class="btn block cfree" style="margin-top:8px">${c.freeAai ? '🔑 Key မလို — ပိတ်မည်' : '🎁 AssemblyAI Key မလိုအောင် ပေးမည်'}</button>
        <div class="two">
          <button class="btn ctoggle">${c.active ? '⏸ ပိတ်မည်' : '▶ ဖွင့်မည်'}</button>
          <button class="btn creset" ${c.today ? '' : 'disabled'}>↺ ယနေ့ ပြန်စ</button>
        </div>
        <button class="btn danger block cdel">🗑 ဖျက်မည်</button>
      </div>`).join('') : '<p class="muted">Code မရှိသေးပါ — အပေါ်မှာ ထုတ်ပါ။</p>'}</div>

    <div class="kbox">
      <b>💰 Premium ဈေး (၁ မိနစ်ကို Credit)</b>
      <p class="muted small" style="margin:6px 0 10px">Video ၁ မိနစ်ကို Credit ဘယ်လောက် နှုတ်မလဲ${r.cpm ? '' : ' — ⚠ Worker အသစ် မတင်ရသေးလို့ ပြောင်းလို့ မရသေးပါ'}</p>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="cpmIn" type="number" inputmode="numeric" min="1" max="10000" value="${L.CPM}" style="flex:1 1 auto;min-width:0;width:auto;margin:0;font-size:20px;font-weight:700;text-align:center" />
        <button type="button" class="btn primary" id="cpmSave" style="flex:0 0 auto;width:auto;margin:0;padding-left:22px;padding-right:22px">သိမ်းမည်</button>
      </div>
      <p class="muted small" style="margin:8px 0 0" id="cpmEx"></p>
    </div>
    <div class="kbox" style="margin-top:14px">
      <b>🧪 AI ဘာသာပြန် စမ်းမည်</b>
      <p class="muted small" style="margin:6px 0 10px" id="aiStat">…</p>
      <p class="small" style="margin:0 0 6px">🔑 Gemini API Key <span class="muted" id="gkSrc"></span></p>
      <div class="linkrow" style="margin-bottom:10px">
        <input id="gkIn" type="password" autocomplete="off" placeholder="AIza… (aistudio.google.com)" />
        <button type="button" class="btn primary" id="gkSave">သိမ်းမည်</button>
        <button type="button" class="btn" id="gkDel" title="ဖျက်မည်">🗑</button>
      </div>
      <textarea id="aiSrc" rows="5">${esc(AI_SAMPLE)}</textarea>
      <button class="btn block" id="aiGo" style="margin-top:8px">▶ Model အားလုံး စမ်းမည်</button>
      <div id="aiOut"></div>
    </div>

    <div class="kbox">
      <b>🤖 Telegram ရောင်းချ Bot</b>
      <p class="muted small" style="margin:6px 0 10px">Cloudflare မှာ <b>TG_TOKEN</b> (Secret) နဲ့ <b>PAY_INFO</b> ထည့်ပြီးရင် ဒီခလုတ်ကို တစ်ခါ နှိပ်ပါ</p>
      <button class="btn block" id="tgGo">🔗 Telegram Bot ချိတ်မည်</button>
      <p class="small" id="tgMsg" hidden style="margin:10px 0 0"></p>
    </div>

    <button class="btn block" id="aout">Admin မှ ထွက်မည်</button>`;

  let nLim = 2, nPlan = 'free', nCred = CRED_PACKS[1];
  const chipGroup = (sel, set) => view.querySelectorAll(sel + ' .chip').forEach(b => { b.onclick = () => { set(b.dataset.v); view.querySelectorAll(sel + ' .chip').forEach(x => x.classList.toggle('on', x === b)); }; });
  chipGroup('#nLimit', v => { nLim = +v; });
  chipGroup('#nPlan', v => { nPlan = v; $('#nFree').hidden = v === 'premium'; $('#nPrem').hidden = v !== 'premium'; });
  chipGroup('#nCred', v => { nCred = +v; });
  $('#nGo').onclick = async () => {
    $('#nGo').disabled = true;
    const c = await L.adminCall({ action: 'create', name: $('#nName').value.trim(), limit: nLim, plan: nPlan, credits: nCred }).catch(e => ({ error: e.message }));
    if (c.code) { toast('✅ Code ' + c.code + ' ထုတ်ပြီးပါပြီ'); await pageAdmin(); shareCode(c); }
    else { toast('မရပါ: ' + (c.error || c.status)); $('#nGo').disabled = false; }
  };
  $('#aout').onclick = () => { L.access.adminPass = ''; syncMenu(); openPage(acc.ok || !acc.on ? 'free' : 'code'); };
  // AI test: the same prompt as Auto translate, on every model, so the owner can pick the best Burmese
  // Premium price: what the packs buy at the typed rate, saved to the Worker
  const cpmEx = () => {
    const n = Math.round(+$('#cpmIn').value || 0);
    $('#cpmEx').textContent = n >= 1 ? `၃ မိနစ် Video = ${fmtN(Math.ceil(3 * n))} credit · ${CRED_PACKS.map(v => `${fmtN(v)} = ~${fmtN(Math.floor(v / n))} မိနစ်`).join(' · ')}` : '၁ နဲ့ 10,000 ကြား ထည့်ပါ';
  };
  $('#cpmIn').oninput = cpmEx; cpmEx();
  $('#cpmIn').onfocus = e => e.target.select();             // typing replaces the old number instead of adding to it
  $('#cpmSave').onclick = async () => {
    const n = Math.round(+$('#cpmIn').value || 0);
    if (!(n >= 1 && n <= 10000)) { toast('၁ နဲ့ 10,000 ကြား ထည့်ပါ'); return; }
    const x = await L.adminCall({ action: 'cpm', cpm: n }).catch(() => ({}));
    if (x.ok) { L.setCpm(x.cpm); toast(`✅ ၁ မိနစ် = ${fmtN(x.cpm)} credit သိမ်းပြီးပါပြီ`); }
    else toast(x.error === 'bad_action' || !x.error ? 'မရပါ — Worker အသစ် တင်ပြီးမှ ပြောင်းလို့ရပါမယ်' : 'မရပါ: ' + x.error);
  };
  const aiInfo = async () => {
    const x = await L.adminCall({ action: 'aiInfo' }).catch(() => ({}));
    $('#aiStat').innerHTML = x.ai || x.gemini ? `✅ သုံးနေတာ: <b>${esc((x.model || '').split('/').pop())}</b>${x.ai ? '' : ' · Workers AI မချိတ်ရသေး'}${x.gemini ? '' : ' · GEMINI_KEY မထည့်ရသေး'}`
      : '⚠ AI မချိတ်ရသေးပါ — အောက်မှာ Gemini key ထည့်ပါ (သို့) Cloudflare မှာ Workers AI (Name: AI) ချိတ်ပါ';
    $('#gkSrc').textContent = x.keySrc === 'app' ? `· App ထဲက key (…${x.keyTail}) သုံးနေ` : x.keySrc === 'cloudflare' ? '· Cloudflare က GEMINI_KEY သုံးနေ' : '· မထည့်ရသေး';
    $('#gkDel').hidden = x.keySrc !== 'app';
    return x;
  };
  aiInfo();
  const saveKey = async key => {
    const x = await L.adminCall({ action: 'geminiKey', key }).catch(e => ({ error: e.message }));
    toast(x.ok ? (key ? '✅ Gemini key သိမ်းပြီးပါပြီ' : '🗑 App ထဲက key ဖျက်ပြီးပါပြီ') : x.error === 'bad_key' ? 'Key ပုံစံ မမှန်ပါ — Google AI Studio က key ကို Copy ခလုတ်နဲ့ အကုန် ကူးထည့်ပါ' : 'မရပါ: ' + (x.error || x.status));
    if (x.ok) { $('#gkIn').value = ''; aiInfo(); }
  };
  $('#gkSave').onclick = () => { const k = $('#gkIn').value.trim(); if (k) saveKey(k); };
  $('#gkDel').onclick = () => { if (confirm('App ထဲက Gemini key ကို ဖျက်မလား?')) saveKey(''); };
  $('#aiGo').onclick = async () => {
    const info = await aiInfo();
    const lines = $('#aiSrc').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 40);
    if (!lines.length) return;
    const prompt = L.buildPrompt(lines.map((text, i) => ({ start: i * 3, end: i * 3 + 2.8, text })), 'recap');
    const out = $('#aiOut'), b = $('#aiGo'); b.disabled = true; out.innerHTML = '';
    for (const model of (info.models || []).filter(m => m === 'gemini' ? info.gemini : info.ai)) {
      const name = model ? model.split('/').pop() : 'Gemini';
      const box = document.createElement('div'); box.className = 'aires';
      box.innerHTML = `<b>${esc(name)}</b> <span class="muted small">ဘာသာပြန်နေပါတယ်…</span>`;
      out.append(box);
      const r = await L.adminCall({ action: 'aiTest', prompt, model }).catch(e => ({ error: e.message }));
      let body;
      try { body = '<ol>' + L.parseTranslations(r.text || '').map(t => `<li>${esc(t)}</li>`).join('') + '</ol>'; }
      catch (e) { body = `<p class="err small">${esc(r.error || e.message)}</p>${r.text ? `<pre class="small">${esc(r.text.slice(0, 400))}</pre>` : ''}`; }
      box.innerHTML = `<b>${esc(name)}</b> <span class="muted small">${r.ms ? (r.ms / 1000).toFixed(1) + ' စက္ကန့်' : ''}</span>${body}
        ${model ? `<button class="btn block aiuse" data-m="${esc(model)}">✅ ဒီ Model ကို သုံးမည်</button>` : ''}`;
      const u = box.querySelector('.aiuse');
      if (u) u.onclick = async () => { const x = await L.adminCall({ action: 'aiModel', model }).catch(() => ({})); toast(x.ok ? `✅ ${name} ကို သုံးပါမယ်` : 'မရပါ'); aiInfo(); };
    }
    b.disabled = false;
  };
  $('#tgGo').onclick = async () => {
    const b = $('#tgGo'), m = $('#tgMsg'); b.disabled = true;
    const x = await L.adminCall({ action: 'tgSetup' }).catch(e => ({ error: e.message }));
    const why = { no_tg_token: 'Cloudflare မှာ TG_TOKEN (Secret) မထည့်ရသေးပါ', bad_tg_token: 'TG_TOKEN မမှန်ပါ — @BotFather က Token ကို ပြန်ကူးပါ' };
    m.hidden = false;
    m.innerHTML = x.ok
      ? `✅ <b>@${esc(x.bot)}</b> ချိတ်ပြီးပါပြီ<br>${x.admins ? `Admin ${x.admins} ယောက် မှတ်ထားပြီး` : `👉 Telegram မှာ <b>@${esc(x.bot)}</b> ကိုဖွင့်ပြီး <code>/admin သင့်Admin password</code> ပို့ပါ (Order တွေ သင့်ဆီ ရောက်လာဖို့)`}`
      : '❌ ' + esc(why[x.error] || x.error || x.status);
    b.disabled = false;
  };

  const byCode = Object.fromEntries(r.codes.map(c => [c.code, c]));
  const act = async (body, msg) => {
    const x = await L.adminCall(body).catch(e => ({ error: e.message }));
    if (x.ok) { if (msg) toast(msg); pageAdmin(); } else toast('မရပါ: ' + (x.error || x.status));
  };
  view.querySelectorAll('.acode').forEach(el => {
    const code = el.dataset.c, c = byCode[code];
    el.querySelector('.cshare').onclick = () => shareCode(c);
    el.querySelectorAll('.cadd').forEach(b => { b.onclick = () => act({ action: 'update', code, addCredits: +b.dataset.n }, `💎 Credit ${fmtN(b.dataset.n)} ထည့်ပြီးပါပြီ`); });
    const ne = el.querySelector('.cnoexp'); if (ne) ne.onclick = () => act({ action: 'update', code, noExpiry: true }, '⏳ သက်တမ်း ဖြုတ်ပြီးပါပြီ');
    el.querySelector('.cplan').onclick = () => act({ action: 'update', code, plan: c.plan === 'premium' ? 'free' : 'premium' }, c.plan === 'premium' ? '🎟 Free ပြောင်းပြီးပါပြီ' : '💎 Premium ပြောင်းပြီးပါပြီ');
    const setLim = v => act({ action: 'update', code, limit: v });
    el.querySelector('.cminus').onclick = () => setLim(c.limit === 0 ? 5 : Math.max(1, c.limit - 1));
    el.querySelector('.cplus').onclick = () => setLim(c.limit === 0 ? 0 : c.limit >= 10 ? 0 : c.limit + 1);
    el.querySelector('.cfree').onclick = () => act({ action: 'update', code, freeAai: !c.freeAai }, c.freeAai ? '🔑 Key မလို ပိတ်လိုက်ပါပြီ' : '🎁 ဒီ Code က Key မလိုတော့ပါ');
    el.querySelector('.ctoggle').onclick = () => act({ action: 'update', code, active: !c.active }, c.active ? '⏸ ပိတ်လိုက်ပါပြီ' : '▶ ဖွင့်လိုက်ပါပြီ');
    el.querySelector('.creset').onclick = () => act({ action: 'reset', code }, '↺ ယနေ့ အရေအတွက် ပြန်စပြီးပါပြီ');
    el.querySelector('.cdel').onclick = () => { if (confirm(`${c.name} (${code}) ကို ဖျက်မှာ သေချာလား?`)) act({ action: 'delete', code }, '🗑 ဖျက်ပြီးပါပြီ'); };
  });
}

/* ---------------- Thumbnail: a shot of the main character with the title on it, ready to download ---------------- */
async function thumbPanel() {
  const box = $('#thumbBox'); if (!box) return;
  const th = state.thumb || (state.thumb = { shots: null, sel: 0, src: null });
  // Premium: titles + caption are written by themselves (one AI call), while the shots are being found
  if (isPremium() && !th.packP && !(th.titles || []).length && !th.caption && (state.burmese || []).some(Boolean)) {
    th.packing = true;
    th.packP = L.premiumAI(T.packPrompt(state.burmese), true, { backup: true }).then(text => {
      th.titles = T.parseTitles(text); th.titleSel = th.titles.length ? 0 : -1;
      th.caption = T.parseCaption(text); th.packErr = '';
      th.backupT = th.backupC = L.premiumAI.backup;
    }).catch(e => { th.packErr = e.message.slice(0, 200); }).finally(() => { th.packing = false; });
  }
  if (!th.shots) {
    box.innerHTML = `<div class="panel"><b>🖼 Thumbnail</b>
      <p class="muted small" id="tbMsg">အဓိက ဇာတ်ကောင်ရဲ့ ပုံတွေ ရှာနေပါတယ်… (ပထမဆုံးတစ်ကြိမ် မျက်နှာရှာ Engine ~13MB ဒေါင်းပါမယ်)</p>
      <div class="bar"><i id="tbFill"></i></div></div>`;
    // the original upload (no subtitles burned in); if the phone can't decode it, the finished video
    const srcs = [state.file && URL.createObjectURL(state.file), state.result && state.result.url].filter(Boolean);
    let err = null;
    for (const src of srcs) {
      try {
        const r = await T.pickCharacterShots(src, { onProgress: p => { const f = $('#tbFill'); if (f) f.style.width = Math.round(p * 100) + '%'; } });
        Object.assign(th, { shots: r.shots, faces: r.faces, src, sel: 0 });
        break;
      } catch (e) { err = e; }
    }
    // no shots (e.g. the face engine couldn't load): titles and caption still come; the shots can be tried again
    if (!th.shots) {
      if (!isPremium()) { box.innerHTML = `<div class="err">${esc((err && err.message) || 'ပုံထုတ်လို့ မရပါ')}</div><button id="thumbGo" class="btn block">ပြန်ကြိုးစားမည်</button>`; $('#thumbGo').onclick = () => thumbPanel(); return; }
      th.shotErr = (err && err.message) || 'ပုံထုတ်လို့ မရပါ';
    } else th.shotErr = '';
  }
  if (!$('#thumbBox')) return;
  const ratios = ['9:16', '3:4', '16:9'];
  th.ratio = th.ratio || '9:16';
  if (!th.style) { try { th.style = localStorage.getItem('thumbStyle') || ''; } catch {} }
  if (!T.THUMB_STYLES[th.style]) th.style = 'gold';
  box.innerHTML = `
    <div class="panel thumbp">
      <b>🖼 Thumbnail (စာပါပြီးသား)</b>
      ${th.shotErr ? `<div class="err">${esc(th.shotErr)}</div><button type="button" id="tbRetry" class="btn block">🔄 ပုံ ပြန်ရှာမည်</button>` : `
      <div class="tbhead">
        <button type="button" id="tbNext" class="btn" title="အသစ်">🔄 အသစ်</button>
        <button type="button" id="tbDl" class="btn primary">⬇ Download</button>
      </div>
      <div class="tstyles">${Object.entries(T.THUMB_STYLES).map(([k, v]) => `<button type="button" data-s="${k}" class="${k === th.style ? 'on' : ''}">${v.label}</button>`).join('')}</div>
      <div class="tcards">${ratios.map(r => `<button type="button" data-r="${r}" class="${r === th.ratio ? 'on' : ''}">
        <span class="tcimg" style="aspect-ratio:${r.replace(':', '/')}"><img alt="" /><i>⏳</i></span>
        <small>${{ '9:16': 'TikTok', '3:4': 'Facebook', '16:9': 'YouTube' }[r]} · ${r}</small></button>`).join('')}</div>
      <p class="muted small" id="tbNote" style="margin:6px 0 0">ပုံကို နှိပ်ပြီး ရွေးပါ · မကြိုက်ရင် 🔄 အသစ် ကို နှိပ်ပါ</p>
      <div id="tbShow"></div>`}
      <p class="tstep">✏️ ခေါင်းစဉ်</p>
      <input id="tbCustom" type="text" maxlength="60" placeholder="ကိုယ်တိုင် ရေးချင်ရင် ဒီမှာ ရေးပါ" value="${esc(th.custom || '')}" />
      <div class="err small" id="tbErr" ${th.packErr ? '' : 'hidden'}>⚠ ${esc(th.packErr || '')}</div>
      ${isPremium() ? `<p class="warn small" id="tbBackup" ${th.backupT ? '' : 'hidden'}>⚠ Thumbnail ခေါင်းစဉ် နဲ့ Caption စာသားများ လွဲနေခြင်း၊ အဓိပ္ပါယ် တလွဲများ ဖြစ်နေပါက <b>VPN ဖွင့်ပြီး 🔄</b> ခလုတ်ကို နှိပ်ပါ။</p>
      <div id="tbTitles" style="margin-top:8px">${(th.titles || []).length ? '' : '<button type="button" class="btn block" id="tbMkTitles">✨ ခေါင်းစဉ် ၃ ခု ထုတ်မည်</button>'}</div>` : ''}
      ${th.shotErr ? '' : `
      <details class="tgpt">
      <summary>🧑 ဇာတ်ကောင်ပုံ ကိုယ်တိုင် ရွေးမည်</summary>
      ${th.faces ? '' : '<p class="muted small">မျက်နှာ ရှင်းရှင်း မတွေ့လို့ ပုံအကြည်ဆုံးတွေကို ပြထားပါတယ်။</p>'}
      <div class="tshots">${(th.shots || []).map((f, i) => `<button type="button" data-i="${i}" class="${i === th.sel ? 'on' : ''}"><img src="${f.img}" alt="" /><small>${fmtDur(f.t)}</small></button>`).join('')}</div>
      </details>
      <details class="tgpt">
        <summary>🎨 ChatGPT နဲ့ 3D ပုံ လုပ်ချင်ရင် (မလုပ်လည်း ရပါတယ်)</summary>
        <button type="button" class="btn block" id="tbGet">📋 ပုံ ဒေါင်း + Prompt ကူးမည်</button>
        <button type="button" class="btn block" id="tbPrompt" style="margin-top:8px">📋 Prompt ပဲ ကူးမည်</button>
        <a class="btn block" id="tbOpen" href="https://chatgpt.com/" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:8px">💬 ChatGPT ဖွင့်မည်</a>
        <ol class="muted small tsteps">
          <li><b>+</b> ကိုနှိပ်ပြီး ဒေါင်းထားတဲ့ ပုံကို ထည့်ပါ</li>
          <li>Prompt ကို paste လုပ်ပြီး ပို့ပါ</li>
          <li>ထွက်လာတဲ့ 3D ပုံကို Download လုပ်ပြီး သုံးပါ</li>
        </ol>
      </details>`}
    </div>
    ${isPremium() ? `<div class="panel capp">
      <b>📝 Caption + Hashtag <span class="pbadge">💎 Premium</span></b>
      <p class="muted small" style="margin:4px 0 8px">TikTok / Facebook မှာ Video တင်တဲ့အခါ ရေးဖို့ စာ</p>
      <p class="warn small" id="capBackup" ${th.backupC ? '' : 'hidden'}>⚠ Thumbnail ခေါင်းစဉ် နဲ့ Caption စာသားများ လွဲနေခြင်း၊ အဓိပ္ပါယ် တလွဲများ ဖြစ်နေပါက <b>VPN ဖွင့်ပြီး 🔄</b> ခလုတ်ကို နှိပ်ပါ။</p>
      <div id="tbCap"></div>
    </div>` : ''}`;
  // the picture is made as soon as a shot is chosen: iPhone only saves / shares a file straight from the tap
  $('#tbRetry')?.addEventListener('click', () => { th.shots = null; th.shotErr = ''; thumbPanel(); });
  // each chosen frame is read from the video once
  th.frames = th.frames || {};
  const frameOf = i => th.frames[i] || (th.frames[i] = T.shotCanvas(th.src, th.shots[i]).catch(e => { delete th.frames[i]; throw e; }));
  const prepShot = () => {
    if (!(th.shots || []).length) return Promise.reject(new Error('ပုံ မရှိသေးပါ'));
    const i = th.sel; th.blobs = th.blobs || {};
    if (!th.blobs[i]) th.blobs[i] = frameOf(i).then(c => new Promise(r => c.toBlob(r, 'image/jpeg', 0.93))).then(b => { th.ready = { ...th.ready, [i]: b }; return b; }, e => { delete th.blobs[i]; throw e; });
    return th.blobs[i];
  };
  // the ready thumbnail: chosen shot + title drawn on it, in the chosen shape
  const THUMB_FONT = 'pt16';
  const curTitle = () => (th.custom || '').trim() || (th.titles && th.titleSel >= 0 ? th.titles[th.titleSel] || '' : '');
  const paintThumb = async () => {
    if (!(th.shots || []).length || !$('.tcards')) return;
    const tok = th.tok = (th.tok || 0) + 1;
    view.querySelectorAll('.tcards i').forEach(i => { i.hidden = false; });
    try {
      const fam = L.subFontFamily(THUMB_FONT);
      th.fontP = th.fontP || L.ensureSubFont(THUMB_FONT).catch(() => {}).then(() => document.fonts && document.fonts.load(`40px ${fam}`, 'က')).catch(() => {});
      // the video's own burned-in subtitles are kept out of the picture
      th.bandP = th.bandP || (th.src === (state.result && state.result.url) ? fetch(th.src).then(r => r.blob()) : Promise.resolve(state.file)).then(f => L.findSubBand(f)).catch(() => null);
      const [frame, , band] = await Promise.all([frameOf(th.sel), th.fontP, th.bandP]);
      th.outs = th.outs || {}; th.urls = th.urls || {};
      for (const r of ratios) {
        if (tok !== th.tok || !$('.tcards')) return;
        const c = T.composeThumb(frame, th.shots[th.sel].face, curTitle(), r, fam, { subTop: band ? band.top : 0, subH: band ? band.height : 0, style: th.style });
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        if (tok !== th.tok || !$('.tcards') || !blob) return;
        if (th.urls[r]) URL.revokeObjectURL(th.urls[r]);
        th.outs[r] = blob; th.urls[r] = URL.createObjectURL(blob);
        const card = view.querySelector(`.tcards [data-r="${r}"]`);
        card.querySelector('img').src = th.urls[r]; card.querySelector('i').hidden = true;
      }
    } catch (e) { if (tok === th.tok) toast('ပုံ ထုတ်လို့ မရပါ'); }
  };
  const pickShot = i => { th.sel = i; view.querySelectorAll('.tshots button').forEach(x => x.classList.toggle('on', +x.dataset.i === i)); paintThumb(); if (view.querySelector('.tgpt')?.open) prepShot().catch(() => {}); };
  view.querySelectorAll('.tshots button').forEach(b => { b.onclick = () => pickShot(+b.dataset.i); });
  view.querySelectorAll('.tstyles button').forEach(b => {
    b.onclick = () => {
      th.style = b.dataset.s; try { localStorage.setItem('thumbStyle', th.style); } catch {}
      view.querySelectorAll('.tstyles button').forEach(x => x.classList.toggle('on', x === b));
      paintThumb();
    };
  });
  view.querySelectorAll('.tcards button').forEach(b => {
    b.onclick = () => { th.ratio = b.dataset.r; view.querySelectorAll('.tcards button').forEach(x => x.classList.toggle('on', x === b)); };
  });
  // 🔄: the next shot, and the next AI title (unless the user wrote their own)
  $('#tbNext')?.addEventListener('click', () => {
    const n = (th.titles || []).length;
    if (n && !(th.custom || '').trim()) { th.titleSel = (th.titleSel + 1) % n; paintTitles(); }
    else if (!n && isPremium() && !th.packing) mkTitles();
    pickShot(((th.sel || 0) + 1) % th.shots.length);
  });
  let typing = 0;
  $('#tbCustom')?.addEventListener('input', e => { th.custom = e.target.value; clearTimeout(typing); typing = setTimeout(paintThumb, 350); });
  // saved straight from the tap (the picture is already made): iPhone only saves / shares a file that way
  const saveThumb = async () => {
    const blob = th.outs && th.outs[th.ratio]; if (!blob) { toast('ပုံ ပြင်နေတုန်းပါ — ခဏနေ ထပ်နှိပ်ပါ'); return; }
    const name = state.file.name.replace(/\.[^.]+$/, '') + '_thumb_' + th.ratio.replace(':', 'x') + '.jpg';
    const file = new File([blob], name, { type: 'image/jpeg' });
    if (IS_IOS && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (IS_IOS) { showShot(blob); return; }
    download(blob, name); toast('✅ Thumbnail ဒေါင်းပြီးပါပြီ');
  };
  $('#tbDl')?.addEventListener('click', saveThumb);
  paintThumb();
  const paintTitles = () => {
    const box = $('#tbTitles'); if (!box || !(th.titles || []).length) return;
    box.innerHTML = `<div class="ttitles">${th.titles.map((t, i) => `<button type="button" data-i="${i}" class="${i === th.titleSel ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
      <button type="button" class="btn block" id="tbMkTitles" style="margin-top:8px">🔄 ခေါင်းစဉ် အသစ်ထုတ်မည်</button>`;
    box.querySelectorAll('.ttitles button').forEach(b => { b.onclick = () => { th.titleSel = +b.dataset.i; th.custom = ''; const c = $('#tbCustom'); if (c) c.value = ''; paintTitles(); paintThumb(); }; });
    $('#tbMkTitles').onclick = mkTitles;
  };
  const mkTitles = async () => {
    const b = $('#tbMkTitles'); if (b) { b.disabled = true; b.textContent = '✨ ခေါင်းစဉ် ရေးနေပါတယ်…'; }
    th.packing = true;
    try { th.titles = T.parseTitles(await L.premiumAI(T.titlesPrompt(state.burmese), true, { backup: true })); th.titleSel = 0; th.packErr = ''; th.backupT = L.premiumAI.backup; }
    catch (e) { th.packErr = e.message.slice(0, 200); }
    th.packing = false; packErr();
    if ((th.titles || []).length) { paintTitles(); paintThumb(); } else if (b) { b.disabled = false; b.textContent = '✨ ခေါင်းစဉ် ၃ ခု ထုတ်မည်'; }
  };
  $('#tbMkTitles')?.addEventListener('click', mkTitles);
  paintTitles();
  // Premium: the pack call started with the panel; show its result (or why it failed) when it lands
  if (th.packing) {
    const tb = $('#tbMkTitles'); if (tb) { tb.disabled = true; tb.textContent = '✨ ခေါင်းစဉ် ရေးနေပါတယ်…'; }
    setTimeout(() => { const c = $('#capMk'); if (c) { c.disabled = true; c.textContent = '📝 Caption ရေးနေပါတယ်…'; } }, 0);
    th.packP.then(() => {
      if (!$('#thumbBox')) return;
      if ((th.titles || []).length) { paintTitles(); paintThumb(); } else { const b = $('#tbMkTitles'); if (b) { b.disabled = false; b.textContent = '✨ ခေါင်းစဉ် ၃ ခု ထုတ်မည်'; } }
      paintCap(); packErr();
    });
  }
  const packErr = () => {
    const e = $('#tbErr'); if (e) { e.hidden = !th.packErr; e.textContent = '⚠ ' + (th.packErr || ''); }
    const t = $('#tbBackup'); if (t) t.hidden = !th.backupT;
    const c = $('#capBackup'); if (c) c.hidden = !th.backupC;
  };
  // the caption text and its hashtags apart: tags are chips that can be left out (tap again to put back)
  const splitCap = c => {
    const m = String(c || '').match(/\n\s*\n((?:#\S+\s*)+)$/);
    return m ? { text: c.slice(0, m.index).trim(), tags: m[1].trim().split(/\s+/) } : { text: String(c || '').trim(), tags: [] };
  };
  const copyText = async (text, ok) => {
    let done = copyNow(text);
    if (!done) { try { await navigator.clipboard.writeText(text); done = true; } catch {} }
    toast(done ? ok : 'ကူးမရပါ — ထပ်နှိပ်ကြည့်ပါ');
  };
  const paintCap = () => {
    const box = $('#tbCap'); if (!box) return;
    if (!th.caption) {
      box.innerHTML = '<button type="button" class="btn block" id="capMk">📝 Caption + Hashtag ရေးမည်</button>';
    } else {
      if (th.capFor !== th.caption) { Object.assign(th, splitCap(th.caption), { tagOff: [], capFor: th.caption }); }
      box.innerHTML = `<textarea id="capTxt" rows="5">${esc(th.text)}</textarea>
        <div class="two"><button type="button" class="btn" id="capCopy">📋 Caption ကူး</button><button type="button" class="btn" id="capMk">🔄 အသစ်ရေးမည်</button></div>
        ${th.tags.length ? `<div class="row" style="margin-top:14px"><b># Hashtag</b><span class="muted small" id="tagN"></span></div>
        <div class="tagchips">${th.tags.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('')}</div>
        <p class="muted small" style="margin:6px 0 0">မလိုတာကို နှိပ်ရင် ဖယ်ပါမယ် (ပြန်နှိပ်ရင် ပြန်ထည့်)</p>
        <button type="button" class="btn block" id="tagCopy" style="margin-top:8px"># Hashtag ပဲ ကူးမည်</button>` : ''}
        <button type="button" class="btn primary block" id="capAll">📋 Caption + Hashtag အကုန်ကူးမည်</button>`;
      const tagsOn = () => th.tags.filter((_, i) => !th.tagOff.includes(i));
      const paintTags = () => {
        box.querySelectorAll('.tagchips button').forEach(b => b.classList.toggle('off', th.tagOff.includes(+b.dataset.i)));
        const n = $('#tagN'); if (n) n.textContent = `${tagsOn().length} / ${th.tags.length} ခု ရွေးထား`;
      };
      box.querySelectorAll('.tagchips button').forEach(b => {
        b.onclick = () => { const i = +b.dataset.i; th.tagOff = th.tagOff.includes(i) ? th.tagOff.filter(x => x !== i) : [...th.tagOff, i]; paintTags(); };
      });
      paintTags();
      $('#capTxt').oninput = e => { th.text = e.target.value; };
      $('#capCopy').onclick = () => copyText(th.text.trim(), '✅ Caption ကူးပြီးပါပြီ');
      $('#tagCopy')?.addEventListener('click', () => copyText(tagsOn().join(' '), '✅ Hashtag ကူးပြီးပါပြီ'));
      $('#capAll').onclick = () => copyText([th.text.trim(), tagsOn().join(' ')].filter(Boolean).join('\n\n'), '✅ Caption + Hashtag ကူးပြီးပါပြီ');
    }
    $('#capMk').onclick = async () => {
      const b = $('#capMk'); b.disabled = true; b.textContent = '📝 ရေးနေပါတယ်…';
      try { th.caption = T.parseCaption(await L.premiumAI(T.captionPrompt(state.burmese), true, { backup: true })); th.backupC = L.premiumAI.backup; }
      catch (e) { toast(e.message.slice(0, 120)); }
      paintCap(); packErr();
    };
  };
  paintCap();
  if (!$('#tbGet')) return;
  view.querySelector('.tgpt').addEventListener('toggle', e => { if (e.target.open) prepShot().catch(() => {}); });
  $('#tbPrompt').onclick = async () => {
    const chosen = curTitle();
    const prompt = chosen ? T.chatgptPromptWithTitle(chosen) : T.chatgptPrompt(state.burmese);
    let ok = copyNow(prompt);
    if (!ok) { try { await navigator.clipboard.writeText(prompt); ok = true; } catch {} }
    toast(ok ? '✅ Prompt ကူးပြီးပါပြီ — ChatGPT မှာ paste လုပ်ပါ' : 'ကူးမရပါ — ထပ်နှိပ်ကြည့်ပါ');
  };
  $('#tbGet').onclick = async () => {
    const b = $('#tbGet'); b.disabled = true;
    const chosen = curTitle();
    const prompt = chosen ? T.chatgptPromptWithTitle(chosen) : T.chatgptPrompt(state.burmese);
    // iPhone: copied at once, inside the tap; the share sheet that opens next would otherwise block the copy
    const copying = IS_IOS && copyNow(prompt) ? Promise.resolve(true) : navigator.clipboard.writeText(prompt).then(() => true, () => false);
    const name = state.file.name.replace(/\.[^.]+$/, '') + '_character.jpg';
    try {
      const ready = th.ready && th.ready[th.sel];
      const blob = ready || await prepShot();
      if (!blob) throw new Error('no picture');
      const file = new File([blob], name, { type: 'image/jpeg' });
      let saved = false;
      // iPhone: the share sheet ("Save Image" / straight to ChatGPT); a plain download link does nothing there
      if (IS_IOS && ready && navigator.canShare && navigator.canShare({ files: [file] })) {
        b.disabled = false;                       // the share promise can stay open after "Save Image"
        try { await navigator.share({ files: [file] }); saved = true; }
        catch (e) { if (e && e.name === 'AbortError') saved = true; }
      }
      if (!saved && IS_IOS) { showShot(blob); saved = true; }
      if (!saved) download(blob, name);
      const copied = await copying;
      toast(copied ? '✅ ပုံ ယူပြီး Prompt ကူးပြီးပါပြီ — ChatGPT ဖွင့်ပါ' : 'ပုံ ယူပြီးပါပြီ — Prompt ကူးမရလို့ ထပ်နှိပ်ပါ');
    } catch { toast('ပုံ ထုတ်လို့ မရပါ'); }
    b.disabled = false;
  };
}

// copies right away (no promise), so it still counts as part of the tap on iPhone
function copyNow(text) {
  const t = document.createElement('textarea');
  t.value = text; t.readOnly = true; t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(t);
  let ok = false;
  try { t.focus(); t.select(); t.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch {}
  t.remove();
  return ok;
}

// iPhone fallback: show the picture so it can be saved with a long press
function showShot(blob) {
  const box = $('#tbShow'); if (!box) return;
  if (box.dataset.url) URL.revokeObjectURL(box.dataset.url);
  box.dataset.url = URL.createObjectURL(blob);
  box.innerHTML = `<img src="${box.dataset.url}" alt="" style="width:100%;border-radius:12px;margin-top:8px" />
    <p class="tip small" style="margin-top:6px">👆 ပုံကို ဖိနှိပ်ထားပြီး <b>Save to Photos</b> (ဓာတ်ပုံထဲ သိမ်းမည်) ကို ရွေးပါ</p>`;
}

/* ---------------- Cut a finished video (start / end), no re-encoding ---------------- */
const cutState = { file: null, url: null, dur: 0, s: 0, e: 0 };
function pageCut() {
  const c = cutState;
  const maxCut = () => Math.max(0.5, Math.floor((c.dur || 0) * 0.9 * 2) / 2);
  view.innerHTML = `
    <h2>✂ Video ဖြတ်မည်</h2>
    <p class="muted small">ထုတ်ပြီးသား Video (ဒါမှမဟုတ် ဖုန်းထဲက ဘယ် Video မဆို) ရဲ့ အစ / အဆုံး ကို ပြန်မပေါင်းဘဲ စက္ကန့်ပိုင်းအတွင်း ဖြတ်ပေးပါတယ်။ အရည်အသွေး မကျပါ။</p>
    <label class="drop ${c.file ? 'has' : ''}" for="cutF">
      <input id="cutF" type="file" accept="video/*" hidden />
      <b>${c.file ? esc(c.file.name) : 'နှိပ်၍ Video ရွေးပါ'}</b>
      <span class="muted small">${c.file ? (c.file.size / 1048576).toFixed(1) + ' MB · ' + fmtDur(c.dur) : 'MP4, MOV, WEBM, MKV'}</span>
    </label>
    ${c.file ? `
    <video id="cutV" src="${c.url}" controls playsinline preload="metadata" style="width:100%;border-radius:16px;margin:10px 0;background:#000"></video>
    <div class="kbox">
      <div class="row"><b>⏮ အစကနေ ဖြတ်မည်</b><span id="cutSV"></span></div>
      ${pmRow('cutS', 0, maxCut(), 0.5, c.s)}
      <div class="row" style="margin-top:14px"><b>⏭ အဆုံးကနေ ဖြတ်မည်</b><span id="cutEV"></span></div>
      ${pmRow('cutE', 0, maxCut(), 0.5, c.e)}
      <p class="small" style="margin:12px 0 0">⏱ ကြာချိန်: <b>${fmtDur(c.dur)}</b> → <b id="cutLen"></b></p>
      <p class="muted small" style="margin:6px 0 0">💡 အဆုံးကို အတိအကျ ဖြတ်ပါတယ်။ အစကို ဖြတ်ရင် ၁–၂ စက္ကန့် စောနိုင်ပါတယ် (Video ရဲ့ keyframe ကြောင့်)။</p>
    </div>
    <div id="cutProg" hidden>${bar()}</div>
    <button class="btn primary block" id="cutGo">✂ ဖြတ်ပြီး Download လုပ်မည်</button>` : ''}`;

  $('#cutF').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (c.url) URL.revokeObjectURL(c.url);
    Object.assign(c, { file: f, url: URL.createObjectURL(f), s: 0, e: 0, dur: 0 });
    c.dur = await L.videoDuration(f).catch(() => 0);
    if (!c.dur) toast('Video အရှည် ဖတ်မရပါ — ဒီဖုန်းက ဒီဖိုင်ကို မဖွင့်နိုင်ပါ');
    pageCut();
  };
  if (!c.file) return;

  const v = $('#cutV');
  const show = which => {
    const len = Math.max(0, c.dur - c.s - c.e);
    $('#cutSV').textContent = c.s ? `${c.s} စက္ကန့်` : 'မဖြတ်ပါ';
    $('#cutEV').textContent = c.e ? `${c.e} စက္ကန့်` : 'မဖြတ်ပါ';
    $('#cutLen').textContent = fmtDur(len);
    $('#cutGo').disabled = !(c.s || c.e) || len < 1;
    if (which && v.duration) { v.pause(); v.currentTime = which === 's' ? c.s : Math.max(0, v.duration - c.e); }
  };
  const bind = (id, key) => {
    const set = x => {
      const other = key === 's' ? c.e : c.s;
      c[key] = Math.max(0, Math.min(maxCut(), Math.max(0, c.dur - other - 1), Math.round(x * 2) / 2));
      $('#' + id).value = c[key]; show(key);
    };
    $('#' + id).oninput = e => set(+e.target.value);
    $('#' + id + 'M').onclick = () => set(c[key] - 0.5);
    $('#' + id + 'P').onclick = () => set(c[key] + 0.5);
  };
  bind('cutS', 's'); bind('cutE', 'e'); show();
  v.addEventListener('timeupdate', () => {                      // playing stops where the cut video will end
    if (c.e > 0 && v.duration && !v.paused && v.currentTime >= v.duration - c.e) v.pause();
  });

  $('#cutGo').onclick = async () => {
    const btn = $('#cutGo'); btn.disabled = true; state.busy = true;
    $('#cutProg').hidden = false; setProg(0, 'ဖြတ်နေပါတယ်…');
    try {
      const r = await L.cutVideo(c.file, c.s, c.dur - c.e, p => setProg(Math.min(0.99, p), 'ဖြတ်နေပါတယ်…'));
      setProg(1, 'ပြီးပါပြီ');
      download(r.blob, c.file.name.replace(/\.[^.]+$/, '') + '_cut.' + r.ext);
      toast('✅ ဖြတ်ပြီးပါပြီ — Download လုပ်ထားပါတယ်');
    } catch (e) { toast(e.message || 'ဖြတ်လို့ မရပါ'); }
    state.busy = false; btn.disabled = false;
  };
}

/* ---------------- start ---------------- */
if (import.meta.env.DEV) window.__recap = { state, go };     // for local UI tests only (not in the built app)
startIcons();
buildMenu();
(async () => {
  // does this Worker use access codes, and is the saved code still good?
  view.innerHTML = '<p class="muted" style="margin-top:30px;text-align:center">ဖွင့်နေပါတယ်…</p>';
  const r = await L.accessCheck().catch(() => null);
  if (r && (r.name || r.error === 'bad_code' || r.error === 'expired')) {      // an older Worker without codes answers 404: stay open
    acc.on = true;
    if (r.name) setQuota(r);
  }
  if (!L.cfg.aaiKey && !L.premium.on && !L.freeKey.on && (!acc.on || acc.ok)) page = 'keys';
  render();
})();
