import './style.css';
import './theme.css';
import * as L from './lib.js';

const $ = (s, r = document) => r.querySelector(s);
const DEFAULTS = { pitch: 10, rate: 20, keepTalk: 0, keepGap: 0.3, offset: 0, maxTempo: 2.0, dubGain: 1.8 };
const state = {
  step: 1, showSrc: false, file: null, videoDur: 0, lang: 'auto', segs: [], sourceLines: [],
  burmese: [], personaId: 'TH', ...DEFAULTS, result: null, busy: false, origSegs: null,
  fxMirror: false, fxBlur: false, blurH: 15, blurY: 100, blurS: 50, blurO: 100, previewUrl: null, previewFor: null,
  fxSubs: false, subS: 5, subY: 88, subC: '#ffffff', subO: '#000000', subFont: 'pt16', fontOk: false
};
const STEPS = ['Upload', 'Source Text', 'Burmese', 'Result'];
const view = $('#view');
const selFont = () => (state.subFont === 'custom' && !state.fontOk) ? 'system' : state.subFont;
let page = 'free'; // 'free' | 'premium' | 'keys' | 'guide'

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
  const vis = STEPS.map((s, i) => ({ s, n: i + 1 })).filter(x => x.n !== 2 || state.showSrc || state.step === 2);   // Source Text tab only appears when it is needed
  $('#stepper').innerHTML = vis.map((x, k) => {
    const n = x.n, cls = n === state.step ? 'on' : n < state.step ? 'done' : '';
    return `<span class="${cls} ${canGo(n) ? 'link' : ''}" data-n="${n}"><b>${k + 1}</b>${x.s}</span>`;
  }).join('');
  $('#stepper').querySelectorAll('.link').forEach(el => { el.onclick = () => go(+el.dataset.n); });
}
function go(step) { state.step = step; render(); window.scrollTo(0, 0); }
function render() {
  const stp = $('#stepper');
  if (page === 'free') {
    stp.style.display = '';
    renderStepper();
    [null, step1, step2, step3, step4][state.step]();
  } else {
    stp.style.display = 'none';
    ({ premium: pagePremium, keys: pageKeys, guide: pageGuide }[page])();
  }
  syncMenu();
}

