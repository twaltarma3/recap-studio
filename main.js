import './style.css';
import './theme.css';
import './mobile.css';
import './design.css';
import { startIcons } from './icons.js';
import * as L from './lib.js';
import * as H from './history.js';
import * as T from './thumb.js';

const $ = (s, r = document) => r.querySelector(s);
const DEFAULTS = { pitch: 10, rate: 20, keepTalk: 0, keepGap: 0.3, offset: 0, maxTempo: 2.0, dubGain: 1.8 };
const state = {
  step: 1, showSrc: false, file: null, videoDur: 0, lang: 'auto', segs: [], sourceLines: [],
  burmese: [], personaId: 'TH', ...DEFAULTS, result: null, busy: false, origSegs: null,
  fxMirror: false, fxBlur: false, blurH: 15, blurY: 100, blurS: 50, blurO: 100, previewUrl: null, previewFor: null,
  pStyle: 'recap', fxRatio: 'orig', fxFit: 'crop', fxZoom: 100, fxFast: true, fxFps30: true, trimEnd: 0, trimFor: '', wmOn: false, wmText: '', wmPos: 'br', wmSize: 4,
  logoOn: false, logoData: null, logoPos: 'tr', logoSize: 14, tab: 'video',
  fxSubs: false, subS: 5, subY: 88, subC: '#ffffff', subO: '#000000', subFont: 'pt16', fontOk: false
};
// access codes: on only when the Worker has them set up (accessCheck answers something other than {open:true})
const acc = { on: false, ok: false, name: '', limit: 0, used: 0, left: -1 };
const setQuota = r => Object.assign(acc, { ok: true, name: r.name || '', limit: r.limit || 0, used: r.used || 0, left: r.left ?? -1 });
const quotaTxt = () => acc.limit > 0 ? `ယနေ့ ကျန် ${acc.left}/${acc.limit} ပုဒ်` : 'အကန့်အသတ် မရှိ';
const STEPS = ['ဗီဒီယိုတင်', 'မူရင်းစာသား', 'ဘာသာပြန်', 'ရလဒ်'];
const view = $('#view');
const selFont = () => (state.subFont === 'custom' && !state.fontOk) ? 'system' : state.subFont;
let page = 'free'; // 'free' | 'premium' | 'keys' | 'guide' | 'history'

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
const bar = () => `<div class="bar"><i id="fill"></i></div><div class="pct"><span id="ptxt">…</span><b id="pnum">0%</b></div>
  <div class="ptime">⏱ ကြာချိန် <b id="ptime">0:00</b></div>`;
const fmtDur = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
// elapsed-time clock under the progress bar; returns a stop function that gives the seconds taken
function startClock() {
  const t0 = Date.now();
  const tick = () => { const el = $('#ptime'); if (el) el.textContent = fmtDur((Date.now() - t0) / 1000); };
  const iv = setInterval(tick, 1000); tick();
  return () => { clearInterval(iv); return (Date.now() - t0) / 1000; };
}
function setProg(frac, text) {
  const f = $('#fill'); if (!f) return;
  f.style.width = Math.round(frac * 100) + '%';
  $('#pnum').textContent = Math.round(frac * 100) + '%';
  if (text) $('#ptxt').textContent = text;
}
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// drop extra blank lines at the end (a stray Enter) so the line count still matches
const trimTail = (lines, n) => { while (lines.length > n && lines[lines.length - 1] === '') lines.pop(); return lines; };
function clearResult() {
  state.thumb = null;                                                           // thumbnail belongs to that result
  if (state.result && state.result.url) URL.revokeObjectURL(state.result.url);   // free the old video from memory
  state.result = null;
}
// friendly hint under an error box: what to check before trying again
const errTip = html => view.insertAdjacentHTML('beforeend', `<div class="warn">${html}</div>`);
const showErr = (e) => { const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message || String(e); view.appendChild(d); };
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

const canGo = n => !state.busy && n !== state.step &&
  (n === 1 || (n === 2 && state.segs.length > 0) || (n === 3 && state.burmese.length > 0) || (n === 4 && !!state.result));
