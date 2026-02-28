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
  gameOverId:        0,        // incremented to cancel stale async renders
};

/* ================================================================
   JSONBIN.IO  — online scores lezen en schrijven
   ================================================================ */
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

function jsonbinHeaders() {
  return { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY };
}

async function loadOnlineScores() {
  if (!JSONBIN_ID || !JSONBIN_KEY) return null;
  try {
    const res = await fetch(`${JSONBIN_BASE}/${JSONBIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return Array.isArray(json.record?.scores) ? json.record.scores : [];
  } catch (e) {
    console.warn('JSONBin laden mislukt:', e);
    return null;
  }
}

async function saveOnlineScore(naam, score, level, voertuig) {
  if (!JSONBIN_ID || !JSONBIN_KEY) return false;
  try {
    // Lees huidige top 10 op
    const current = (await loadOnlineScores()) || [];
    // Voeg nieuwe score toe, sorteer, knip af op 10
    current.push({ naam, score, level, voertuig });
    current.sort((a, b) => b.score - a.score);
    current.splice(10);
    // Schrijf terug naar JSONBin
    const res = await fetch(`${JSONBIN_BASE}/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: jsonbinHeaders(),
      body: JSON.stringify({ scores: current }),
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
const LS_SCORES  = 'rekenrace_scores_v2';
const LS_VEHICLE = 'rekenrace_vehicle_v1';

function loadLocalScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SCORES)) || [];
    return raw.map(s => ({
      naam:     s.naam     || s.name    || 'Speler',
      score:    s.score    || 0,
      level:    s.level    || 1,
      voertuig: s.voertuig || s.vehicle || 'auto',
    }));
  } catch { return []; }
}

function addLocalScore(naam, score, level, voertuig) {
  const scores = loadLocalScores();
  scores.push({ naam, score, level, voertuig });
  scores.sort((a, b) => b.score - a.score);
  scores.splice(10);
  localStorage.setItem(LS_SCORES, JSON.stringify(scores));
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

function generateProblem(level) {
  let num1, num2, answer, display;
  const add = Math.random() < 0.5;

  switch (level) {
    case 1: { // addition, result 1–10
      answer = rand(1, 10); num1 = rand(0, answer); num2 = answer - num1;
      display = `${num1} + ${num2} = ?`; break;
    }
    case 2: { // addition + subtraction, result 0–9
      answer = rand(0, 9);
      if (add) { num1 = rand(0, answer); num2 = answer - num1; display = `${num1} + ${num2} = ?`; }
      else      { num2 = rand(0, answer); num1 = answer + num2; display = `${num1} − ${num2} = ?`; }
      break;
    }
    case 3: { // addition, result 1–15
      answer = rand(1, 15); num1 = rand(0, answer); num2 = answer - num1;
      display = `${num1} + ${num2} = ?`; break;
    }
    case 4: { // addition + subtraction, result 0–15
      answer = rand(0, 15);
      if (add) { num1 = rand(0, answer); num2 = answer - num1; display = `${num1} + ${num2} = ?`; }
      else      { num2 = rand(0, answer); num1 = answer + num2; display = `${num1} − ${num2} = ?`; }
      break;
    }
    case 5: { // addition, result 1–20
      answer = rand(1, 20); num1 = rand(0, answer); num2 = answer - num1;
      display = `${num1} + ${num2} = ?`; break;
    }
    case 6: { // addition + subtraction, result 0–20
      answer = rand(0, 20);
      if (add) { num1 = rand(0, answer); num2 = answer - num1; display = `${num1} + ${num2} = ?`; }
      else      { num2 = rand(0, answer); num1 = answer + num2; display = `${num1} − ${num2} = ?`; }
      break;
    }
    case 7: { // times tables 2 and 5
      const tbl = Math.random() < 0.5 ? 2 : 5;
      num1 = rand(1, 10); num2 = tbl; answer = num1 * num2;
      display = `${num1} × ${num2} = ?`; break;
    }
    default: { // level 8: all tables 1–10
      num1 = rand(1, 10); num2 = rand(1, 10); answer = num1 * num2;
      display = `${num1} × ${num2} = ?`; break;
    }
  }

  const wrong = genWrong(answer);
  const leftIsCorrect = Math.random() < 0.5;
  return {
    display, answer, wrong,
    leftAnswer:     leftIsCorrect ? answer : wrong,
    rightAnswer:    leftIsCorrect ? wrong  : answer,
    leftIsCorrect,
  };
}

function genWrong(correct) {
  for (let i = 0; i < 20; i++) {
    const off = rand(1, 3), dir = Math.random() < 0.5 ? 1 : -1;
    const c = correct + dir * off;
    if (c > 0 && c !== correct) return c;
  }
  return correct > 1 ? correct - 1 : correct + 1;
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
function showNewQuestion() {
  if (G.screen !== 'game-screen') return;
  G.problem = generateProblem(G.level);

  document.getElementById('problem-text').textContent = G.problem.display;
  document.getElementById('left-answer').textContent  = G.problem.leftAnswer;
  document.getElementById('right-answer').textContent = G.problem.rightAnswer;

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
  document.getElementById('go-level').textContent = `Level bereikt: ${G.level}`;
  document.getElementById('name-input-wrap').style.display = 'none';
  document.getElementById('go-scoreboard').innerHTML = '<div class="scoreboard-table"><div class="loading-scores">⏳ Scores laden...</div></div>';

  setTimeout(() => showScreen('game-over-screen'), 400);

  // Load scores to check qualification
  const online = await loadOnlineScores();
  if (G.gameOverId !== goId) return;

  const scores = online || loadLocalScores();
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
  const naam = (document.getElementById('player-name').value.trim() || 'Speler').slice(0, 14);
  const btn  = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = '⏳ Opslaan...';

  const savedOnline = await saveOnlineScore(naam, G.score, G.level, G.vehicle);
  addLocalScore(naam, G.score, G.level, G.vehicle);

  let finalScores, isOffline;
  if (savedOnline) {
    const online = await loadOnlineScores();
    finalScores = online || loadLocalScores();
    isOffline   = !online;
  } else {
    finalScores = loadLocalScores();
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

async function showScoreboardScreen() {
  showScreen('scoreboard-screen');
  const el = document.getElementById('scoreboard-table');
  el.innerHTML = '<div class="loading-scores">⏳ Scores laden...</div>';
  const online  = await loadOnlineScores();
  const scores  = online || loadLocalScores();
  el.innerHTML  = buildScoreHTML(scores, -1, !online);
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
// Restore saved vehicle
(function () {
  const saved = localStorage.getItem(LS_VEHICLE) || 'auto';
  selectVehicle(saved, false);
  // Apply theme bg on start screen too
  const bg = VEHICLE_BG[saved] || VEHICLE_BG.auto;
  document.body.style.background = bg;
  document.getElementById('game-wrap').style.background = bg;
  buildGrass();
})();