/* ---------------- menu (hamburger + drawer) ---------------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }
function syncMenu() { document.querySelectorAll('.ditem').forEach(b => b.classList.toggle('on', b.dataset.p === page)); }
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
      <button class="ditem" data-p="free"><span>1</span><b>Free Recap</b><small>Gemini နဲ့ ကိုယ်တိုင် ဘာသာပြန်</small></button>
      <button class="ditem" data-p="premium"><span>2</span><b>Premium Recap</b><small>မကြာမီ</small></button>
      <button class="ditem" data-p="keys"><span>3</span><b>API Key Settings</b><small>AssemblyAI Key · FFmpeg Engine</small></button>
      <button class="ditem" data-p="guide"><span>4</span><b>အသုံးပြုပုံ လမ်းညွှန်</b><small>အဆင့်လိုက် ရှင်းလင်းချက်</small></button>
    </nav>`);
  burger.onclick = openDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#dclose').onclick = closeDrawer;
  document.querySelectorAll('.ditem').forEach(b => { b.onclick = () => openPage(b.dataset.p); });
  $('#openSettings').onclick = () => openPage('keys');
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
        <ol>
          <li><b>Video File ရွေးချယ်ပါ</b> ကိုနှိပ်ပြီး Video ရွေးပါ။ (MP4၊ MOV၊ WEBM၊ MKV — ၁၀ မိနစ်အထိ)</li>
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
        <div class="warn">⚠ Mirror၊ Blur၊ စာတန်းထိုး တစ်ခုခု ဖွင့်ရင် Video ကို ပြန် encode လုပ်ရလို့ ပိုကြာပါတယ် (ဖုန်းမှာ ငါးမိနစ်ထက်မက ကြာနိုင်ပါတယ်)။ မဖွင့်ရင် အရင်လိုပဲ မြန်ပါတယ်။</div>
        <p style="margin:10px 0 0">အားလုံးပြီးရင် <b>အသံထုတ်ပြီး Video ပေါင်းမည်</b> ကိုနှိပ်ပါ။</p>`)}

      ${sec(5, 'ရလဒ်', `
        <ol>
          <li>% bar ပြေးနေစဉ် <b>ဒီ tab ကို ဖွင့်ထားပါ၊ screen မပိတ်ပါနဲ့၊ refresh မလုပ်ပါနဲ့။</b></li>
          <li>ပြီးရင် Video ကို ကြည့်ပါ။ <b>Download</b> နဲ့ Video ကိုသိမ်းပါ၊ <b>.srt</b> နဲ့ စာတန်းထိုးဖိုင်ကိုလည်း သိမ်းလို့ရပါတယ်။</li>
          <li><b>⚠ ရှည်လွန်းတဲ့ စာကြောင်း</b> ပေါ်ရင် — <b>တိုအောင်ခိုင်းမည့် Prompt ကူးမည်</b> ကိုနှိပ်ပြီး Gemini မှာ paste လုပ်ပါ။ ရလာတဲ့ JSON ကို <b>Source Text tab</b> မှာ ထည့်ပြီး Video ပြန်ထုတ်ပါ။</li>
          <li>ပြန်ပြင်ချင်ရင် အပေါ်က <b>1 / 2 / 3</b> အဆင့်ဘားကို နှိပ်ပြီး ပြန်သွားနိုင်ပါတယ်။</li>
        </ol>`)}

      ${sec(6, 'အကြံပြုချက်များ', `
        <ul>
          <li>အရင်ဆုံး <b>၁-၂ မိနစ်လောက် Video တိုတိုလေး</b> နဲ့ စမ်းပါ။</li>
          <li>မူရင်းအသံ ကျယ်ပြီး မြန်မာသံကို ဖုံးနေရင် <b>🗣 စကားပြောနေစဉ်</b> ကို ပိုလျှော့ပါ။</li>
          <li>မြန်မာသံ အချိန်မကိုက်ရင် <b>⏱ အချိန်ရွှေ့</b> ကို ညှိပါ။ စာကြောင်းရှည်နေရင် Gemini ကို ပိုတိုအောင် ခိုင်းပါ။</li>
          <li>Page ကို refresh လုပ်ရင် စာသားတွေ ပျောက်ပါတယ်။</li>
          <li>AssemblyAI free plan မှာ လစဉ်သုံးခွင့် ကန့်သတ်ချက် ရှိပါတယ်။</li>
        </ul>`)}

      ${sec(7, 'ပြဿနာ ဖြေရှင်းနည်း', `
        <ul>
          <li><b>အသံမထွက်ရင် / "TTS audio မရပါ"</b> — API Key Settings မှာ <b>🔎 စစ်ဆေးမည်</b> နဲ့ Key နဲ့ ချိတ်ဆက်မှုကို စစ်ပါ။</li>
          <li><b>"File could not be read"</b> — Video ကို Downloads/Movies ထဲကနေ ပြန်ရွေးပါ။ Result tab မှာ <b>🎞 Video ပြန်ရွေးပြီး ပြန်စမည်</b> ကိုနှိပ်ပါ။</li>
          <li><b>စာတန်းထိုး Font မပေါ်ရင်</b> — Font dropdown အောက်က အခြေအနေစာကို ကြည့်ပါ။ ❌ ဆိုရင် တခြား Font ရွေးပါ။</li>
          <li><b>Video ထုတ်တာ အရမ်းကြာရင်</b> — Mirror၊ Blur၊ စာတန်းထိုး ကို ပိတ်လိုက်ပါ။</li>
          <li><b>Engine ဒေါင်းမရရင်</b> — API Key Settings မှာ <b>Cache ဖျက်မည်</b> ပြီး <b>Install</b> ပြန်နှိပ်ပါ။</li>
        </ul>`)}
    </div>
    <button class="btn primary" id="toFree">Free Recap သို့ သွားမည်</button>`;
  $('#toFree').onclick = () => openPage('free');
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
        <b>Gemini API Key<br><span class="muted small" style="font-weight:400">(အလိုအလျောက် ဘာသာပြန်ရန်)</span></b>
        <div class="badges"><span class="badge req">Required</span><span class="badge" id="gemBadge"></span></div>
      </div>
      <p style="margin:8px 0 10px"><a class="link small" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get Free Key ↗</a></p>
      <div class="keyfield">
        <input id="kGem" type="password" autocomplete="off" placeholder="Gemini API Key" />
        <button class="icon" id="gDel" title="ဖျက်မည်">🗑</button>
        <button class="icon" id="gEye" title="ပြမည်">👁</button>
      </div>
      <div class="two">
        <button class="btn" id="gTest">🔎 စစ်ဆေးမည်</button>
        <button class="btn primary" id="gSave">သိမ်းမည်</button>
      </div>
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

  /* Gemini card */
  $('#kGem').value = localStorage.getItem('geminiKey') || '';
  const gupd = () => {
    const k = localStorage.getItem('geminiKey') || '';
    const dirty = $('#kGem').value.trim() !== k, b = $('#gemBadge');
    b.textContent = dirty ? 'Unsaved' : k ? 'Active' : 'Not set';
    b.className = 'badge' + (!dirty && k ? ' ok' : '');
  };
  $('#kGem').oninput = gupd;
  $('#gEye').onclick = () => { const i = $('#kGem'); i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#gDel').onclick = () => { $('#kGem').value = ''; localStorage.removeItem('geminiKey'); gupd(); toast('Key ဖျက်ပြီးပါပြီ'); };
  $('#gSave').onclick = () => { localStorage.setItem('geminiKey', $('#kGem').value.trim()); gupd(); toast('သိမ်းပြီးပါပြီ'); };
  $('#gTest').onclick = async () => {
    localStorage.setItem('geminiKey', $('#kGem').value.trim()); gupd();
    if (!L.cfg.geminiKey) { toast('Gemini Key ကို အရင်ထည့်ပါ'); return; }
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': L.cfg.geminiKey } });
      if (r.status === 400 || r.status === 403) throw new Error('Key မမှန်ပါ');
      if (!r.ok) throw new Error('Server ပြန်ကြားချက်: ' + r.status);
      toast('✅ Key မှန်ပါတယ်');
    } catch (e) { toast(e.message === 'Failed to fetch' ? 'အင်တာနက် ချိတ်ဆက်မရပါ' : e.message); }
  };
  gupd();

  /* FFmpeg card */
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
      toast('✅ Engine အဆင်သင့်ပါပြီ');
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