function renderStepper() {
  const vis = STEPS.map((s, i) => ({ s, n: i + 1 }));
  $('#stepper').innerHTML = vis.map((x, k) => {
    const n = x.n, cls = n === state.step ? 'on' : n < state.step ? 'done' : '';
    return `<span class="${cls} ${canGo(n) ? 'link' : ''}" data-n="${n}"><b>${k + 1}</b>${x.s}</span>`;
  }).join('');
  $('#stepper').querySelectorAll('.link').forEach(el => { el.onclick = () => go(+el.dataset.n); });
}
function go(step) { state.step = step; render(); window.scrollTo(0, 0); }
function render() {
  histUrls.forEach(u => URL.revokeObjectURL(u)); histUrls = [];      // leaving / redrawing History: free its videos
  const stp = $('#stepper');
  if (acc.on && !acc.ok && !['code', 'admin', 'guide'].includes(page)) page = 'code';   // no valid code yet
  if (page === 'free') {
    stp.style.display = '';
    renderStepper();
    [null, step1, step2, step3, step4][state.step]();
  } else {
    stp.style.display = 'none';
    ({ premium: pagePremium, keys: pageKeys, guide: pageGuide, history: pageHistory, code: pageCode, admin: pageAdmin }[page])();
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
      <button class="ditem" data-p="premium"><span>✨</span><b>Premium Recap</b><small>မကြာမီ</small></button>
      <button class="ditem" data-p="keys"><span>⚙</span><b>API Key Settings</b><small>AssemblyAI Key · FFmpeg Engine</small></button>
      <button class="ditem" data-p="guide"><span>📖</span><b>အသုံးပြုပုံ လမ်းညွှန်</b><small>အဆင့်လိုက် ရှင်းလင်းချက်</small></button>
      <button class="ditem" data-p="history"><span>🗂</span><b>မှတ်တမ်း (History)</b><small>နောက်ဆုံး ထုတ်ထားတဲ့ Video ၂ ခု</small></button>
      <button class="ditem" data-p="code" id="dCode" hidden><span>🔑</span><b>Access Code</b><small id="dCodeTxt">…</small></button>
      <button class="ditem" data-p="admin" id="dAdmin" hidden><span>🛡</span><b>Admin</b><small>Code ထုတ်ရန် · Limit စီမံရန်</small></button>
    </nav>`);
  burger.onclick = openDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#dclose').onclick = closeDrawer;
  document.querySelectorAll('.ditem').forEach(b => { b.onclick = () => openPage(b.dataset.p); });
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
        <div class="tip">💡 Key တွေကို ဒီဖုန်း browser ထဲမှာပဲ သိမ်းပါတယ်။ Browser data ဖျက်ရင် ပြန်ထည့်ရပါမယ်။</div>`, true)}

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
          <li><b>📋 Copy Full Prompt</b> ကိုနှိပ်ပါ။</li>
          <li><b>Gemini App ဖွင့်မည်</b> ကိုနှိပ်ပြီး Gemini မှာ Prompt ကို Paste လုပ်ပါ။</li>
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

/* ---------------- Premium (placeholder) ---------------- */
function pagePremium() {
  view.innerHTML = `
    <h2>Premium Recap</h2>
    <p class="muted">ဒီအပိုင်းကို မကြာမီ ထည့်သွင်းပါမည်။</p>
    <button class="btn primary" id="toFree">Free Recap သို့ သွားမည်</button>`;
  $('#toFree').onclick = () => openPage('free');
}

