/* ================================================================
   JSONBIN.IO SETUP — GRATIS ONLINE HIGHSCORE (3 minuten setup)
   ================================================================
   JSONBin.io slaat je scores op als een JSON-bestand in de cloud.
   Geen database, geen SQL, geen ingewikkelde configuratie.

   STAP 1 — Account aanmaken (gratis, geen creditcard nodig)
     → Ga naar https://jsonbin.io en klik op "Sign Up"
     → Registreer met e-mail (of GitHub/Google login)

   STAP 2 — Bin aanmaken (je scores-opslag)
     → Klik op "+ Create Bin" (linksboven na inloggen)
     → Plak in het tekstveld: {"scores":[]}
     → Klik "Create Bin"
     → Kopieer het Bin ID dat verschijnt (bijv. "64f2ab3c8a...")
     → Vul het in bij JSONBIN_ID hieronder

   STAP 3 — API-sleutel ophalen
     → Klik rechtsboven op je profielfoto → "Account Settings"
     → Klik op "API Keys" in het menu
     → Kopieer de "Master Key" (begint met $2a$10$...)
     → Vul hem in bij JSONBIN_KEY hieronder

   STAP 4 — Opslaan en genieten!
     Scores worden nu gedeeld over alle apparaten en browsers.
   ================================================================ */

const JSONBIN_ID  = '69a1fa9ed0ea881f40dfea09';
const JSONBIN_KEY = '$2a$10$Y/cnVoas5nDW8spumPmHg.RkT1w5dZBJoNThCtRb4in1vLQ3XmJi2';

/* ================================================================
   GAME STATE
   ================================================================ */
const G = {
  screen:            'start',
  level:             1,
  score:             0,
  lives:             3,
  correctCount:      0,
  problem:           null,
  timerInterval:     null,
  timeLeft:          10,
  locked:            false,
  questionStartTime: 0,
  vehicle:           'auto',   // 'auto' | 'boot' | 'trein'
  group:             3,        // 3 | 6
  gameOverId:        0,        // incremented to cancel stale async renders
};

/* ================================================================
   JSONBIN.IO  — online scores lezen en schrijven
   ================================================================ */
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

function jsonbinHeaders() {
  return { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY };
}