function previewBlock() {
  const url = previewUrl();
  const chk = 'width:22px;height:22px;padding:0;margin:0';
  return `
    <div class="panel fx">
      <b>🎞 Video Effects <span class="muted small" style="font-weight:400">(လိုမှ ဖွင့်ပါ)</span></b>
      <p class="muted small" style="margin:6px 0 0">Video ကို လှန်ပြီး စာတန်းထိုးကို Blur နဲ့ အုပ်ဖို့ အောက်မှာ ကြည့်ပြီး ချိန်ပါ။ (Preview မှာ အသံမပါပါ)</p>
      <div style="position:relative;margin-top:12px;border-radius:14px;overflow:hidden;background:#000">
        <video id="pvVid" src="${url}" playsinline muted preload="metadata" style="display:block;width:100%;margin:0;border-radius:0"></video>
        <div id="pvBlur" style="display:none;position:absolute;left:0;right:0;pointer-events:none;box-sizing:border-box;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(255,255,255,.08);border-top:1px dashed rgba(255,255,255,.8);border-bottom:1px dashed rgba(255,255,255,.8)"></div>
        <div id="pvSub" style="display:none;position:absolute;left:4%;right:4%;text-align:center;pointer-events:none;transform:translateY(-50%);line-height:1.35;font-weight:700">မြန်မာစာတန်းထိုး နမူနာ စာကြောင်း</div>
      </div>
      <div class="row" style="margin-top:8px;gap:8px">
        <button class="ghost" id="pvPlay" type="button">▶</button>
        <input id="pvSeek" type="range" min="0" max="1000" value="0" style="flex:1" />
        <span id="pvT" class="muted small" style="white-space:nowrap">0:00</span>
      </div>
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
      <p class="muted small">⚠ Mirror၊ Blur၊ စာတန်းထိုး တစ်ခုခု ဖွင့်ရင် Video ကို ပြန် encode လုပ်ရလို့ ပိုကြာပါတယ် (ဖုန်းမှာ ငါးမိနစ်ထက်မက ကြာနိုင်ပါတယ်)။ မဖွင့်ရင် အရင်လိုပဲ မြန်ပါတယ်။</p>
    </div>`;
}