/* ---------------- API Key Settings ---------------- */
let ffBusy = false, ffCached = false;
function pageKeys() {
  view.innerHTML = `
    <h2>API Keys Settings</h2>
    <p class="muted small">Key တွေကို ဒီဖုန်း browser ထဲမှာပဲ သိမ်းပါတယ်။</p>

    <div class="kbox">
      <div class="krow">
        <b>AssemblyAI API Key<br><span class="muted small" style="font-weight:400">(အသံဖိုင် စာသားပြောင်းရန်)</span></b>
        <div class="badges"><span class="badge req">Required</span><span class="badge" id="aaiBadge"></span></div>
      </div>
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
    b.textContent = dirty ? 'Unsaved' : ok ? 'Active' : 'Not set';
    b.className = 'badge' + (!dirty && ok ? ' ok' : '');
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
      out.className = 'tip'; out.textContent = `✅ အသံရပါတယ် (${(ab.byteLength / 1024).toFixed(0)} KB · ${sec} စက္ကန့် · ${L.ttsInfo.last === 'phone' ? 'ဖုန်းကနေ တိုက်ရိုက်' : 'Worker ကနေ'})`;
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
        <div class="row" style="margin-top:14px"><b>✂ နောက်ဆုံးပိုင်း ဖြတ်မည်</b><span id="trimEndV"></span></div>
        ${pmRow('trimEnd', 0, trimMax(), 0.5, state.trimEnd)}
        <p class="muted small" style="margin:4px 0 0">ဇာတ်ကားနာမည်၊ ကြော်ငြာ စတဲ့ မလိုတာတွေ အဆုံးမှာ ပါရင် ဖြတ်ပါ။ ဖြတ်မယ့်နေရာကို Preview မှာ ပြပေးပါမယ် — ဖြတ်လိုက်တဲ့အပိုင်းမှာ မြန်မာအသံ / စာတန်း မထည့်ပါ။</p>
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
        <input id="fxMirror" type="checkbox" style="${chk}" ${state.fxMirror ? 'checked' : ''} />
        ↔ Mirror (ဘယ်ညာ လှန်မည်)
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px">
        <input id="fxBlur" type="checkbox" style="${chk}" ${state.fxBlur ? 'checked' : ''} />
        🌫 Blur (စာတန်းထိုး ဖုံးမည်)
      </label>
      <div id="blurBox" ${state.fxBlur ? '' : 'hidden'}>
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

// "cut the ending": seconds removed from the end of the video (reset when another video is chosen)
const trimMax = () => Math.max(1, Math.min(120, Math.floor((state.videoDur || 0) * 0.5)));
const trimTxt = () => state.trimEnd > 0
  ? `နောက်ဆုံး ${state.trimEnd} စက္ကန့် → ${fmtDur(Math.max(0, (state.videoDur || 0) - state.trimEnd))}`
  : 'မဖြတ်ပါ';
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
      if (on) { wm.textContent = state.wmText; wm.style.fontSize = Math.max(8, Math.round(mn * state.wmSize / 100)) + 'px'; wm.style.fontFamily = L.subFontFamily(selFont()); place(wm, state.wmPos); }
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
  v.addEventListener('timeupdate', () => {
    if (state.trimEnd > 0 && v.duration && !v.paused && v.currentTime >= v.duration - state.trimEnd) { v.pause(); toast('✂ ဒီနေရာမှာ Video ဆုံးပါမယ်'); }
  });
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
  $('#fxFast').onchange = e => { state.fxFast = e.target.checked; };
  $('#fxFps30').onchange = e => { state.fxFps30 = e.target.checked; };
  $('#fxMirror').onchange = e => { state.fxMirror = e.target.checked; apply(); };
  $('#fxBlur').onchange = e => { state.fxBlur = e.target.checked; $('#blurBox').hidden = !state.fxBlur; apply(); };
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
  bindPM('fxZoom', 'fxZoom', 100, 250, 10);
  {
    const key = state.file ? state.file.name + '|' + state.file.size : '';
    if (state.trimFor !== key) { state.trimFor = key; state.trimEnd = 0; }
    const mx = trimMax();
    const setTrim = x => {
      state.trimEnd = Math.max(0, Math.min(mx, Math.round(x * 2) / 2));
      $('#trimEnd').value = state.trimEnd; $('#trimEndV').textContent = trimTxt();
      const pv = $('#pvVid');                                  // show where the video will end
      if (pv && pv.duration && state.trimEnd > 0) { pv.pause(); pv.currentTime = Math.max(0, pv.duration - state.trimEnd); }
    };
    $('#trimEnd').max = mx; $('#trimEndV').textContent = trimTxt();
    $('#trimEnd').oninput = e => setTrim(+e.target.value);
    $('#trimEndM').onclick = () => setTrim(state.trimEnd - 0.5);
    $('#trimEndP').onclick = () => setTrim(state.trimEnd + 0.5);
  }
  bindPM('wmSize', 'wmSize', 2, 10, 1);
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
    ${acc.on && acc.ok ? `<p class="muted small quota">🎟 ${esc(acc.name)} · <b>${quotaTxt()}</b></p>` : ''}
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
    <label>မူရင်းစကားပြောဘာသာ
      <select id="lang">
        ${[['zh', 'Chinese 中文'], ['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['auto', 'Auto detect']]
          .map(([v, t]) => `<option value="${v}" ${v === state.lang ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>
    <div style="position:sticky;bottom:0;z-index:4;margin:12px -6px 0;padding:10px 6px;background:linear-gradient(180deg,rgba(20,20,23,0),#141417 35%)"><button id="next" class="btn primary" style="margin:0" ${state.file ? '' : 'disabled'}>စာသားထုတ်မည် (Next)</button></div>`;
  $('#f').onchange = e => { state.file = e.target.files[0] || null; state.segs = []; state.origSegs = null; L.forgetInput(); step1(); };
  $('#lang').onchange = e => { state.lang = e.target.value; };
  bindLinkBox();
  if (state.file) bindPreview();
  $('#next').onclick = () => {
    if (!L.cfg.aaiKey) { toast('API Key အရင်ထည့်ပါ'); openPage('keys'); return; }
    state.segs.length ? go(2) : transcribeFlow();
  };
}

async function transcribeFlow() {
  state.step = 2; state.busy = true; renderStepper();
  view.innerHTML = `<h2>စာသား ထုတ်နေပါတယ်…</h2><p class="muted">ခဏစောင့်ပေးပါ — ဒီ tab ကို ဖွင့်ထားပါ။</p>${bar()}`;
  const stopClock = startClock();
  try {
    setProg(0.02, 'Engine ပြင်ဆင်နေသည်');
    await L.getFFmpeg();
    state.videoDur = await L.videoDuration(state.file).catch(() => 0);   // browser can't decode some codecs; ffmpeg still can
    setProg(0.05, 'အသံ ဆွဲထုတ်နေသည်');
    const wav = await L.extractAudio(state.file, p => setProg(0.05 + p * 0.2, 'အသံ ဆွဲထုတ်နေသည်'));
    if (!state.videoDur) state.videoDur = Math.max(0, (wav.size - 44) / 32000);   // 16 kHz mono 16-bit wav
    const names = { uploading: 'Server သို့ ပို့နေပါသည်', queued: 'တန်းစီစောင့်နေသည်', processing: 'စာသားထုတ်ယူနေပါသည်' };
    let tick = 0.3;
    state.origSegs = null;
    state.segs = await L.transcribe(wav, state.lang, st => { tick = Math.min(tick + 0.04, 0.95); setProg(tick, names[st] || st); });
    state.burmese = []; state.busy = false;
    stopClock();
    go(2);
  } catch (e) {
    stopClock();
    view.innerHTML = `<h2>အမှားရှိနေပါသည်</h2>`; showErr(e);
    errTip('⚠ <b>VPN ချိတ်ထားရင် ဖြုတ်ပြီး</b> ပြန်ကြိုးစားပါ။ Wi-Fi / Internet ကောင်းမကောင်းလည်း စစ်ပါ။ (AssemblyAI Key မှန်လားဆိုတာ API Key Settings → 🔎 စစ်ဆေးမည် နဲ့ စစ်နိုင်ပါတယ်)');
    state.busy = false; renderStepper();
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
    <div class="chips" id="pStyle" style="margin:0 0 8px"><button type="button" class="chip" data-s="recap">🔥 Recap (လှုပ်ရှား)</button><button type="button" class="chip" data-s="chat">💬 ရိုးရိုးစကားပြော</button></div>
    <button id="copy" class="btn block">📋 Copy Full Prompt</button>
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
  $('#copy').onclick = async () => {
    if (!syncSrc()) return;
    const text = L.buildPrompt(state.segs, state.pStyle);
    try { await navigator.clipboard.writeText(text); toast('Prompt ကူးပြီးပါပြီ'); }
    catch { $('#json').value = text; toast('ကူးမရပါ — အောက်ကနေ ရွေးကူးပါ'); }
  };
  $('#next').onclick = () => {
    try {
      const t = L.parseTranslations($('#json').value);
      if (t.length !== state.segs.length) toast(`အရေအတွက် မကိုက်ပါ (${t.length}/${state.segs.length}) — ဘာသာပြန် အဆင့်မှာ ပြင်ပါ`);
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
    <div class="row"><h2>မြန်မာဘာသာပြန်ကို စစ်ဆေးပါ</h2><button class="ghost" id="back">‹ နောက်သို့</button></div>
    <p class="muted">တစ်ကြောင်းလျှင် စာတစ်ကြောင်း။ (${state.segs.length} lines)</p>
    <textarea id="mm" style="min-height:300px">${esc(state.burmese.join('\n'))}</textarea>
    <div class="row" style="margin-top:20px"><b>အသံရွေးချယ်ပါ</b><span class="muted small">${L.PERSONAS.length} Voice Personas</span></div>
    <div class="voices">${voices}</div>
    <div class="panel">
      <button id="unlock" class="btn block" style="margin-top:0"></button>
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
    <button id="next" class="btn primary">အသံထုတ်ပြီး Video ပေါင်းမည်</button>`;

  const read = () => {
    const lines = trimTail($('#mm').value.split('\n').map(x => x.trim()), state.segs.length);
    return lines;
  };
  $('#mm').oninput = () => { state.burmese = read(); };
  $('#back').onclick = () => { state.burmese = read(); go(2); };
  $('#pitch').oninput = e => { state.pitch = +e.target.value; $('#pv').textContent = (state.pitch >= 0 ? '+' : '') + state.pitch + 'Hz'; };
  $('#rate').oninput = e => { state.rate = +e.target.value; $('#rv').textContent = (state.rate >= 0 ? '+' : '') + state.rate + '%'; };
  $('#gap').oninput = e => { state.keepGap = +e.target.value / 100; $('#gv').textContent = e.target.value + '%'; };
  $('#talk').oninput = e => { state.keepTalk = +e.target.value / 100; $('#tv').textContent = e.target.value + '%'; };
  $('#offs').oninput = e => { state.offset = +e.target.value / 10; $('#ov').textContent = state.offset.toFixed(1) + 's'; };
  $('#mtempo').oninput = e => { state.maxTempo = +e.target.value / 10; $('#mv').textContent = state.maxTempo.toFixed(1) + '×'; };
  $('#dgain').oninput = e => { state.dubGain = +e.target.value / 100; $('#dv').textContent = e.target.value + '%'; };

  // sliders are locked by default so scrolling with a finger can't move them
  const sliders = [...view.querySelectorAll('.panel:not(.fx) input[type=range]')];
  let unlocked = false;
  const applyLock = () => {
    sliders.forEach(s => { s.disabled = !unlocked; });
    $('#unlock').textContent = unlocked ? '🔓 ပြင်လို့ရပါပြီ — ပြီးရင် လော့ခ်ချရန် နှိပ်ပါ' : '🔒 ချိန်ညှိထားပြီး — ပြင်ချင်ရင် နှိပ်ပါ';
  };
  $('#unlock').onclick = () => { unlocked = !unlocked; applyLock(); };
  applyLock();
  const rs = document.createElement('button');
  rs.className = 'btn block'; rs.textContent = '↺ ပုံမှန်တန်ဖိုးသို့ ပြန်ထားမည်';
  $('#unlock').after(rs);
  rs.onclick = () => { state.burmese = read(); Object.assign(state, DEFAULTS); step3(); toast('ပုံမှန်တန်ဖိုး ပြန်ထားပြီးပါပြီ'); };
  view.querySelectorAll('.voice').forEach(el => el.onclick = e => {
    if (e.target.dataset.prev) return;
    state.personaId = el.dataset.id;
    view.querySelectorAll('.voice').forEach(v => v.classList.toggle('sel', v === el));
  });
  view.querySelectorAll('[data-prev]').forEach(b => b.onclick = async () => {
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
  $('#next').onclick = () => {
    state.burmese = read();
    if (state.burmese.length !== state.segs.length) {
      toast(`စာကြောင်း ${state.burmese.length} / ${state.segs.length} မကိုက်ပါ`); return;
    }
    clearResult();
    go(4);
  };
}

/* ---------------- Step 4 ---------------- */
async function step4() {
  if (state.result) return showResult();
  state.busy = true; renderStepper();
  view.innerHTML = `<h2>ဗီဒီယိုနှင့် အသုံးပြုထားသော အရာများကို ပေါင်းစပ်နေပါတယ်</h2>
    <p class="muted">ခဏစောင့်ပေးပါ — ဒီ tab ကို ဖွင့်ထားပါ၊ screen မပိတ်ပါနဲ့။</p>${bar()}`;
  let wake; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  const stopClock = startClock();
  let mtRetry = false;
  try {
    if (acc.on) {
      // one use per video per day; re-rendering the same file again today is free
      const a = await L.accessStart(`${state.file.name}|${state.file.size}`);
      if (a.error === 'limit') throw Object.assign(new Error(`ယနေ့အတွက် Video ${a.limit} ပုဒ် ထုတ်ပြီးပါပြီ`), { limit: true });
      if (a.error === 'bad_code') { acc.ok = false; throw Object.assign(new Error('Access Code မမှန်တော့ပါ (ပိတ်ထား / ဖျက်ထား)'), { badCode: true }); }
      if (!a.ticket) throw new Error('Access စစ်လို့မရပါ (' + (a.status || 'network') + ')');
      setQuota(a);
    }
    const persona = L.PERSONAS.find(p => p.id === state.personaId);
    const { video, placed, fellBack, fxFailed, fontFailed, diag, geoOk, ovlOk, subsOk, stats, timing, tries, src, out, engine, skipped } = await L.renderDub({
      file: state.file, videoDur: state.videoDur, segs: state.segs, burmese: state.burmese, trimEnd: state.trimEnd,
      persona, pitch: state.pitch, rate: state.rate,
      fx: {
        ratio: state.fxRatio, fit: state.fxFit, zoom: state.fxZoom, fast: state.fxFast, fps30: state.fxFps30,
        wm: { on: state.wmOn, text: state.wmText, pos: state.wmPos, size: state.wmSize },
        logo: { on: state.logoOn, data: state.logoData, pos: state.logoPos, size: state.logoSize },
        mirror: state.fxMirror, blur: state.fxBlur, blurH: state.blurH, blurY: state.blurY, blurS: state.blurS, blurO: state.blurO,
        subs: { on: state.fxSubs, size: state.subS, y: state.subY, color: state.subC, outline: state.subO, font: selFont() }
      }, keepTalk: state.keepTalk, keepGap: state.keepGap,
      offset: state.offset, maxTempo: state.maxTempo, dubGain: state.dubGain, onProgress: setProg
    });
    state.diag = `geo:${geoOk} subs:${subsOk} overlay:${ovlOk} fxFailed:${fxFailed}\n${diag || ''}`;
    const took = stopClock();
    state.result = { video, url: URL.createObjectURL(video), srt: L.buildSrt(state.burmese, placed), stats, took, timing, tries, src, out, engine, skipped };
    showResult();
    H.histAdd({ name: state.file.name, video, srt: state.result.srt, size: video.size, dur: state.videoDur, took })
      .catch(() => toast('မှတ်တမ်းထဲ သိမ်းဖို့ ဖုန်းထဲ နေရာမလောက်ပါ — Video ကို Download လုပ်ထားပါ'));
    if (fontFailed) toast('Font ဖွင့်မရလို့ ဖုန်း Font နဲ့ စာတန်းထိုး ထည့်ထားပါတယ်');
    else if (fxFailed) toast('Effect (Mirror/Blur/စာတန်းထိုး) အချို့ ထည့်မရလို့ ရတာလောက်ပဲ ထုတ်ထားပါတယ်');
    else if (fellBack) toast('မူရင်းအသံ ရောစပ်မရလို့ မြန်မာအသံချည်းပဲ ထည့်ထားပါတယ်');
  } catch (e) {
    if (e && e.mtStall) { mtRetry = true; return; }      // multi-core got stuck: run again on the normal engine (see finally)
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
    $('#retry').onclick = () => step4();
    $('#repick').onchange = async ev => {
      const nf = ev.target.files[0]; if (!nf) return;
      try { await L.forgetInput(); state.file = nf; state.videoDur = await L.videoDuration(nf).catch(() => state.videoDur); } catch (e2) { toast(e2.message); return; }
      step4();
    };
    $('#back').onclick = () => go(3);
  } finally {
    stopClock(); wake?.release?.(); state.busy = false; renderStepper();
    if (mtRetry) { toast('⚡ Multi-core ရပ်သွားလို့ ပုံမှန် Engine နဲ့ ပြန်ထုတ်နေပါတယ်'); setTimeout(step4, 300); }
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
  view.innerHTML = `
    <h2>ရလဒ်များ (Results)</h2>
    <video src="${state.result.url}" controls playsinline></video>
    ${state.result.took ? `<p class="muted small">⏱ ထုတ်ချိန် ${fmtDur(state.result.took)} · 🗂 မှတ်တမ်းထဲမှာ ၂၄ နာရီ သိမ်းထားပါတယ်</p>` : ''}
    ${timingBlock()}
    ${statBlock()}
    ${state.diag && /fxFailed:true|false\n[^]/.test(state.diag) && /fxFailed:true|failed|Error|error/i.test(state.diag) ? `<details style="margin:10px 0"><summary class="muted small">🛠 Effect log (အမှားရှာရန်)</summary><pre id="diagTxt" style="white-space:pre-wrap;font-size:11px;max-height:220px;overflow:auto">${esc(state.diag)}</pre><button class="btn block" id="diagCp" type="button">📋 Log ကူးမည်</button></details>` : ''}
    <button id="dl" class="btn primary">⬇ Video Download (.mp4)</button>
    <button id="srt" class="btn block">Download Subtitles (.srt)</button>
    <div id="thumbBox"><button id="thumbGo" class="btn block">🖼 Thumbnail ပြုလုပ်မည် (ChatGPT 3D)</button></div>
    <div class="row" style="margin-top:14px">
      <button id="back" class="ghost">‹ အသံရွေးချယ်မှုသို့</button>
      <button id="again" class="ghost">Video အသစ်</button>
    </div>`;
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
  if (state.thumb && state.thumb.shots) thumbPanel();
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
      <p style="margin:10px 0 0">🎟 <b>${quotaTxt()}</b></p>
      <p class="muted small" style="margin:6px 0 0">Video တစ်ပုဒ် ထုတ်တိုင်း တစ်ခါ ရေတွက်ပါတယ်။ Video တစ်ပုဒ်တည်းကို ယနေ့ထဲ ပြန်ထုတ်ရင် ထပ်မရေတွက်ပါ။ မြန်မာစံတော်ချိန် ည ၁၂ နာရီမှာ ပြန်စပါတယ်။</p>
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
      if (r.error) throw new Error('Code မမှန်ပါ (သို့) ပိတ်ထားပါတယ်');
      L.access.code = code; setQuota(r);
      toast(`✅ ${r.name} — ${quotaTxt()}`);
      openPage(L.cfg.aaiKey ? 'free' : 'keys');
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
const shareText = c => `🎬 Recap Studio\nAccess Code: ${c.code}\nတစ်ရက် ${c.limit > 0 ? c.limit + ' ပုဒ်' : 'အကန့်အသတ်မရှိ'}\n${APP_URL}`;
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

  const used = r.codes.reduce((n, c) => n + (c.today || 0), 0);
  view.innerHTML = `
    <h2>🛡 Admin</h2>
    <p class="muted small">Code ${r.codes.length} ခု · ယနေ့ (${r.day}) စုစုပေါင်း ${used} ပုဒ် ထုတ်ထားပါတယ်</p>

    <div class="kbox">
      <b>➕ Code အသစ် ထုတ်မည်</b>
      <input id="nName" placeholder="နာမည် (ဥပမာ မောင်မောင်)" maxlength="40" style="margin-top:10px" />
      <p class="muted small" style="margin:10px 0 6px">တစ်ရက်ကို ထုတ်ခွင့်</p>
      <div class="chips" id="nLimit">
        ${[[1, '၁ ပုဒ်'], [2, '၂ ပုဒ်'], [3, '၃ ပုဒ်'], [5, '၅ ပုဒ်'], [0, '∞']].map(([v, t]) => `<button type="button" class="chip ${v === 2 ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}
      </div>
      <button class="btn primary block" id="nGo">Code ထုတ်မည်</button>
    </div>

    <div id="codes">${r.codes.length ? r.codes.map(c => `
      <div class="kbox acode" data-c="${esc(c.code)}">
        <div class="krow"><b>${esc(c.name)}</b><span class="badge ${c.active ? 'ok' : 'req'}">${c.active ? 'ဖွင့်ထား' : 'ပိတ်ထား'}</span></div>
        <div class="codeline"><b class="ccode">${esc(c.code)}</b><button class="ghost cshare" title="Share">📤</button></div>
        <p class="muted small" style="margin:6px 0 0">ယနေ့ <b>${c.today || 0}</b>/${c.limit > 0 ? c.limit : '∞'} · စုစုပေါင်း ${c.total || 0} ပုဒ် · နောက်ဆုံး ${agoDays(c.last)}</p>
        <div class="krow" style="margin-top:10px">
          <span class="small">တစ်ရက် ထုတ်ခွင့်</span>
          <span class="limrow"><button class="ghost cminus">−</button><b class="clim">${c.limit > 0 ? c.limit : '∞'}</b><button class="ghost cplus">+</button></span>
        </div>
        <div class="two">
          <button class="btn ctoggle">${c.active ? '⏸ ပိတ်မည်' : '▶ ဖွင့်မည်'}</button>
          <button class="btn creset" ${c.today ? '' : 'disabled'}>↺ ယနေ့ ပြန်စ</button>
        </div>
        <button class="btn danger block cdel">🗑 ဖျက်မည်</button>
      </div>`).join('') : '<p class="muted">Code မရှိသေးပါ — အပေါ်မှာ ထုတ်ပါ။</p>'}</div>

    <button class="btn block" id="aout">Admin မှ ထွက်မည်</button>`;

  let nLim = 2;
  view.querySelectorAll('#nLimit .chip').forEach(b => { b.onclick = () => { nLim = +b.dataset.v; view.querySelectorAll('#nLimit .chip').forEach(x => x.classList.toggle('on', x === b)); }; });
  $('#nGo').onclick = async () => {
    $('#nGo').disabled = true;
    const c = await L.adminCall({ action: 'create', name: $('#nName').value.trim(), limit: nLim }).catch(e => ({ error: e.message }));
    if (c.code) { toast('✅ Code ' + c.code + ' ထုတ်ပြီးပါပြီ'); await pageAdmin(); shareCode(c); }
    else { toast('မရပါ: ' + (c.error || c.status)); $('#nGo').disabled = false; }
  };
  $('#aout').onclick = () => { L.access.adminPass = ''; syncMenu(); openPage(acc.ok || !acc.on ? 'free' : 'code'); };

  const byCode = Object.fromEntries(r.codes.map(c => [c.code, c]));
  const act = async (body, msg) => {
    const x = await L.adminCall(body).catch(e => ({ error: e.message }));
    if (x.ok) { if (msg) toast(msg); pageAdmin(); } else toast('မရပါ: ' + (x.error || x.status));
  };
  view.querySelectorAll('.acode').forEach(el => {
    const code = el.dataset.c, c = byCode[code];
    el.querySelector('.cshare').onclick = () => shareCode(c);
    const setLim = v => act({ action: 'update', code, limit: v });
    el.querySelector('.cminus').onclick = () => setLim(c.limit === 0 ? 5 : Math.max(1, c.limit - 1));
    el.querySelector('.cplus').onclick = () => setLim(c.limit === 0 ? 0 : c.limit >= 10 ? 0 : c.limit + 1);
    el.querySelector('.ctoggle').onclick = () => act({ action: 'update', code, active: !c.active }, c.active ? '⏸ ပိတ်လိုက်ပါပြီ' : '▶ ဖွင့်လိုက်ပါပြီ');
    el.querySelector('.creset').onclick = () => act({ action: 'reset', code }, '↺ ယနေ့ အရေအတွက် ပြန်စပြီးပါပြီ');
    el.querySelector('.cdel').onclick = () => { if (confirm(`${c.name} (${code}) ကို ဖျက်မှာ သေချာလား?`)) act({ action: 'delete', code }, '🗑 ဖျက်ပြီးပါပြီ'); };
  });
}

/* ---------------- Thumbnail: pick a shot of the main character, ChatGPT makes the 3D thumbnail ---------------- */
async function thumbPanel() {
  const box = $('#thumbBox'); if (!box) return;
  const th = state.thumb || (state.thumb = { shots: null, sel: 0, src: null });
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
    if (!th.shots) { box.innerHTML = `<div class="err">${esc((err && err.message) || 'ပုံထုတ်လို့ မရပါ')}</div><button id="thumbGo" class="btn block">ပြန်ကြိုးစားမည်</button>`; $('#thumbGo').onclick = () => thumbPanel(); return; }
  }
  if (!$('#thumbBox')) return;
  box.innerHTML = `
    <div class="panel thumbp">
      <b>🖼 Thumbnail (ChatGPT နဲ့ 3D ပုံ)</b>
      <p class="tstep">၁) ဇာတ်ကောင်ပုံ တစ်ပုံ ရွေးပါ</p>
      ${th.faces ? '' : '<p class="muted small">မျက်နှာ ရှင်းရှင်း မတွေ့လို့ ပုံအကြည်ဆုံးတွေကို ပြထားပါတယ်။</p>'}
      <div class="tshots">${th.shots.map((f, i) => `<button type="button" data-i="${i}" class="${i === th.sel ? 'on' : ''}"><img src="${f.img}" alt="" /><small>${fmtDur(f.t)}</small></button>`).join('')}</div>
      <p class="tstep">၂) ပုံ ဒေါင်းပြီး Prompt ကူးပါ</p>
      <button type="button" class="btn primary block" id="tbGet">📋 ပုံ ဒေါင်း + Prompt ကူးမည်</button>
      <p class="tstep">၃) ChatGPT မှာ ပုံ ထုတ်ပါ</p>
      <a class="btn block" id="tbOpen" href="https://chatgpt.com/" target="_blank" rel="noopener" style="display:block;text-align:center">💬 ChatGPT ဖွင့်မည်</a>
      <ol class="muted small tsteps">
        <li><b>+</b> ကိုနှိပ်ပြီး ဒေါင်းထားတဲ့ ပုံကို ထည့်ပါ</li>
        <li>Prompt ကို paste လုပ်ပြီး ပို့ပါ</li>
        <li>ChatGPT က ခေါင်းစဉ် ၅ ခုနဲ့ ဒီဇိုင်း ၅ မျိုး ပြပါမယ် — ကြိုက်တာ ရွေးပြီး ပြောပါ (ဥပမာ <b>"ခေါင်းစဉ် 2၊ ဒီဇိုင်း 3"</b>)</li>
        <li>ထွက်လာတဲ့ 3D ပုံကို Download လုပ်ပြီး သုံးပါ</li>
      </ol>
      <p class="warn small" style="margin-top:10px">💡 ChatGPT က မြန်မာစာလုံးကို တစ်ခါတလေ မှားရေးတတ်ပါတယ်။ မှားနေရင် <b>"ခေါင်းစဉ်စာလုံး မှန်အောင် ပြန်ထုတ်ပေးပါ"</b> လို့ ထပ်ပြောပါ။</p>
    </div>`;
  view.querySelectorAll('.tshots button').forEach(b => {
    b.onclick = () => { th.sel = +b.dataset.i; view.querySelectorAll('.tshots button').forEach(x => x.classList.toggle('on', x === b)); };
  });
  $('#tbGet').onclick = async () => {
    const b = $('#tbGet'); b.disabled = true;
    let copied = false;
    try { await navigator.clipboard.writeText(T.chatgptPrompt(state.burmese)); copied = true; } catch {}
    try {
      const blob = await T.shotBlob(th.src, th.shots[th.sel]);
      if (blob) download(blob, state.file.name.replace(/\.[^.]+$/, '') + '_character.jpg');
      toast(copied ? '✅ ပုံ ဒေါင်းပြီး Prompt ကူးပြီးပါပြီ — ChatGPT ဖွင့်ပါ' : 'ပုံ ဒေါင်းပြီးပါပြီ — Prompt ကူးမရလို့ ထပ်နှိပ်ပါ');
    } catch { toast('ပုံ ထုတ်လို့ မရပါ'); }
    b.disabled = false;
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
  if (r && (r.name || r.error === 'bad_code')) {      // an older Worker without codes answers 404: stay open
    acc.on = true;
    if (r.name) setQuota(r);
  }
  if (!L.cfg.aaiKey && (!acc.on || acc.ok)) page = 'keys';
  render();
})();