async function loadOnlineScores(groep) {
  if (!JSONBIN_ID || !JSONBIN_KEY) return null;
  try {
    const res = await fetch(`${JSONBIN_BASE}/${JSONBIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const all = Array.isArray(json.record?.scores) ? json.record.scores : [];
    // If groep supplied, filter; otherwise return all (legacy)
    if (groep != null) return all.filter(s => (s.groep || 3) === groep);
    return all;
  } catch (e) {
    console.warn('JSONBin laden mislukt:', e);
    return null;
  }
}

async function saveOnlineScore(naam, score, level, voertuig, groep) {
  if (!JSONBIN_ID || !JSONBIN_KEY) return false;
  try {
    // Read all scores (unfiltered) so we don't lose the other group's data
    const res0 = await fetch(`${JSONBIN_BASE}/${JSONBIN_ID}/latest`, { headers: { 'X-Master-Key': JSONBIN_KEY } });
    let allScores = [];
    if (res0.ok) {
      const j = await res0.json();
      allScores = Array.isArray(j.record?.scores) ? j.record.scores : [];
    }
    // Separate by group, update only this group's top-10
    const other   = allScores.filter(s => (s.groep || 3) !== groep);
    const current = allScores.filter(s => (s.groep || 3) === groep);
    current.push({ naam, score, level, voertuig, groep });
    current.sort((a, b) => b.score - a.score);
    current.splice(10);
    const merged = [...other, ...current];
    const res = await fetch(`${JSONBIN_BASE}/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: jsonbinHeaders(),
      body: JSON.stringify({ scores: merged }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  } catch (e) {
    console.warn('JSONBin opslaan mislukt:', e);
    return false;
  }
}

/* ================================================================
   LOCAL STORAGE  (fallback + always saved locally)
   ================================================================ */
const LS_SCORES_G3 = 'rekenrace_scores_g3_v1';
const LS_SCORES_G6 = 'rekenrace_scores_g6_v1';
const LS_VEHICLE   = 'rekenrace_vehicle_v1';
const LS_GROUP     = 'rekenrace_group_v1';
const LS_LAST_SAVE = 'rekenrace_last_save';

const SAVE_COOLDOWN_MS = 30_000; // prevent >1 save per 30 s
const MAX_SCORE        = 99_999; // scores boven deze grens zijn onrealistisch

function sanitizeName(raw) {
  // Strip HTML tags, then keep only printable non-markup characters
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`]/g, '')
    .trim()
    .slice(0, 14) || 'Speler';
}

function isValidScore(score, level) {
  return (
    Number.isInteger(score) && score > 0 && score <= MAX_SCORE &&
    Number.isInteger(level) && level >= 1 && level <= 8
  );
}

function checkRateLimit() {
  const last = parseInt(localStorage.getItem(LS_LAST_SAVE) || '0', 10);
  return Date.now() - last >= SAVE_COOLDOWN_MS;
}

function markRateLimit() {
  localStorage.setItem(LS_LAST_SAVE, String(Date.now()));
}

// Legacy key — migrate old scores into G3 bucket on first load
const LS_SCORES_LEGACY = 'rekenrace_scores_v2';

function lsKeyForGroup(g) { return g === 6 ? LS_SCORES_G6 : LS_SCORES_G3; }

function loadLocalScores(g) {
  try {
    const key = lsKeyForGroup(g);
    let raw = JSON.parse(localStorage.getItem(key)) || [];
    // Migrate legacy scores into G3 on first access
    if (g !== 6 && raw.length === 0) {
      const legacy = JSON.parse(localStorage.getItem(LS_SCORES_LEGACY)) || [];
      if (legacy.length) { raw = legacy; localStorage.setItem(key, JSON.stringify(raw)); }
    }
    return raw.map(s => ({
      naam:     s.naam     || s.name    || 'Speler',
      score:    s.score    || 0,
      level:    s.level    || 1,
      voertuig: s.voertuig || s.vehicle || 'auto',
      groep:    s.groep    || (g === 6 ? 6 : 3),
    }));
  } catch { return []; }
}

function addLocalScore(naam, score, level, voertuig, groep) {
  const scores = loadLocalScores(groep);
  scores.push({ naam, score, level, voertuig, groep });
  scores.sort((a, b) => b.score - a.score);
  scores.splice(10);
  localStorage.setItem(lsKeyForGroup(groep), JSON.stringify(scores));
}

/* ================================================================
   AUDIO
   ================================================================ */
let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  return audioCtx;
}
function playTone(freqs, durs, type = 'sine', vol = 0.2) {
  const ctx = getAudio();
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  let t = ctx.currentTime;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = type; osc.connect(gain);
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durs[i]);
    osc.start(t); osc.stop(t + durs[i]);
    t += durs[i];
  });
}
function soundCorrect()  { playTone([523,659,784,1047],[0.1,0.1,0.1,0.25],'sine',0.2); }
function soundWrong()    { playTone([300,220],[0.15,0.3],'sawtooth',0.15); }
function soundLevelUp()  { playTone([523,659,784,1047,1175,1568],[0.08,0.08,0.08,0.08,0.08,0.4],'sine',0.2); }
function soundTick()     { playTone([800],[0.05],'square',0.05); }
function soundGameOver() { playTone([392,349,330,262],[0.15,0.15,0.2,0.5],'sawtooth',0.15); }
function soundStart()    { playTone([392,523,659,784],[0.1,0.1,0.1,0.2],'sine',0.2); }

/* ================================================================
   PROBLEM GENERATION
   ================================================================ */
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/* ---- Dutch number formatting ---- */
function fmtNL(n) {
  // Format integer with dot as thousands separator (e.g. 3400 → "3.400")
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* ---- Groep 3 problem generation (original) ---- */
function generateProblemG3(level) {
  let num1, num2, answer, display;
  const add = Math.random() < 0.5;

  switch (level) {
    case 1: {
      answer = rand(1, 10); num1 = rand(0, answer); num2 = answer - num1;
      display = `${num1} + ${num2} = ?`; break;
    }
    case 2: {
      answer = rand(0, 9);
      if (add) { num1 = rand(0, answer); num2 = answer - num1; display = `${num1} + ${num2} = ?`; }
      else      { num2 = rand(0, answer); num1 = answer + num2; display = `${num1} − ${num2} = ?`; }
      break;
    }
    case 3: {
      answer = rand(1, 15); num1 = rand(0, answer); num2 = answer - num1;
      display = `${num1} + ${num2} = ?`; break;
    }
    case 4: {
      answer = rand(0, 15);
      if (add) { num1 = rand(0, answer); num2 = answer - num1; display = `${num1} + ${num2} = ?`; }
      else      { num2 = rand(0, answer); num1 = answer + num2; display = `${num1} − ${num2} = ?`; }
      break;
    }
    case 5: {
      answer = rand(1, 20); num1 = rand(0, answer); num2 = answer - num1;
      display = `${num1} + ${num2} = ?`; break;
    }
    case 6: {
      answer = rand(0, 20);
      if (add) { num1 = rand(0, answer); num2 = answer - num1; display = `${num1} + ${num2} = ?`; }
      else      { num2 = rand(0, answer); num1 = answer + num2; display = `${num1} − ${num2} = ?`; }
      break;
    }
    case 7: {
      const tbl = Math.random() < 0.5 ? 2 : 5;
      num1 = rand(1, 10); num2 = tbl; answer = num1 * num2;
      display = `${num1} × ${num2} = ?`; break;
    }
    default: {
      num1 = rand(1, 10); num2 = rand(1, 10); answer = num1 * num2;
      display = `${num1} × ${num2} = ?`; break;
    }
  }

  const wrong = genWrongG3(answer);
  const leftIsCorrect = Math.random() < 0.5;
  return {
    display,
    answerDisplay: String(answer),
    wrongDisplay:  String(wrong),
    leftIsCorrect,
  };
}

function genWrongG3(correct) {
  for (let i = 0; i < 20; i++) {
    const off = rand(1, 3), dir = Math.random() < 0.5 ? 1 : -1;
    const c = correct + dir * off;
    if (c > 0 && c !== correct) return c;
  }
  return correct > 1 ? correct - 1 : correct + 1;
}

/* ---- Groep 6 problem generation ---- */
function generateProblemG6(level) {
  let display, answerDisplay, wrongDisplay;

  switch (level) {
    case 1: { // Optellen tot 1.000, veelvouden van 10
      const a = rand(1, 9) * 100 + rand(0, 9) * 10;
      const b = rand(1, 9) * 100 + rand(0, 9) * 10;
      const ans = a + b;
      if (ans < 100 || ans > 1000) return generateProblemG6(level);
      display = `${fmtNL(a)} + ${fmtNL(b)} = ?`;
      answerDisplay = fmtNL(ans);
      wrongDisplay  = fmtNL(genWrongAddSub(ans));
      break;
    }
    case 2: { // Aftrekken tot 1.000
      const ans = rand(10, 89) * 10;
      const b   = rand(1, 8) * 100 + rand(0, 9) * 10;
      const a   = ans + b;
      if (a > 1000 || ans <= 0) return generateProblemG6(level);
      display = `${fmtNL(a)} − ${fmtNL(b)} = ?`;
      answerDisplay = fmtNL(ans);
      wrongDisplay  = fmtNL(genWrongAddSub(ans));
      break;
    }
    case 3: { // Optellen en aftrekken tot 10.000, veelvouden van 100
      const a   = rand(10, 90) * 100;
      const b   = rand(10, 90) * 100;
      const sub = Math.random() < 0.5;
      const ans = sub ? a - b : a + b;
      if (ans < 1000 || ans > 10000) return generateProblemG6(level);
      display = sub
        ? `${fmtNL(a)} − ${fmtNL(b)} = ?`
        : `${fmtNL(a)} + ${fmtNL(b)} = ?`;
      answerDisplay = fmtNL(ans);
      wrongDisplay  = fmtNL(genWrongAddSub(ans));
      break;
    }
    case 4: { // Tafels t/m 10
      const t  = rand(2, 10);
      const n  = rand(2, 10);
      const ans = t * n;
      display = `${t} × ${n} = ?`;
      answerDisplay = String(ans);
      wrongDisplay  = genWrongMul(t, n, ans);
      break;
    }
    case 5: { // Vermenigvuldigen met tiental/honderdtal
      const types = [
        () => { const n = rand(11,99); return { a:10, b:n, ans:10*n }; },
        () => { const n = rand(11,99); return { a:100, b:n, ans:100*n }; },
        () => { const f = rand(2,9)*10; const n = rand(11,99); return { a:f, b:n, ans:f*n }; },
        () => { const f = rand(2,9)*10; const g = rand(2,9)*10; return { a:f, b:g, ans:f*g }; },
        () => { const n = rand(2,9); const h = rand(2,9)*100; return { a:n, b:h, ans:n*h }; },
        () => { const n = rand(2,9)*100; const g = rand(2,9); return { a:n, b:g, ans:n*g }; },
      ];
      const {a, b, ans} = types[rand(0, types.length-1)]();
      display = `${fmtNL(a)} × ${fmtNL(b)} = ?`;
      answerDisplay = fmtNL(ans);
      wrongDisplay  = genWrongMulLarge(ans);
      break;
    }
    case 6: { // Handig rekenen
      const types = [
        () => { const n = rand(2,9); const m = rand(4,9)*10 - 1; return { a:n, b:m, ans:n*m }; },
        () => { const n = rand(2,9); const m = rand(2,9)*100 - 20 + rand(0,3)*20; return { a:n, b:m, ans:n*m }; },
        () => { const n = rand(2,9); const m = rand(3,9)*10 - 5; return { a:n, b:m, ans:n*m }; },
        () => { const n = 5; const m = rand(4,9)*10 - 2; return { a:n, b:m, ans:n*m }; },
      ];
      const {a, b, ans} = types[rand(0, types.length-1)]();
      display = `${fmtNL(a)} × ${fmtNL(b)} = ?`;
      answerDisplay = fmtNL(ans);
      wrongDisplay  = genWrongMulLarge(ans);
      break;
    }
    case 7: { // Delen zonder rest
      const delers = [2, 3, 4, 5, 6, 10, 12];
      const deler  = delers[rand(0, delers.length - 1)];
      const types  = [
        () => deler * rand(2, 9) * 10,
        () => deler * rand(2, 9) * 100,
        () => deler * rand(2, 20),
      ];
      const deeltal = types[rand(0, types.length - 1)]();
      const ans     = deeltal / deler;
      display = `${fmtNL(deeltal)} : ${deler} = ?`;
      answerDisplay = fmtNL(ans);
      wrongDisplay  = String(Math.max(1, ans + (Math.random() < 0.5 ? 1 : -1)));
      break;
    }
    default: { // Level 8: Delen met rest
      const delers = [3, 4, 6, 7, 8, 9];
      const deler  = delers[rand(0, delers.length - 1)];
      // Find deeltal that gives a rest 1..(deler-1)
      let deeltal, quotient, rest;
      for (let i = 0; i < 30; i++) {
        deeltal  = rand(10, 40) * deler + rand(1, deler - 1);
        quotient = Math.floor(deeltal / deler);
        rest     = deeltal % deler;
        if (rest > 0 && rest < deler && quotient > 1) break;
      }
      display = `${fmtNL(deeltal)} : ${deler} = ?`;
      answerDisplay = `${quotient} rest ${rest}`;
      // Wrong: impossible rest (>= deler) or off-by-one quotient
      const wrongRest = deler + rand(0, deler - 1); // rest >= deler → impossible
      wrongDisplay  = `${quotient} rest ${wrongRest}`;
      break;
    }
  }

  const leftIsCorrect = Math.random() < 0.5;
  return { display, answerDisplay, wrongDisplay, leftIsCorrect };
}

function genWrongAddSub(correct) {
  const magnitude = correct >= 1000 ? 100 : 10;
  for (let i = 0; i < 20; i++) {
    const off = rand(1, 5) * magnitude;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const c   = correct + dir * off;
    if (c > 0 && c !== correct) return c;
  }
  return correct + magnitude;
}

function genWrongMul(t, n, correct) {
  // One table step higher or lower
  const step = Math.random() < 0.5 ? t : n;
  const dir  = Math.random() < 0.5 ? 1 : -1;
  const c    = correct + dir * step;
  if (c > 0 && c !== correct) return String(c);
  return String(correct + step);
}

function genWrongMulLarge(correct) {
  const magnitude = correct >= 1000 ? 100 : correct >= 100 ? 10 : 5;
  for (let i = 0; i < 20; i++) {
    const off = rand(1, 3) * magnitude;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const c   = correct + dir * off;
    if (c > 0 && c !== correct) return fmtNL(c);
  }
  return fmtNL(correct + magnitude);
}

/* ---- Dispatcher ---- */
function generateProblem(level) {
  let prob;
  if (G.group === 6) {
    prob = generateProblemG6(level);
  } else {
    prob = generateProblemG3(level);
  }
  const { display, answerDisplay, wrongDisplay, leftIsCorrect } = prob;
  return {
    display,
    leftAnswer:  leftIsCorrect ? answerDisplay : wrongDisplay,
    rightAnswer: leftIsCorrect ? wrongDisplay  : answerDisplay,
    leftIsCorrect,
  };
}

/* ================================================================
   VEHICLE THEMES
   ================================================================ */
const VEHICLE_SVG = {
  auto: `
    <rect x="8" y="12" width="44" height="66" rx="12" fill="#E53935"/>
    <rect x="14" y="18" width="32" height="18" rx="6" fill="#90CAF9" opacity="0.9"/>
    <rect x="14" y="60" width="32" height="12" rx="4" fill="#90CAF9" opacity="0.7"/>
    <rect x="2" y="16" width="12" height="18" rx="5" fill="#222"/>
    <rect x="46" y="16" width="12" height="18" rx="5" fill="#222"/>
    <rect x="2" y="56" width="12" height="18" rx="5" fill="#222"/>
    <rect x="46" y="56" width="12" height="18" rx="5" fill="#222"/>
    <rect x="27" y="12" width="6" height="66" fill="#FFD700" opacity="0.6" rx="2"/>
    <circle cx="30" cy="42" r="5" fill="#FFD700" opacity="0.4"/>`,
  boot: `
    <path d="M30,4 L50,46 L50,80 Q50,87 30,88 Q10,87 10,80 L10,46 Z" fill="#0288D1"/>
    <rect x="15" y="26" width="30" height="46" rx="3" fill="#0277BD"/>
    <rect x="17" y="29" width="26" height="14" rx="4" fill="#E1F5FE" opacity="0.85"/>
    <rect x="20" y="50" width="20" height="14" rx="3" fill="#01579B"/>
    <circle cx="30" cy="57" r="4" fill="#004D40" stroke="#26C6DA" stroke-width="1.5"/>
    <circle cx="30" cy="57" r="1.5" fill="#80DEEA"/>
    <rect x="22" y="68" width="16" height="12" rx="3" fill="#006064"/>
    <rect x="27" y="4" width="6" height="84" fill="rgba(255,255,255,0.28)" rx="2"/>`,
  trein: `
    <rect x="8" y="6" width="44" height="76" rx="10" fill="#37474F"/>
    <rect x="13" y="10" width="34" height="18" rx="5" fill="#90A4AE" opacity="0.85"/>
    <rect x="9" y="34" width="10" height="22" rx="2" fill="#455A64"/>
    <rect x="41" y="34" width="10" height="22" rx="2" fill="#455A64"/>
    <rect x="22" y="6" width="16" height="76" fill="#B71C1C" opacity="0.45" rx="3"/>
    <circle cx="20" cy="16" r="5" fill="#FFF9C4" opacity="0.9"/>
    <circle cx="40" cy="16" r="5" fill="#FFF9C4" opacity="0.9"/>
    <rect x="20" y="32" width="20" height="10" rx="2" fill="#B0BEC5"/>
    <rect x="22" y="77" width="16" height="7" rx="2" fill="#78909C"/>
    <rect x="4" y="20" width="6" height="13" rx="2" fill="#263238"/>
    <rect x="50" y="20" width="6" height="13" rx="2" fill="#263238"/>
    <rect x="4" y="55" width="6" height="13" rx="2" fill="#263238"/>
    <rect x="50" y="55" width="6" height="13" rx="2" fill="#263238"/>`,
};

const VEHICLE_BG = { auto: '#4a9e4a', boot: '#1565C0', trein: '#558B2F' };

const DECO = {
  auto:  ['🌸','🌼','🌻','🌿','🍀','🌾'],
  boot:  ['🐟','🐠','🦀','⭐','🐚','🌊','🐬'],
  trein: ['🌲','🌳','🏠','⛰️','🌾','🏡','🌄'],
};

function selectGroup(g, saveLS = true) {
  G.group = g;
  if (saveLS) localStorage.setItem(LS_GROUP, g);
  document.querySelectorAll('.group-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('card-groep' + g);
  if (card) card.classList.add('selected');
}

function selectVehicle(v, saveLS = true) {
  G.vehicle = v;
  if (saveLS) localStorage.setItem(LS_VEHICLE, v);
  document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('card-' + v);
  if (card) card.classList.add('selected');
}

function applyTheme(vehicle) {
  const wrap = document.getElementById('game-wrap');
  wrap.dataset.vehicle = vehicle;
  const bg = VEHICLE_BG[vehicle] || VEHICLE_BG.auto;
  document.body.style.background = bg;
  wrap.style.background = bg;

  // Swap vehicle SVG
  const container = document.getElementById('car-container');
  const oldSvg = container.querySelector('svg');
  const newSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  newSvg.setAttribute('id', 'game-vehicle');
  newSvg.setAttribute('viewBox', '0 0 60 90');
  newSvg.setAttribute('width', '54');
  newSvg.setAttribute('height', '81');
  newSvg.innerHTML = VEHICLE_SVG[vehicle] || VEHICLE_SVG.auto;
  if (oldSvg) container.replaceChild(newSvg, oldSvg);
  else container.appendChild(newSvg);

  buildGrass();
}

/* ================================================================
   SCREEN MANAGEMENT
   ================================================================ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.add('active');
  if (el.classList.contains('scrollable')) el.scrollTop = 0;
  G.screen = id;
}

/* ================================================================
   LIVES DISPLAY
   ================================================================ */
function updateLivesDisplay() {
  const el = document.getElementById('lives-display');
  el.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const h = document.createElement('span');
    h.className = 'life-heart' + (i >= G.lives ? ' lost' : '');
    h.textContent = '❤️';
    el.appendChild(h);
  }
}

/* ================================================================
   TIMER
   ================================================================ */
function startTimer() {
  clearInterval(G.timerInterval);
  G.timeLeft = 10;
  G.questionStartTime = Date.now();
  updateTimerBar();
  G.timerInterval = setInterval(() => {
    G.timeLeft -= 0.25;
    if (G.timeLeft <= 3 && G.timeLeft > 0) soundTick();
    updateTimerBar();
    if (G.timeLeft <= 0) { clearInterval(G.timerInterval); handleTimeout(); }
  }, 250);
}

function stopTimer() { clearInterval(G.timerInterval); G.timerInterval = null; }

function updateTimerBar() {
  const bar = document.getElementById('timer-bar');
  bar.style.width = Math.max(0, (G.timeLeft / 10) * 100) + '%';
  bar.classList.toggle('warning', G.timeLeft <= 3);
}

function handleTimeout() {
  if (G.locked) return;
  G.locked = true;
  loseLife();
  showFeedback('wrong', 'Te laat! ⏰', 0);
  setTimeout(() => {
    hideSigns();
    resetCarPosition();
    setTimeout(() => {
      if (G.lives <= 0) triggerGameOver();
      else { G.locked = false; showNewQuestion(); }
    }, 500);
  }, 1200);
}

/* ================================================================
   QUESTION FLOW
   ================================================================ */
function updateHudGroupLevel() {
  const label = document.getElementById('hud-group-level-label');
  if (label) label.textContent = `Groep ${G.group} – Level`;
}

function showNewQuestion() {
  if (G.screen !== 'game-screen') return;
  G.problem = generateProblem(G.level);

  document.getElementById('problem-text').textContent = G.problem.display;
  document.getElementById('left-answer').innerHTML    = G.problem.leftAnswer;
  document.getElementById('right-answer').innerHTML   = G.problem.rightAnswer;

  // Reset sign colors
  ['sign-board-left', 'sign-board-right'].forEach(id => {
    const b = document.getElementById(id);
    b.classList.remove('correct', 'wrong');
    b.style.background = '';
  });

  document.getElementById('problem-panel').classList.add('visible');
  setTimeout(() => {
    document.getElementById('sign-left').classList.add('visible');
    document.getElementById('sign-right').classList.add('visible');
  }, 200);

  startTimer();
}

function hideSigns() {
  document.getElementById('sign-left').classList.remove('visible');
  document.getElementById('sign-right').classList.remove('visible');
  document.getElementById('problem-panel').classList.remove('visible');
  stopTimer();
}

/* ================================================================
   ANSWER HANDLING
   ================================================================ */
function handleAnswer(side) {
  if (G.locked || !G.problem || G.screen !== 'game-screen') return;
  G.locked = true;
  stopTimer();

  const isCorrect = side === 'left' ? G.problem.leftIsCorrect : !G.problem.leftIsCorrect;
  const elapsed   = (Date.now() - G.questionStartTime) / 1000;

  if (isCorrect) handleCorrect(side, elapsed);
  else           handleWrong(side);
}

function handleCorrect(side, elapsed) {
  soundCorrect();
  document.getElementById(side === 'left' ? 'sign-board-left' : 'sign-board-right').classList.add('correct');

  const car = document.getElementById('car-container');
  car.classList.add(side === 'left' ? 'answer-left' : 'answer-right');

  const base       = 10 * G.level;
  const speedBonus = Math.round(Math.max(0, (10 - elapsed) / 10) * base);
  const gained     = base + speedBonus;
  G.score += gained;
  G.correctCount++;

  document.getElementById('hud-score').textContent   = G.score;
  document.getElementById('progress-text').textContent = G.correctCount + '/10';
  showFeedback('correct', 'Goed zo! 🎉', gained);

  setTimeout(() => {
    hideSigns();
    resetCarPosition();
    setTimeout(() => {
      G.locked = false;
      if (G.correctCount >= 10) triggerLevelComplete();
      else showNewQuestion();
    }, 400);
  }, 1200);
}

function handleWrong(side) {
  soundWrong();
  document.getElementById(side === 'left' ? 'sign-board-left'  : 'sign-board-right').classList.add('wrong');
  document.getElementById(side === 'left' ? 'sign-board-right' : 'sign-board-left').classList.add('correct');

  const car = document.getElementById('car-container');
  car.classList.add('shake');
  setTimeout(() => car.classList.remove('shake'), 500);

  loseLife();
  showFeedback('wrong', 'Helaas! 😢', 0);

  setTimeout(() => {
    hideSigns();
    setTimeout(() => {
      if (G.lives <= 0) triggerGameOver();
      else { G.locked = false; showNewQuestion(); }
    }, 500);
  }, 1200);
}

function loseLife() { G.lives = Math.max(0, G.lives - 1); updateLivesDisplay(); }

function resetCarPosition() {
  const car = document.getElementById('car-container');
  car.classList.remove('answer-left', 'answer-right', 'shake');
}

/* ================================================================
   FEEDBACK
   ================================================================ */
function showFeedback(type, text, pts) {
  const fb = document.getElementById('feedback');
  const ft = document.getElementById('feedback-text');
  const sp = document.getElementById('score-pop');

  ft.className = 'feedback-text ' + type;
  ft.textContent = text;
  ft.style.animation = 'none'; void ft.offsetWidth; ft.style.animation = 'feedbackPop 0.4s cubic-bezier(0.34,1.56,0.64,1)';

  if (pts > 0) {
    sp.textContent = '+' + pts + ' punten!';
    sp.style.display = 'block';
    sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = 'floatUp 1s ease-out forwards';
  } else {
    sp.style.display = 'none';
  }

  fb.className = 'feedback show ' + type;
  setTimeout(() => fb.classList.remove('show'), 1000);
}

/* ================================================================
   GAME FLOW
   ================================================================ */
function startGame() {
  getAudio();
  G.level = 1; G.score = 0; G.lives = 3;
  G.correctCount = 0; G.locked = false; G.problem = null;

  applyTheme(G.vehicle);
  showScreen('game-screen');
  updateHudGroupLevel();
  document.getElementById('hud-level').textContent   = G.level;
  document.getElementById('hud-score').textContent   = G.score;
  document.getElementById('progress-text').textContent = '0/10';
  updateLivesDisplay();
  resetCarPosition();
  hideSigns();
  document.getElementById('feedback').className = 'feedback';

  soundStart();
  startCountdown(() => showNewQuestion());
}

function startCountdown(cb) {
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-num');
  overlay.style.display = 'flex';
  let count = 3;
  const tick = () => {
    numEl.textContent = count > 0 ? count : 'GO!';
    numEl.style.animation = 'none'; void numEl.offsetWidth;
    numEl.style.animation = 'countdownAnim 0.8s cubic-bezier(0.34,1.56,0.64,1)';
    if (count === 0) {
      soundStart();
      setTimeout(() => { overlay.style.display = 'none'; cb(); }, 700);
    } else {
      soundTick(); count--;
      setTimeout(tick, 900);
    }
  };
  tick();
}

function triggerLevelComplete() {
  stopTimer(); soundLevelUp(); hideSigns();
  document.getElementById('lc-title').textContent = G.level >= 8
    ? 'Alle Levels Gehaald! 🏆'
    : `Level ${G.level} Gehaald! 🎊`;
  document.getElementById('lc-score').textContent = `Score: ${G.score}`;
  document.getElementById('lc-next').textContent  = G.level >= 8
    ? 'Geweldig! Je hebt gewonnen!'
    : `Klaar voor level ${G.level + 1}?`;
  setTimeout(() => showScreen('level-complete-screen'), 300);
}

function nextLevel() {
  if (G.level >= 8) { endGame(); return; }
  G.level++; G.correctCount = 0; G.lives = 3; G.locked = false;
  showScreen('game-screen');
  updateHudGroupLevel();
  document.getElementById('hud-level').textContent   = G.level;
  document.getElementById('hud-score').textContent   = G.score;
  document.getElementById('progress-text').textContent = '0/10';
  updateLivesDisplay(); resetCarPosition(); hideSigns();
  document.getElementById('feedback').className = 'feedback';
  startCountdown(() => showNewQuestion());
}

async function triggerGameOver() {
  stopTimer(); soundGameOver();
  const goId = ++G.gameOverId;

  const isWin = G.level > 8 || (G.level === 8 && G.correctCount >= 10);
  const goTitle = document.getElementById('go-title');
  if (isWin) { goTitle.textContent = 'Gewonnen! 🏆'; goTitle.style.color = '#FFD700'; }
  else        { goTitle.textContent = 'Game Over!';   goTitle.style.color = '#ff5252'; }

  document.getElementById('go-score').textContent = `Eindscore: ${G.score}`;
  document.getElementById('go-level').textContent = `Groep ${G.group} – Level bereikt: ${G.level}`;
  document.getElementById('name-input-wrap').style.display = 'none';
  document.getElementById('go-scoreboard').innerHTML = '<div class="scoreboard-table"><div class="loading-scores">⏳ Scores laden...</div></div>';
  // Show tabs, activate correct one
  const goTabs = document.getElementById('go-score-tabs');
  if (goTabs) {
    goTabs.style.display = 'flex';
    ['groep3','groep6'].forEach(id => document.getElementById('go-tab-' + id)?.classList.remove('active'));
    document.getElementById('go-tab-groep' + G.group)?.classList.add('active');
  }

  setTimeout(() => showScreen('game-over-screen'), 400);

  // Load scores to check qualification
  const online = await loadOnlineScores(G.group);
  if (G.gameOverId !== goId) return;

  const scores = online || loadLocalScores(G.group);
  const isOffline = !online;
  const qualifies = G.score > 0 && (scores.length < 10 || G.score > (scores[scores.length - 1]?.score ?? 0));

  if (qualifies) {
    document.getElementById('name-input-wrap').style.display = 'block';
    document.getElementById('go-scoreboard').innerHTML = '';
    const btn = document.getElementById('save-btn');
    btn.disabled = false; btn.textContent = 'Opslaan';
    document.getElementById('player-name').value = '';
  } else {
    renderGoScoreboard(scores, -1, isOffline);
  }
}

function endGame() { triggerGameOver(); }

async function saveHighScore() {
  const naam = sanitizeName(document.getElementById('player-name').value);
  const btn  = document.getElementById('save-btn');

  if (!isValidScore(G.score, G.level)) {
    btn.textContent = 'Ongeldige score';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Opslaan'; }, 2000);
    return;
  }

  if (!checkRateLimit()) {
    btn.textContent = 'Even wachten...';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Opslaan'; }, 2000);
    return;
  }

  btn.disabled = true; btn.textContent = '⏳ Opslaan...';
  markRateLimit();

  const savedOnline = await saveOnlineScore(naam, G.score, G.level, G.vehicle, G.group);
  addLocalScore(naam, G.score, G.level, G.vehicle, G.group);

  let finalScores, isOffline;
  if (savedOnline) {
    const online = await loadOnlineScores(G.group);
    finalScores = online || loadLocalScores(G.group);
    isOffline   = !online;
  } else {
    finalScores = loadLocalScores(G.group);
    isOffline   = true;
  }

  // Find highlight index (first match by naam + score)
  let hlIdx = -1;
  finalScores.forEach((s, i) => {
    if (hlIdx === -1 && s.naam === naam && s.score === G.score) hlIdx = i;
  });

  document.getElementById('name-input-wrap').style.display = 'none';
  renderGoScoreboard(finalScores, hlIdx, isOffline);
}

/* ================================================================
   KEYBOARD CONTROLS
   ================================================================ */
document.addEventListener('keydown', e => {
  if (G.screen !== 'game-screen') return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); handleAnswer('left');  }
  if (e.key === 'ArrowRight') { e.preventDefault(); handleAnswer('right'); }
});
document.getElementById('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveHighScore();
});

/* ================================================================
   SCOREBOARD RENDERING
   ================================================================ */
function vehicleIcon(v) { return { auto:'🚗', boot:'🚤', trein:'🚂' }[v] || '🚗'; }

function buildScoreHTML(scores, hlIdx, isOffline) {
  let html = '';
  if (isOffline) html += '<div class="offline-badge">📱 Offline modus – lokale scores</div>';
  html += `<div class="scoreboard-header"><span>#</span><span>Naam</span><span>Score</span><span>Lvl</span></div>`;
  if (!scores || scores.length === 0) {
    html += '<div class="empty-scoreboard">Nog geen scores. Speel het spel!</div>';
    return html;
  }
  const medals = ['🥇','🥈','🥉'];
  scores.forEach((s, i) => {
    const rank = medals[i] || (i + 1);
    const icon = vehicleIcon(s.voertuig);
    const hl   = i === hlIdx ? ' highlight' : '';
    html += `<div class="scoreboard-row${hl}">
      <span class="rank rank-${i+1}">${rank}</span>
      <span>${icon} ${escHtml(s.naam)}</span>
      <span class="score-col">${s.score}</span>
      <span class="level-col">${s.level}</span>
    </div>`;
  });
  return html;
}

function renderGoScoreboard(scores, hlIdx, isOffline) {
  document.getElementById('go-scoreboard').innerHTML =
    `<div class="scoreboard-table" style="margin-bottom:0">${buildScoreHTML(scores, hlIdx, isOffline)}</div>`;
}

// Active tab for the standalone scoreboard screen
let _scoreTab = 3;

async function showScoreboardScreen() {
  showScreen('scoreboard-screen');
  _scoreTab = G.group;
  ['groep3','groep6'].forEach(id => document.getElementById('tab-' + id)?.classList.remove('active'));
  document.getElementById('tab-groep' + _scoreTab)?.classList.add('active');
  await _loadScoreTab(_scoreTab);
}

async function switchScoreTab(g) {
  _scoreTab = g;
  ['groep3','groep6'].forEach(id => document.getElementById('tab-' + id)?.classList.remove('active'));
  document.getElementById('tab-groep' + g)?.classList.add('active');
  await _loadScoreTab(g);
}

async function _loadScoreTab(g) {
  const el = document.getElementById('scoreboard-table');
  el.innerHTML = '<div class="loading-scores">⏳ Scores laden...</div>';
  const online = await loadOnlineScores(g);
  const scores = online || loadLocalScores(g);
  el.innerHTML = buildScoreHTML(scores, -1, !online);
}

// Active tab for go-scoreboard
let _goScoreTab = 3;

async function switchGoTab(g) {
  _goScoreTab = g;
  ['groep3','groep6'].forEach(id => document.getElementById('go-tab-' + id)?.classList.remove('active'));
  document.getElementById('go-tab-groep' + g)?.classList.add('active');
  const online = await loadOnlineScores(g);
  const scores = online || loadLocalScores(g);
  renderGoScoreboard(scores, -1, !online);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ================================================================
   GRASS / WATER / LANDSCAPE DECORATION
   ================================================================ */
function buildGrass() {
  const items = DECO[G.vehicle] || DECO.auto;
  ['grass-left','grass-right'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('span');
      d.className = 'grass-deco';
      d.textContent = items[Math.floor(Math.random() * items.length)];
      d.style.left   = Math.random() * 78 + '%';
      d.style.top    = Math.random() * 88 + '%';
      d.style.fontSize = (0.65 + Math.random() * 0.5) + 'rem';
      d.style.animationDelay    = (Math.random() * 2) + 's';
      d.style.animationDuration = (2 + Math.random() * 2) + 's';
      el.appendChild(d);
    }
  });
}

/* ================================================================
   INIT
   ================================================================ */
// Restore saved vehicle and group
(function () {
  const savedGroup   = parseInt(localStorage.getItem(LS_GROUP), 10) || 3;
  selectGroup(savedGroup, false);

  const savedVehicle = localStorage.getItem(LS_VEHICLE) || 'auto';
  selectVehicle(savedVehicle, false);

  // Apply theme bg on start screen too
  const bg = VEHICLE_BG[savedVehicle] || VEHICLE_BG.auto;
  document.body.style.background = bg;
  document.getElementById('game-wrap').style.background = bg;
  buildGrass();
})();