function bindPreview() {
  const v = $('#pvVid'), ov = $('#pvBlur');
  if (!v || !ov) return;
  const apply = () => {
    v.style.transform = state.fxMirror ? 'scaleX(-1)' : '';
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
  $('#pvPlay').onclick = () => { v.paused ? v.play() : v.pause(); };
  v.onclick = () => $('#pvPlay').click();
  v.onplay = () => { $('#pvPlay').textContent = '⏸'; };
  v.onpause = () => { $('#pvPlay').textContent = '▶'; };
  v.ontimeupdate = () => {
    if (v.duration) $('#pvSeek').value = Math.round((v.currentTime / v.duration) * 1000);
    $('#pvT').textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration);
  };
  $('#pvSeek').oninput = e => { if (v.duration) v.currentTime = (e.target.value / 1000) * v.duration; };
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

function step1() {
  view.innerHTML = `
    <h2>Video တင်ပါ</h2>
    <label class="drop ${state.file ? 'has' : ''}" for="f">
      <input id="f" type="file" accept="video/*" hidden />
      <b>${state.file ? state.file.name : 'နှိပ်၍ Video File ရွေးချယ်ပါ'}</b>
      <span class="muted small">${state.file ? (state.file.size / 1048576).toFixed(1) + ' MB' : 'MP4, MOV, WEBM, MKV · ၁၀ မိနစ်အထိ'}</span>
    </label>
    ${state.file ? previewBlock() : ''}
    <label>မူရင်းစကားပြောဘာသာ
      <select id="lang">
        ${[['zh', 'Chinese 中文'], ['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['auto', 'Auto detect']]
          .map(([v, t]) => `<option value="${v}" ${v === state.lang ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>
    <button id="next" class="btn primary" ${state.file ? '' : 'disabled'}>စာသားထုတ်မည် (Next)</button>`;
  $('#f').onchange = e => { state.file = e.target.files[0] || null; state.segs = []; state.origSegs = null; L.forgetInput(); step1(); };
  $('#lang').onchange = e => { state.lang = e.target.value; };
  if (state.file) bindPreview();
  $('#next').onclick = () => {
    if (!L.cfg.aaiKey || !L.cfg.geminiKey) { toast('AssemblyAI နဲ့ Gemini Key နှစ်ခုလုံး အရင်ထည့်ပါ'); openPage('keys'); return; }
    if (!state.segs.length) transcribeFlow();
    else if (state.burmese.length) go(3);
    else autoTranslate();
  };
}

// Gemini translates the transcript; on success jump straight to the Burmese tab, otherwise open Source Text so the user can fix / paste by hand
async function autoTranslate() {
  if (!L.cfg.geminiKey || !state.segs.length) return false;
  state.busy = true; renderStepper();
  view.innerHTML = `<h2>ဘာသာပြန်နေသည်…</h2><p class="muted">ခဏစောင့်ပါ။</p>${bar()}`;
  setProg(0.5, 'ဘာသာပြန်နေသည်');
  try {
    const t = await L.geminiTranslate(state.segs, s => setProg(0.6, s));
    state.busy = false;
    if (t.length === state.segs.length) { state.burmese = t; go(3); toast('ဘာသာပြန်ပြီးပါပြီ'); return true; }
    state.burmese = state.segs.map((_, i) => t[i] || '');
    state.showSrc = true; go(2); toast(`အရေအတွက် မကိုက်ပါ (${t.length}/${state.segs.length}) — စစ်ပြီး ပြင်ပါ`); return true;
  } catch (e) {
    state.busy = false; state.showSrc = true; go(2);
    toast(e.message === 'Failed to fetch' ? 'ဘာသာပြန် မရပါ — ကိုယ်တိုင် ဆက်လုပ်ပါ' : e.message); return true;
  }
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
    const names = { uploading: 'Server သို့ ပို့နေပါသည်', queued: 'တန်းစီစောင့်နေသည်', processing: 'စာသားထုတ်ယူနေပါသည်' };
    let tick = 0.3;
    state.origSegs = null;
    state.segs = await L.transcribe(wav, state.lang, st => { tick = Math.min(tick + 0.04, 0.95); setProg(tick, names[st] || st); });
    state.burmese = []; state.busy = false;
    if (await autoTranslate()) return;
    state.showSrc = true;
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
    <div class="row"><h2>မူရင်းစာသားကို စစ်ဆေးပါ</h2><button class="ghost" id="back">Back</button></div>
    <p class="muted">စာကြောင်းတစ်ကြောင်းလျှင် အချိန်တစ်ခု ကိုက်ထားသည်။ စာကြောင်းအရေအတွက် မပြောင်းပါနှင့်။ (${state.segs.length} lines)</p>
    <textarea id="src">${state.segs.map(s => s.text).join('\n').replace(/</g, '&lt;')}</textarea>
    ${L.cfg.geminiKey ? `<button id="auto" class="btn primary">✨ Gemini နဲ့ အလိုအလျောက် ဘာသာပြန်မည်</button>
    <div id="autoMsg" class="muted small" style="margin-top:8px"></div>` : `<p class="muted small" style="margin-top:12px">💡 API Key Settings မှာ Gemini Key ထည့်ထားရင် Copy/Paste မလုပ်ဘဲ အလိုအလျောက် ဘာသာပြန်ပေးပါမယ်။</p>`}
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
  if ($('#auto')) $('#auto').onclick = async () => {
    if (!syncSrc()) return;
    const btn = $('#auto'); btn.disabled = true;
    try {
      const t = await L.geminiTranslate(state.segs, s => { $('#autoMsg').textContent = s + '…'; });
      if (t.length !== state.segs.length) {
        $('#json').value = JSON.stringify({ translations: t }, null, 1);
        toast(`အရေအတွက် မကိုက်ပါ (${t.length}/${state.segs.length}) — အောက်က JSON ကို စစ်ပြီး Next နှိပ်ပါ`);
      } else {
        state.burmese = t; go(3); toast('ဘာသာပြန်ပြီးပါပြီ');
      }
    } catch (e) { toast(e.message === 'Failed to fetch' ? 'အင်တာနက် ချိတ်ဆက်မရပါ' : e.message); }
    finally { if ($('#auto')) { btn.disabled = false; $('#autoMsg').textContent = ''; } }
  };
  $('#next').onclick = () => {
    try {
      const t = L.parseTranslations($('#json').value);
      if (t.length !== state.segs.length) toast(`အရေအတွက် မကိုက်ပါ (${t.length}/${state.segs.length}) — Burmese tab မှာ ပြင်ပါ`);
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
    <div class="row"><h2>မြန်မာဘာသာပြန်ကို စစ်ဆေးပါ</h2><button class="ghost" id="back">Back</button></div>
    <p class="muted">တစ်ကြောင်းလျှင် စာတစ်ကြောင်း။ (${state.segs.length} lines)</p>
    <textarea id="mm" style="min-height:300px">${state.burmese.join('\n').replace(/</g, '&lt;')}</textarea>
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
    const lines = $('#mm').value.split('\n').map(x => x.trim());
    return lines;
  };
  $('#mm').oninput = () => { state.burmese = read(); };
  $('#back').onclick = () => { state.burmese = read(); go(state.showSrc ? 2 : 1); };
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
  view.innerHTML = `<h2>Video ပေါင်းနေသည်…</h2>
    <p class="muted">ဒီ tab ကို ဖွင့်ထားပါ၊ screen မပိတ်ပါနှင့်။</p>${bar()}`;
  let wake; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  try {
    const persona = L.PERSONAS.find(p => p.id === state.personaId);
    const { video, placed, fellBack, fxFailed, fontFailed, stats } = await L.renderDub({
      file: state.file, videoDur: state.videoDur, segs: state.segs, burmese: state.burmese,
      persona, pitch: state.pitch, rate: state.rate,
      fx: {
        mirror: state.fxMirror, blur: state.fxBlur, blurH: state.blurH, blurY: state.blurY, blurS: state.blurS, blurO: state.blurO,
        subs: { on: state.fxSubs, size: state.subS, y: state.subY, color: state.subC, outline: state.subO, font: selFont() }
      }, keepTalk: state.keepTalk, keepGap: state.keepGap,
      offset: state.offset, maxTempo: state.maxTempo, dubGain: state.dubGain, onProgress: setProg
    });
    state.result = { video, url: URL.createObjectURL(video), srt: L.buildSrt(state.burmese, placed), stats };
    showResult();
    if (fontFailed) toast('Font ဖွင့်မရလို့ ဖုန်း Font နဲ့ စာတန်းထိုး ထည့်ထားပါတယ်');
    else if (fxFailed) toast('Effect (Mirror/Blur/စာတန်းထိုး) အချို့ ထည့်မရလို့ ရတာလောက်ပဲ ထုတ်ထားပါတယ်');
    else if (fellBack) toast('မူရင်းအသံ ရောစပ်မရလို့ မြန်မာအသံချည်းပဲ ထည့်ထားပါတယ်');
  } catch (e) {
    view.innerHTML = `<h2>အမှားရှိနေပါသည်</h2>`; showErr(e);
    view.insertAdjacentHTML('beforeend', `<button class="btn primary" id="retry">ပြန်စမည်</button>
      <label class="btn block" for="repick" style="display:block;text-align:center;cursor:pointer">🎞 Video ပြန်ရွေးပြီး ပြန်စမည်<input id="repick" type="file" accept="video/*" hidden /></label>
      <button class="btn block" id="back">Burmese tab သို့ ပြန်သွားမည်</button>`);
    $('#retry').onclick = () => step4();
    $('#repick').onchange = async ev => {
      const nf = ev.target.files[0]; if (!nf) return;
      try { await L.forgetInput(); state.file = nf; state.videoDur = await L.videoDuration(nf); } catch (e2) { toast(e2.message); return; }
      step4();
    };
    $('#back').onclick = () => go(3);
  } finally { wake?.release?.(); state.busy = false; renderStepper(); }
}

function statBlock() {
  const st = state.result.stats; if (!st) return '';
  const long = st.longLines || [];
  let h = st.lateCount
    ? `<p class="muted small">⏱ နောက်ကျတဲ့ စာကြောင်း ${st.lateCount} ကြောင်း (အများဆုံး ${st.maxDrift.toFixed(1)} စက္ကန့်)</p>`
    : '<p class="muted small">✅ မြန်မာသံ အချိန်ကိုက်ညီပါတယ်</p>';
  if (long.length) h += `<div class="panel"><b>⚠ ရှည်လွန်းတဲ့ စာကြောင်း ${long.length} ကြောင်း</b>
    <p class="muted small">ID: ${long.map(x => x.i).join(', ')}<br>အသံကို အမြန်ဆုံးချုံ့လည်း အချိန်မဆန့်ပါ။ ဒီစာကြောင်းတွေကို Gemini နဲ့ တိုအောင် ပြန်ခိုင်းပါ။</p>
    <button id="shorten" class="btn block">📋 တိုအောင်ခိုင်းမည့် Prompt ကူးမည်</button>
    <button id="toStep2" class="btn block">Source Text tab သို့ သွားပြီး JSON ထည့်မည်</button></div>`;
  return h;
}

function showResult() {
  view.innerHTML = `
    <h2>ရလဒ်များ (Results)</h2>
    <video src="${state.result.url}" controls playsinline></video>
    ${statBlock()}
    <button id="dl" class="btn primary">⬇ Video Download (.mp4)</button>
    <button id="srt" class="btn block">Download Subtitles (.srt)</button>
    <div class="row" style="margin-top:14px">
      <button id="back" class="ghost">‹ အသံရွေးချယ်မှုသို့</button>
      <button id="again" class="ghost">Video အသစ်</button>
    </div>`;
  const base = state.file.name.replace(/\.[^.]+$/, '');
  $('#dl').onclick = () => download(state.result.video, base + '_recap.mp4');
  $('#srt').onclick = () => download(new Blob([state.result.srt], { type: 'text/plain' }), base + '_burmese.srt');
  $('#shorten')?.addEventListener('click', async () => {
    const t = L.buildShortenPrompt(state.segs, state.burmese, state.result.stats.longLines);
    try { await navigator.clipboard.writeText(t); toast('Prompt ကူးပြီးပါပြီ — Gemini မှာ paste လုပ်ပါ'); } catch { toast('ကူးမရပါ'); }
  });
  $('#toStep2')?.addEventListener('click', () => { state.showSrc = true; go(2); });
  $('#back').onclick = () => { state.result = null; go(3); };
  $('#again').onclick = () => { Object.assign(state, { showSrc: false, file: null, segs: [], origSegs: null, burmese: [], result: null }); go(1); };
}

/* ---------------- start ---------------- */
buildMenu();
if (!L.cfg.aaiKey || !L.cfg.geminiKey) page = 'keys';
render();
