const socket = io();

// ============================================================
// AVATAR SYSTEM — each player gets a character
// ============================================================
const AVATARS = [
  { name: 'תחת', img: '/assets/img/characters/char-0.png' },
  { name: 'ענן גז', img: '/assets/img/characters/char-1.png' },
  { name: 'נייר טואלט', img: '/assets/img/characters/char-2.png' },
  { name: 'קקי', img: '/assets/img/characters/char-3.png' },
  { name: 'אסלה', img: '/assets/img/characters/char-4.png' },
  { name: 'פלאנג׳ר', img: '/assets/img/characters/char-5.png' },
  { name: 'ספריי', img: '/assets/img/characters/char-6.png' },
  { name: 'נקניקיה', img: '/assets/img/characters/char-7.png' },
];
const SPECTATOR_AVATAR = { name: 'צופה', img: '/assets/img/characters/spectator.png' };

let playerAvatarMap = new Map();

function getPlayerAvatarIndex(playerId) {
  if (playerAvatarMap.has(playerId)) return playerAvatarMap.get(playerId);
  const usedIndices = new Set(playerAvatarMap.values());
  for (let i = 0; i < 8; i++) {
    if (!usedIndices.has(i)) {
      playerAvatarMap.set(playerId, i);
      return i;
    }
  }
  const idx = playerAvatarMap.size % 8;
  playerAvatarMap.set(playerId, idx);
  return idx;
}

// Rebuild avatar map from current player list to prevent stale/duplicate assignments
function rebuildAvatarMap(players) {
  playerAvatarMap = new Map();
  players.forEach((p, i) => {
    playerAvatarMap.set(p.id, i % 8);
  });
}

// ============================================================
// SOUND SYSTEM — all music, narration, SFX
// ============================================================
const MUSIC = {
  lobby: new Audio('/assets/Quiflotz-music-main.mp3'),
  round1: new Audio('/assets/Quiflotz-round-1.mp3'),
  round2: new Audio('/assets/Quiflotz-round-2.mp3'),
  round3: new Audio('/assets/Quiflotz-round-3.mp3'),
  scores: new Audio('/assets/Quiflotz-scores.mp3'),
  credits: new Audio('/assets/Quiflotz-End-Round-Credits.mp3'),
};
Object.values(MUSIC).forEach(a => { a.loop = true; a.volume = 0.3; a.preload = 'auto'; });

const NARRATOR = {
  letsStart: [new Audio('/assets/Narrator-Let-s-Start-1.mp3'), new Audio('/assets/Narrator-Let-s-Start-2.mp3')],
  round1: [new Audio('/assets/Narrator-Round-1-intro.mp3'), new Audio('/assets/Narrator-Round-1-intro-2.mp3')],
  round2: [new Audio('/assets/Narrator-Round-2-intro.mp3'), new Audio('/assets/Narrator-Round-2-intro-2.mp3')],
  round3: [new Audio('/assets/Narrator-Round-3-intro.mp3'), new Audio('/assets/Narrator-Round-3-intro-2.mp3')],
  round4: [new Audio('/assets/Narrator-Round-4.mp3')],
  noShow: [new Audio('/assets/Narrator-No-Show.mp3')],
  pointsTable1: [new Audio('/assets/Narrator-Points-Table-1.mp3')],
  pointsTable2: [new Audio('/assets/Narrator-Points-Table-2.mp3')],
  pointsTable3: [new Audio('/assets/Narrator-Points-Table-3.mp3')],
  quiflotz: [new Audio('/assets/Narrator-Quiflotz-Announcment.mp3')],
  winner: [new Audio('/assets/Narrator-Winner.mp3')],
  allVoted: [new Audio('/assets/Narrator-All-Voted.mp3')],
};
const SFX = {
  drumRolls: new Audio('/assets/SFX-drum-rolls.mp3'),
  winnerSound: new Audio('/assets/SFX-winner-sound.mp3'),
  countdown10: new Audio('/assets/Narrator-10-seconds.mp3'),
  countdown5: new Audio('/assets/Narrator-5-seconds.mp3'),
  timeIsUp: new Audio('/assets/Narrator-time-is-up.mp3'),
  scoreCount: new Audio('/assets/SFX-score-count.mp3'),
  swooshIn: new Audio('/assets/SFX-swoosh-in.mp3'),
  swooshOut: new Audio('/assets/SFX-swoosh-out.mp3'),
  pop: new Audio('/assets/SFX-pop.mp3'),
  percentage: new Audio('/assets/SFX-percentage.mp3'),
  charConnect: [
    new Audio('/assets/SFX-char-connect-0.mp3'),
    new Audio('/assets/SFX-char-connect-1.mp3'),
    new Audio('/assets/SFX-char-connect-2.mp3'),
    new Audio('/assets/SFX-char-connect-3.mp3'),
    new Audio('/assets/SFX-char-connect-4.mp3'),
    new Audio('/assets/SFX-char-connect-5.mp3'),
    new Audio('/assets/SFX-char-connect-6.mp3'),
    new Audio('/assets/SFX-char-connect-7.mp3'),
  ],
};

const ALL_AUDIO = [
  ...Object.values(MUSIC),
  ...Object.values(NARRATOR).flat(),
  ...Object.values(SFX).flat()
];
ALL_AUDIO.forEach(a => { a.preload = 'auto'; if (!a.volume) a.volume = 0.3; });

let currentMusic = null;
let currentNarrator = null;
let isMuted = false;
let audioUnlocked = false;
let currentSubRound = 1;
let userVolume = 0.3; // Track user's chosen volume level
let narratorResolve = null; // To prevent double-resolve

function playMusic(track) {
  if (currentMusic === track && !currentMusic.paused) return;
  stopMusic(); // Always fully stop previous music first
  currentMusic = track;
  track.volume = userVolume;
  if (!isMuted && audioUnlocked) {
    track.play().catch(() => setTimeout(() => track.play().catch(() => {}), 200));
  }
}

function stopMusic() {
  if (currentMusic) {
    currentMusic.pause();
    currentMusic.currentTime = 0;
    currentMusic = null;
  }
}

// Duck music volume during narration, restore after
function duckMusic() {
  if (currentMusic) currentMusic.volume = userVolume * 0.2;
}
function unduckMusic() {
  if (currentMusic) currentMusic.volume = userVolume;
}

/**
 * Play narrator audio. Stops any previous narrator.
 * If music is playing, ducks it for the duration then restores.
 * If no music is playing (splash screens), plays narration alone.
 */
function playNarrator(variants) {
  // Stop previous narrator
  if (currentNarrator) { currentNarrator.pause(); currentNarrator.currentTime = 0; }
  if (narratorResolve) { narratorResolve(); narratorResolve = null; }

  const pick = variants[Math.floor(Math.random() * variants.length)];
  currentNarrator = pick;
  pick.currentTime = 0;
  pick.volume = userVolume;

  // Duck music if playing
  if (currentMusic && !currentMusic.paused) duckMusic();

  if (!isMuted && audioUnlocked) pick.play().catch(() => {});

  return new Promise(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      narratorResolve = null;
      currentNarrator = null;
      unduckMusic(); // Restore music volume
      resolve();
    };
    narratorResolve = done;
    pick.onended = done;
    setTimeout(done, 15000); // Fallback
  });
}

function playSFX(audio) {
  audio.currentTime = 0;
  audio.volume = userVolume;
  if (!isMuted && audioUnlocked) audio.play().catch(() => {});
  return new Promise(resolve => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    audio.onended = done;
    setTimeout(done, 15000);
  });
}

function playSwooshIn() {
  SFX.swooshIn.currentTime = 0;
  SFX.swooshIn.volume = userVolume * 0.25;
  if (!isMuted && audioUnlocked) SFX.swooshIn.play().catch(() => {});
}

function playSwooshOut() {
  SFX.swooshOut.currentTime = 0;
  SFX.swooshOut.volume = userVolume * 0.25;
  if (!isMuted && audioUnlocked) SFX.swooshOut.play().catch(() => {});
}

function playPopSFX() {
  SFX.pop.currentTime = 0;
  SFX.pop.volume = userVolume * 0.45;
  if (!isMuted && audioUnlocked) SFX.pop.play().catch(() => {});
}

/**
 * Play prompt narration audio. Returns a promise that resolves when done.
 */
function playPromptAudio(audioPath) {
  if (!audioPath) return Promise.resolve();
  const audio = new Audio(audioPath);
  audio.volume = userVolume;
  // Duck music during prompt narration
  if (currentMusic && !currentMusic.paused) duckMusic();
  if (!isMuted && audioUnlocked) audio.play().catch(() => {});
  return new Promise(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      unduckMusic();
      resolve();
    };
    audio.onended = done;
    setTimeout(done, 15000); // fallback
  });
}

function getRoundMusic() {
  if (currentSubRound === 1) return MUSIC.round1;
  if (currentSubRound === 2) return MUSIC.round2;
  return MUSIC.round3;
}

function toggleMute() {
  isMuted = !isMuted;
  ALL_AUDIO.forEach(a => { a.muted = isMuted; });
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = isMuted ? '🔇' : '🔊';
}

function setVolume(val) {
  userVolume = parseFloat(val);
  // Apply to currently playing audio
  if (currentMusic) currentMusic.volume = userVolume;
  if (currentNarrator) currentNarrator.volume = userVolume;
}

window.toggleMute = toggleMute;
window.setVolume = setVolume;

function dismissSplash() {
  audioUnlocked = true;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
  } catch(e) {}
  showScreen('lobby');
  playMusic(MUSIC.lobby);
}
window.dismissSplash = dismissSplash;

// ============================================================
// CREDITS TEXT
// ============================================================
const CREDITS_HTML = `
<div class="credit-spacer"></div>
<div class="credit-role">מפיק בפועל</div>
<div class="credit-name">מיכה רפש</div>
<div class="credit-role">במאי המשחק</div>
<div class="credit-name">מיץ' זבלובסקי</div>
<div class="credit-role">מנהל פרויקט בכיר</div>
<div class="credit-name">עמית עורלה</div>
<div class="credit-role">יועץ קריאייטיב</div>
<div class="credit-name">דביר אבו-סמוחטה</div>
<div class="credit-section">💻 מחלקת תכנות והנדסה</div>
<div class="credit-role">ארכיטקט מנוע ראשי</div>
<div class="credit-name">מוטי שפיך</div>
<div class="credit-role">מתכנת פיזיקה</div>
<div class="credit-name">אסף לוץ</div>
<div class="credit-role">מהנדסת מערכות רשת</div>
<div class="credit-name">נרי פליצה</div>
<div class="credit-role">מפתח צד-שרת</div>
<div class="credit-name">אמנון קקי-נוזלי</div>
<div class="credit-section">🎨 אמנות ואנימציה</div>
<div class="credit-role">מנהל אמנותי</div>
<div class="credit-name">אלכסנדר וזלין</div>
<div class="credit-role">מודליסט דמויות</div>
<div class="credit-name">גיל ג'יפה</div>
<div class="credit-role">אמן טקסטורות</div>
<div class="credit-name">אדי רקטומלוביץ'</div>
<div class="credit-role">אמן טכני</div>
<div class="credit-name">מני בובז</div>
<div class="credit-section">🔊 עיצוב פסקול ושמע</div>
<div class="credit-role">מפקח סאונד</div>
<div class="credit-name">אבי שילשולוב</div>
<div class="credit-role">אמן אפקטים קוליים</div>
<div class="credit-name">תמי מחזורסקי</div>
<div class="credit-role">מלחין פסקול</div>
<div class="credit-name">שמחה ריר-סמיך</div>
<div class="credit-section">🧪 בקרת איכות (QA)</div>
<div class="credit-role">ראש צוות בדיקות</div>
<div class="credit-name">צחי בן כלב</div>
<div class="credit-role">בודק בטא בכיר</div>
<div class="credit-name">אדולף כהן</div>
<div class="credit-role">בודק פונקציונליות</div>
<div class="credit-name">אלי סע</div>
<div class="credit-section">🖋️ עלילה ותרגום</div>
<div class="credit-role">מעצב נרטיב ראשי</div>
<div class="credit-name">דודי תחת</div>
<div class="credit-role">מנהל לוקאליזציה</div>
<div class="credit-name">יניב גייזמן</div>
<div class="credit-spacer"></div>
<div class="credit-footer">קוויפלוץ נוצר על ידי יהודים.</div>
<div class="credit-footer">אולי יש לנו כסף ואולי לא.</div>
<div class="credit-footer">בסדר.</div>
<div class="credit-spacer"></div>
<div class="credit-spacer"></div>
`;

// ============================================================
// CIRCULAR TIMER
// ============================================================
let activeTimerInterval = null;
let countdownTriggered10 = false;
let countdownTriggered5 = false;

function startCircleTimer(containerId, seconds, isWritePhase) {
  clearInterval(activeTimerInterval);
  countdownTriggered10 = false;
  countdownTriggered5 = false;
  const el = document.getElementById(containerId);
  if (!el) return;
  let remaining = seconds;
  el.innerHTML = renderCircle(remaining, seconds, isWritePhase);
  activeTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(activeTimerInterval); remaining = 0; }
    el.innerHTML = renderCircle(remaining, seconds, isWritePhase);

    // Writing phase only: narrator countdown at 10s and 5s
    if (isWritePhase) {
      if (remaining === 10 && !countdownTriggered10) {
        countdownTriggered10 = true;
        playSFX(SFX.countdown10);
      }
      if (remaining === 5 && !countdownTriggered5) {
        countdownTriggered5 = true;
        playSFX(SFX.countdown5);
      }
    }
  }, 1000);
}

function renderCircle(remaining, total, isWritePhase) {
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const deg = (pct / 100) * 360;
  // Writing phase: red from 10s and below. Other timers: original colors
  let color;
  if (isWritePhase && remaining <= 10) {
    color = '#FF1744';
  } else {
    color = remaining <= 5 ? '#FF1493' : remaining <= 15 ? '#FFD700' : '#39FF14';
  }
  return `<div class="circle-timer" style="background: conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.1) ${deg}deg)">
    <div class="circle-timer-inner">${remaining}</div>
  </div>`;
}

// ============================================================
// SCREEN MANAGEMENT
// ============================================================
const screens = {};
document.querySelectorAll('.screen').forEach(s => { screens[s.id.replace('screen-', '')] = s; });

let lastScreen = '';
function showScreen(name) {
  const prev = lastScreen;
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
  const bar = document.getElementById('persistent-bar');
  if (bar) bar.style.display = (name === 'splash' || name === 'lobby') ? 'none' : 'flex';
  // Clear avatar floor when leaving writing screen
  if (name !== 'writing') {
    const floor = document.getElementById('avatar-floor');
    if (floor) floor.innerHTML = '';
  }
  // Swoosh on significant screen transitions (not splash-to-splash)
  const swooshScreens = ['matchup', 'matchup-result', 'prompt-reveal', 'scoreboard', 'round-complete', 'final-result', 'final-voting', 'winner'];
  if (prev !== name && swooshScreens.includes(name) && prev !== '' && prev !== 'splash') {
    playSwooshIn();
  }
  lastScreen = name;
}

// ============================================================
// ROOM CREATION
// ============================================================
let currentRoomCode = sessionStorage.getItem('q_host_room') || '';

// Try to rejoin existing room first, or create new
if (currentRoomCode) {
  socket.emit('rejoin-host', { roomCode: currentRoomCode }, (res) => {
    if (res.success) {
      currentRoomCode = res.roomCode;
      document.getElementById('room-code').textContent = res.roomCode;
      document.getElementById('persistent-room-code').textContent = res.roomCode;
      const url = window.location.origin.replace(/^https?:\/\//, '');
      document.getElementById('join-url').textContent = url;
      console.log('Host reconnected to room', res.roomCode);
      // Restore lobby state
      if (res.players) updateLobby(res.players, res.spectatorCount || 0);
      // If game was in progress, show lobby (host can see current state)
      if (res.gameState === 'playing') {
        audioUnlocked = true;
        showScreen('lobby');
      }
    } else {
      // Room gone, create new
      sessionStorage.removeItem('q_host_room');
      createNewRoom();
    }
  });
} else {
  createNewRoom();
}

function createNewRoom() {
  socket.emit('create-room', (res) => {
    if (res.success) {
      currentRoomCode = res.roomCode;
      sessionStorage.setItem('q_host_room', res.roomCode);
      document.getElementById('room-code').textContent = res.roomCode;
      document.getElementById('persistent-room-code').textContent = res.roomCode;
      const url = window.location.origin.replace(/^https?:\/\//, '');
      document.getElementById('join-url').textContent = url;
    }
  });
}

document.getElementById('btn-persistent-restart').addEventListener('click', () => {
  if (confirm('להתחיל משחק חדש?')) socket.emit('restart-game');
});

// ============================================================
// LOBBY
// ============================================================
let previousPlayerIds = new Set();

socket.on('player-joined', ({ players, spectatorCount, spectators }) => {
  // Detect new player and play their character connection sound
  players.forEach(p => {
    if (!previousPlayerIds.has(p.id)) {
      const avatarIdx = getPlayerAvatarIndex(p.id);
      const connectSound = SFX.charConnect[avatarIdx];
      if (connectSound && audioUnlocked && !isMuted) {
        connectSound.currentTime = 0;
        connectSound.volume = userVolume * 0.6;
        connectSound.play().catch(() => {});
      }
    }
  });
  updateLobby(players, spectatorCount, spectators);
});
socket.on('player-left', ({ players, spectatorCount, spectators }) => updateLobby(players, spectatorCount, spectators));

function updateLobby(players, spectatorCount, spectators) {
  document.getElementById('player-count').textContent = players.length;
  previousPlayerIds = new Set(players.map(p => p.id));
  rebuildAvatarMap(players);
  const slots = document.querySelectorAll('.circle-slot');
  slots.forEach((slot, i) => {
    const charEl = slot.querySelector('.circle-character');
    const labelEl = slot.querySelector('.circle-label');
    const nameEl = slot.querySelector('.circle-name');
    const player = players[i];
    if (player) {
      const avatar = AVATARS[getPlayerAvatarIndex(player.id)];
      const wasEmpty = !charEl.querySelector('img');
      charEl.innerHTML = `<img src="${avatar.img}" alt="${avatar.name}" class="avatar-img">`;
      charEl.style.display = 'block';
      labelEl.style.display = 'none';
      nameEl.textContent = player.name;
      slot.classList.add('occupied');
      slot.classList.toggle('disconnected', !player.connected);
      // GSAP: pop in new character
      if (wasEmpty) {
        gsap.fromTo(slot, { scale: 0, rotation: -15 },
          { scale: 1, rotation: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
      }
    } else {
      charEl.textContent = ''; charEl.style.display = 'none';
      labelEl.style.display = 'block'; nameEl.textContent = '';
      slot.classList.remove('occupied', 'disconnected');
    }
  });
  document.getElementById('btn-start').disabled = players.length < 3;
  const info = document.getElementById('spectator-info');
  if (spectatorCount > 0) { info.style.display = 'block'; document.getElementById('spectator-count').textContent = spectatorCount; }
  else info.style.display = 'none';

  // Show spectators above the circle
  const bar = document.getElementById('spectator-bar');
  const barList = document.getElementById('spectator-bar-list');
  if (bar && barList && spectators && spectators.length > 0) {
    bar.classList.remove('hidden');
    barList.innerHTML = spectators.map(s => `
      <div class="spectator-bar-item">
        <img src="${SPECTATOR_AVATAR.img}" class="spectator-bar-avatar">
        <div class="spectator-bar-name">${esc(s.name)}</div>
      </div>
    `).join('');
  } else if (bar) {
    bar.classList.add('hidden');
  }
}

document.getElementById('btn-start').addEventListener('click', () => socket.emit('start-game'));

// ============================================================
// WRITING PHASE
// ============================================================
let currentWriteTime = 90;
let writingPlayers = [];

socket.on('sub-round-start', ({ subRound, multiplier, matchupCount, writeTime, players }) => {
  currentWriteTime = writeTime;
  currentSubRound = subRound;
  writingPlayers = players || [];
  showScreen('writing');
  document.getElementById('write-sub').textContent = subRound <= 3 ? subRound : 'המחץ';
  document.getElementById('write-multiplier').textContent = `x${multiplier}`;
  document.getElementById('answer-progress').textContent = `0/${matchupCount * 2}`;
  document.getElementById('writing-status-text').textContent = 'השחקנים כותבים תשובות...';
  document.getElementById('writing-prompt-area').style.display = 'none';
  playMusic(getRoundMusic()); // Start round music at writing phase
  startCircleTimer('write-timer', writeTime, true);
  buildAvatarFloor(writingPlayers);
});

socket.on('final-round-start', ({ prompt, writeTime, players }) => {
  currentWriteTime = writeTime;
  currentSubRound = 3;
  writingPlayers = players || [];
  showScreen('writing');
  document.getElementById('write-sub').textContent = '3';
  document.getElementById('write-multiplier').textContent = 'x3';
  document.getElementById('answer-progress').textContent = `0/${(players || []).length}`;
  document.getElementById('writing-status-text').textContent = '';
  document.getElementById('answer-progress').parentElement.style.display = 'none';
  const promptArea = document.getElementById('writing-prompt-area');
  promptArea.style.display = 'block';
  promptArea.classList.remove('as-title');
  document.getElementById('writing-prompt-text').textContent = prompt.text;
  playMusic(MUSIC.round3);
  startCircleTimer('write-timer', writeTime, true);
  buildAvatarFloor(writingPlayers);
  // After 3s (prompt read), move prompt up to title position so characters don't cover it
  setTimeout(() => {
    promptArea.classList.add('as-title');
  }, 3000);
});

function buildAvatarFloor(players) {
  const floor = document.getElementById('avatar-floor');
  floor.innerHTML = '';
  players.forEach(p => {
    const avatar = AVATARS[getPlayerAvatarIndex(p.id)];
    const el = document.createElement('div');
    el.className = 'floor-avatar breathing-slow';
    el.id = `floor-avatar-${p.id}`;
    el.innerHTML = `
      <div class="floor-avatar-character"><img src="${avatar.img}" alt="${avatar.name}" class="avatar-img"></div>
      <div class="floor-avatar-name">${esc(p.name)}</div>
    `;
    floor.appendChild(el);
  });
}

socket.on('player-finished-writing', ({ playerId, timeRemaining }) => {
  const el = document.getElementById(`floor-avatar-${playerId}`);
  if (!el) return;
  const jumpPercent = (timeRemaining / currentWriteTime) * 85;
  el.classList.add('finished');
  el.classList.remove('breathing-slow');
  // GSAP: bounce jump up
  gsap.to(el, { y: `-${jumpPercent}vh`, duration: 1.2, ease: 'bounce.out' });
  // Celebration wiggle
  gsap.to(el, { rotation: 5, duration: 0.15, yoyo: true, repeat: 5, delay: 1.2 });
});

socket.on('writing-progress', ({ submitted, total }) => {
  document.getElementById('answer-progress').textContent = `${submitted}/${total}`;
});

// ============================================================
// SPLASH EVENTS — with narrator audio
// ============================================================
socket.on('show-splash', ({ text, type, duration, waitForNarrator }) => {
  const splashEl = document.getElementById('splash-text-content');
  splashEl.textContent = text;
  showScreen('splash-text');
  // GSAP: splash text entrance
  gsap.fromTo(splashEl, { scale: 0.3, opacity: 0, y: 40 },
    { scale: 1, opacity: 1, y: 0, duration: 0.6, ease: 'back.out(1.7)' });
  // Gentle float after entrance
  gsap.to(splashEl, { y: -8, duration: 1.5, ease: 'power1.inOut', yoyo: true, repeat: -1, delay: 0.6 });

  // Round intro splashes and scoreboard splashes = stop music, narrator only
  const stopTypes = ['pre-game', 'round-1-start', 'round-2-start', 'round-3-start', 'round-4-start',
                     'scoreboard-1', 'scoreboard-2', 'scoreboard-3'];
  if (type && stopTypes.includes(type)) {
    stopMusic();
  }

  let narratorPromise = null;
  if (type === 'pre-game') {
    narratorPromise = playNarrator(NARRATOR.letsStart);
  } else if (type === 'round-1-start') {
    narratorPromise = playNarrator(NARRATOR.round1);
  } else if (type === 'round-2-start') {
    narratorPromise = playNarrator(NARRATOR.round2);
  } else if (type === 'round-3-start') {
    narratorPromise = playNarrator(NARRATOR.round3);
  } else if (type === 'round-4-start') {
    narratorPromise = playNarrator(NARRATOR.round4);
  } else if (type === 'scoreboard-1') {
    narratorPromise = playNarrator(NARRATOR.pointsTable1);
  } else if (type === 'scoreboard-2') {
    narratorPromise = playNarrator(NARRATOR.pointsTable2);
  } else if (type === 'scoreboard-3') {
    narratorPromise = playNarrator(NARRATOR.pointsTable3);
  } else if (type === 'time-is-up') {
    duckMusic();
    narratorPromise = playSFX(SFX.timeIsUp).then(() => unduckMusic());
  } else if (type === 'lets-see-votes') {
    duckMusic();
    narratorPromise = playSFX(SFX.timeIsUp).then(() => unduckMusic());
  } else if (type === 'all-voted') {
    narratorPromise = playNarrator(NARRATOR.allVoted);
  }

  // If narrated/SFX splash — wait for audio to finish, then tell server
  if (waitForNarrator && narratorPromise) {
    narratorPromise.then(() => {
      // Small buffer after audio ends
      setTimeout(() => socket.emit('splash-done'), 500);
    });
  }
});

socket.on('matchup-prompt-reveal', ({ promptText, promptAudio }) => {
  document.getElementById('reveal-prompt-text').textContent = promptText;
  showScreen('prompt-reveal');
  playSwooshIn();

  // Play prompt narration — when done, signal server
  playPromptAudio(promptAudio).then(() => {
    setTimeout(() => {
      playSwooshOut();
      socket.emit('prompt-reveal-done');
    }, 800);
  });
});

socket.on('matchup-pause', () => {
  document.getElementById('splash-text-content').textContent = '';
  showScreen('splash-text');
});

// ============================================================
// MATCHUP VOTING
// ============================================================
socket.on('matchup-show', (data) => {
  showScreen('matchup');
  document.getElementById('matchup-prompt').textContent = data.promptText;
  document.getElementById('matchup-a1-text').textContent = data.answer1;
  document.getElementById('matchup-a2-text').textContent = data.answer2;
  document.getElementById('matchup-vote-count').textContent = '0';
  const a1El = document.getElementById('matchup-a1');
  const a2El = document.getElementById('matchup-a2');
  a1El.className = 'matchup-answer left';
  a2El.className = 'matchup-answer right';
  // Auto-shrink text for long answers
  setTimeout(() => {
    autoShrinkText(document.getElementById('matchup-a1-text'), 32);
    autoShrinkText(document.getElementById('matchup-a2-text'), 32);
  }, 50);
  // GSAP: answers slide in from sides with elastic bounce
  gsap.fromTo(a1El, { x: -200, scale: 0.5, opacity: 0, rotation: -8 },
    { x: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(1.7)' });
  gsap.fromTo(a2El, { x: 200, scale: 0.5, opacity: 0, rotation: 8 },
    { x: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(1.7)', delay: 0.15 });
  // Resume round music if not already playing (in case it was stopped)
  if (!currentMusic || currentMusic.paused) playMusic(getRoundMusic());
  if (!data.autoResolve && data.voteTime > 0) startCircleTimer('matchup-timer', data.voteTime);
});

socket.on('matchup-vote-progress', ({ count }) => {
  document.getElementById('matchup-vote-count').textContent = count;
});

// ============================================================
// MATCHUP RESULT — Side-by-side with animated reveal
// ============================================================
socket.on('matchup-result', ({ result, hasQuiflotz }) => {
  showScreen('matchup-result');
  document.getElementById('result-prompt').textContent = result.prompt.text;

  const isDQ1 = result.player1.answer === '💨 אין תשובה' || result.player1.answer === '(no answer)';
  const isDQ2 = result.player2.answer === '💨 אין תשובה' || result.player2.answer === '(no answer)';

  // Set answers on cards
  document.getElementById('mr-answer1').textContent = isDQ1 ? '💨 פסול!' : result.player1.answer;
  document.getElementById('mr-answer2').textContent = isDQ2 ? '💨 פסול!' : result.player2.answer;
  // Auto-shrink long answers
  setTimeout(() => {
    autoShrinkText(document.getElementById('mr-answer1'), 35);
    autoShrinkText(document.getElementById('mr-answer2'), 35);
  }, 50);
  document.getElementById('mr-player1').textContent = result.player1.name;
  document.getElementById('mr-player2').textContent = result.player2.name;
  document.getElementById('mr-points1').textContent = '+0';
  document.getElementById('mr-points2').textContent = '+0';

  // Reset state
  const left = document.getElementById('mr-left');
  const right = document.getElementById('mr-right');
  left.className = 'mr-side left';
  right.className = 'mr-side right';
  if (isDQ1) left.classList.add('disqualified');
  if (isDQ2) right.classList.add('disqualified');
  document.getElementById('mr-voters1').innerHTML = '';
  document.getElementById('mr-voters2').innerHTML = '';
  document.getElementById('mr-pct1').classList.add('hidden');
  document.getElementById('mr-pct2').classList.add('hidden');
  document.getElementById('btn-next-matchup').style.display = 'none';

  const hasNoShow = (isDQ1 || isDQ2) && currentSubRound <= 2;

  // Quiflotz: show overlay + audio FIRST, then reveal results
  if (hasQuiflotz && !hasNoShow) {
    playNarrator(NARRATOR.quiflotz);
    const ov = document.getElementById('quiflotz-overlay');
    const banner = ov.querySelector('.quiflotz-text');
    const sub = ov.querySelector('.quiflotz-sub');
    ov.classList.remove('hidden');
    ov.style.opacity = '1';

    // GSAP timeline for quiflotz celebration
    const qTl = gsap.timeline();
    // Flash background green→dark
    qTl.fromTo(ov, { backgroundColor: 'rgba(57, 255, 20, 0.5)' },
      { backgroundColor: 'rgba(0, 0, 0, 0.9)', duration: 0.3 });
    // Banner: dramatic zoom in with spin and overshoot
    qTl.fromTo(banner, { scale: 0, rotation: -25, opacity: 0 },
      { scale: 1, rotation: 0, opacity: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)' }, 0.1);
    // Banner continuous pulse
    qTl.to(banner, { scale: 1.08, duration: 0.4, ease: 'power1.inOut', yoyo: true, repeat: 4 }, '+=0.1');
    // Shake
    qTl.to(banner, { x: -6, duration: 0.05, yoyo: true, repeat: 7 }, '<');
    // Sub text slides up
    qTl.fromTo(sub, { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, '-=1.5');
    // Fade out
    qTl.to(ov, { opacity: 0, duration: 0.5, ease: 'power2.in',
      onComplete: () => {
        ov.classList.add('hidden');
        startMatchupRevealAnimation(result, isDQ1, isDQ2);
      }
    }, '+=0.3');
  } else {
    if (hasNoShow) playNarrator(NARRATOR.noShow);
    // No quiflotz — start reveal directly
    setTimeout(() => startMatchupRevealAnimation(result, isDQ1, isDQ2), 500);
  }
});

function startMatchupRevealAnimation(result, isDQ1, isDQ2) {
  const left = document.getElementById('mr-left');
  const right = document.getElementById('mr-right');

  // Mark winner/quiflotz
  if (!isDQ1 && result.player1.points > result.player2.points) left.classList.add('winner');
  if (!isDQ2 && result.player2.points > result.player1.points) right.classList.add('winner');
  if (result.player1.quiflotz) left.classList.add('quiflotz-glow');
  if (result.player2.quiflotz) right.classList.add('quiflotz-glow');

  // GSAP timeline for the entire reveal sequence
  const tl = gsap.timeline();

  // Step 1: Cards zoom in with bounce
  tl.fromTo([left, right], { scale: 0.85, opacity: 0.5 },
    { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.4)', stagger: 0.1 });

  // Step 2: Voter avatars pop in
  tl.call(() => {
    popVotersIn('mr-voters1', result.player1.voters);
    popVotersIn('mr-voters2', result.player2.voters);
  }, null, '+=0.2');

  // Step 3: Percentage circles slam in
  tl.call(() => {
    const pct1 = document.getElementById('mr-pct1');
    const pct2 = document.getElementById('mr-pct2');
    if (!isDQ1) {
      pct1.textContent = result.player1.percentage + '%';
      pct1.classList.remove('hidden');
      gsap.fromTo(pct1, { scale: 0, rotation: -30 },
        { scale: 1, rotation: -20, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    }
    if (!isDQ2) {
      pct2.textContent = result.player2.percentage + '%';
      pct2.classList.remove('hidden');
      gsap.fromTo(pct2, { scale: 0, rotation: -30 },
        { scale: 1, rotation: -20, duration: 0.5, ease: 'elastic.out(1, 0.4)', delay: 0.1 });
    }
    // Percentage stamp sound
    if (!isDQ1 || !isDQ2) {
      SFX.percentage.currentTime = 0;
      SFX.percentage.volume = userVolume * 0.3;
      if (!isMuted && audioUnlocked) SFX.percentage.play().catch(() => {});
    }
  }, null, '+=1.4');

  // Step 4: Score count
  tl.call(() => {
    if (result.player1.points > 0) {
      animateScoreCount(document.getElementById('mr-points1'), result.player1.points, 700, '+');
    }
    if (result.player2.points > 0) {
      animateScoreCount(document.getElementById('mr-points2'), result.player2.points, 700, '+');
    }
  }, null, '+=0.5');
}

function popVotersIn(containerId, voters) {
  const el = document.getElementById(containerId);
  if (!el || !voters || voters.length === 0) return;
  el.innerHTML = '';
  const shownIds = new Set();
  const uniqueVoters = voters.map((voter) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter.replace(/ \(x\d+\)$/, '');
    const isSpec = typeof voter === 'object' ? voter.isSpectator : false;
    if (voterId && shownIds.has(voterId)) return null;
    if (voterId) shownIds.add(voterId);
    return { voterId, voterName, isSpectator: isSpec };
  }).filter(Boolean);

  // Scale down avatars when there are many voters
  const count = uniqueVoters.length;
  let imgSize, fontSize, gap;
  if (count <= 3) { imgSize = 90; fontSize = 0.9; gap = 4; }
  else if (count <= 5) { imgSize = 65; fontSize = 0.75; gap = 3; }
  else { imgSize = 50; fontSize = 0.65; gap = 2; }
  el.style.gap = gap + 'px';

  uniqueVoters.forEach((v, i) => {
    setTimeout(() => {
      const avatar = v.isSpectator ? SPECTATOR_AVATAR : AVATARS[v.voterId ? getPlayerAvatarIndex(v.voterId) : 0];
      const html = `<div class="voter-avatar voter-avatar-lg">
        <div class="voter-avatar-icon-lg" style="width:${imgSize}px;height:${imgSize}px">
          <img src="${avatar.img}" class="voter-char-img" style="width:${imgSize}px;height:${imgSize}px">
        </div>
        <div class="voter-avatar-name-lg" style="font-size:${fontSize}rem">${esc(v.voterName)}</div>
      </div>`;
      el.insertAdjacentHTML('beforeend', html);
      const added = el.lastElementChild;
      gsap.fromTo(added, { scale: 0, y: -40, rotation: -15 },
        { scale: 1, y: 0, rotation: 0, duration: 0.4, ease: 'back.out(2.5)' });
      playPopSFX();
    }, i * 150);
  });
}

function popVotersInFinal(container, voters) {
  if (!container || !voters || voters.length === 0) return;
  const shownIds = new Set();
  const uniqueVoters = voters.map((voter) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter;
    const count = typeof voter === 'object' ? voter.count : 1;
    const isSpec = typeof voter === 'object' ? voter.isSpectator : false;
    if (voterId && shownIds.has(voterId)) return null;
    if (voterId) shownIds.add(voterId);
    return { voterId, voterName, count, isSpectator: isSpec };
  }).filter(Boolean);

  // Scale down for many voters
  const total = uniqueVoters.length;
  let imgSize, fontSize;
  if (total <= 3) { imgSize = 90; fontSize = 0.9; }
  else if (total <= 5) { imgSize = 65; fontSize = 0.75; }
  else { imgSize = 50; fontSize = 0.65; }

  uniqueVoters.forEach((v, i) => {
    setTimeout(() => {
      const avatar = v.isSpectator ? SPECTATOR_AVATAR : AVATARS[v.voterId ? getPlayerAvatarIndex(v.voterId) : 0];
      const countBadge = v.count > 1 ? `<span class="voter-count">x${v.count}</span>` : '';
      const html = `<div class="voter-avatar voter-avatar-lg">
        <div class="voter-avatar-icon-lg" style="width:${imgSize}px;height:${imgSize}px">
          <img src="${avatar.img}" class="voter-char-img" style="width:${imgSize}px;height:${imgSize}px">
        </div>
        <div class="voter-avatar-name-lg" style="font-size:${fontSize}rem">${esc(v.voterName)}${countBadge}</div>
      </div>`;
      container.insertAdjacentHTML('beforeend', html);
      const added = container.lastElementChild;
      gsap.fromTo(added, { scale: 0, y: -40, rotation: -15 },
        { scale: 1, y: 0, rotation: 0, duration: 0.4, ease: 'back.out(2.5)' });
      playPopSFX();
    }, i * 150);
  });
}

function buildVoterAvatarsHTML(voters) {
  if (!voters || voters.length === 0) return '';
  const shownIds = new Set();
  return voters.map((voter, i) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter.replace(/ \(x\d+\)$/, '');
    if (voterId && shownIds.has(voterId)) return '';
    if (voterId) shownIds.add(voterId);
    const avatar = AVATARS[voterId ? getPlayerAvatarIndex(voterId) : 0];
    return `<div class="voter-avatar voter-avatar-lg" style="animation-delay: ${i * 0.15}s">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}</div>
    </div>`;
  }).filter(Boolean).join('');
}

document.getElementById('btn-next-matchup').addEventListener('click', () => socket.emit('next-matchup'));

// ============================================================
// FINAL ROUND VOTING — Show all answers as grid on host
// ============================================================
socket.on('final-voting-start', ({ prompt, answers, voteTime }) => {
  showScreen('final-voting');
  document.getElementById('final-voting-prompt').textContent = prompt.text;
  document.getElementById('final-voting-count').textContent = '0';

  // Build grid of answer cards (like Quiplash)
  const grid = document.getElementById('final-voting-grid');
  grid.innerHTML = answers.map((a, i) => `
    <div class="fv-card" style="animation-delay: ${i * 0.1}s">
      <div class="fv-answer">${esc(a.text)}</div>
    </div>
  `).join('');

  playMusic(MUSIC.round3);
  // Play prompt narration once
  if (prompt.audio) playPromptAudio(prompt.audio);
  startCircleTimer('final-vote-timer', voteTime);
});

socket.on('final-vote-progress', ({ count }) => {
  const el = document.getElementById('final-voting-count');
  if (el) el.textContent = count;
});

// ============================================================
// FINAL ROUND RESULTS — popup-style reveal
// ============================================================
let finalRevealResults = [];
let finalRevealIndex = 0;
let finalTotalVotes = 0;
let finalRevealGridMap = [];

socket.on('final-round-result', ({ prompt, results }) => {
  // Show "בואו נראה מה הצבעתם" splash first
  document.getElementById('splash-text-content').textContent = 'בואו נראה מה הצבעתם!';
  showScreen('splash-text');
  duckMusic();
  playSFX(SFX.timeIsUp).then(() => unduckMusic());

  // After 3s splash → show the results screen with reveal
  setTimeout(() => {
    showScreen('final-result');
    document.getElementById('final-result-prompt').textContent = prompt.text;

    // Sort: least votes first, filter out 0-vote answers for popup reveal
    const allSorted = [...results].sort((a, b) => a.votes - b.votes);
    finalRevealResults = allSorted.filter(r => r.votes > 0);
    finalTotalVotes = results.reduce((sum, r) => sum + r.votes, 0);
    finalRevealIndex = 0;

    // Build the grid of ALL answers (including 0-vote ones)
    const grid = document.getElementById('final-answers-grid');
    grid.innerHTML = allSorted.map((r, i) => {
      const avatar = AVATARS[getPlayerAvatarIndex(r.playerId)];
      const hasVotes = r.votes > 0;
      return `<div class="final-grid-card ${hasVotes ? '' : 'no-votes'}" id="final-grid-${i}" data-index="${i}">
        <div class="final-grid-answer">${esc(r.text)}</div>
        <div class="final-grid-player">
          <img src="${avatar.img}" class="final-grid-avatar-img"> ${esc(r.playerName)}
        </div>
      </div>`;
    }).join('');

    // GSAP: stagger grid cards entrance
    const gridCards = grid.querySelectorAll('.final-grid-card');
    gsap.fromTo(gridCards, { scale: 0.5, opacity: 0, y: 30 },
      { scale: 1, opacity: 0.7, y: 0, duration: 0.5, ease: 'back.out(1.4)', stagger: 0.08 });

    // Hide overlay
    document.getElementById('final-popup-overlay').classList.add('hidden');

    if (finalRevealResults.length === 0) {
      grid.innerHTML = '<div class="waiting-text">אף אחד לא הצביע...</div>';
      return;
    }

    // Map reveal index to grid card index (only voted answers get popup)
    finalRevealGridMap = [];
    let revealIdx = 0;
    allSorted.forEach((r, gridIdx) => {
      if (r.votes > 0) {
        finalRevealGridMap[revealIdx] = gridIdx;
        revealIdx++;
      }
    });

    // Start reveal sequence after a brief pause
    setTimeout(revealNextFinalAnswer, 1500);
  }, 3000);
});

function revealNextFinalAnswer() {
  if (finalRevealIndex >= finalRevealResults.length) return;

  const r = finalRevealResults[finalRevealIndex];
  const isLast = finalRevealIndex === finalRevealResults.length - 1;
  const pct = finalTotalVotes > 0 ? Math.round((r.votes / finalTotalVotes) * 100) : 0;

  // Highlight the correct grid card (mapped from reveal index)
  const gridIdx = finalRevealGridMap ? finalRevealGridMap[finalRevealIndex] : finalRevealIndex;
  const gridCard = document.getElementById(`final-grid-${gridIdx}`);
  if (gridCard) gridCard.classList.add('revealing');

  // Show popup overlay
  const overlay = document.getElementById('final-popup-overlay');
  const card = document.getElementById('final-popup-card');
  overlay.classList.remove('hidden');
  card.className = 'final-popup-card' + (isLast ? ' winner-card' : '');
  // GSAP: card flies in from bottom with bounce
  gsap.fromTo(card, { y: 300, scale: 0.3, opacity: 0, rotation: 5 },
    { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(1.7)' });

  document.getElementById('final-popup-answer').textContent = r.text;
  document.getElementById('final-popup-player').textContent = r.playerName;
  document.getElementById('final-popup-points').textContent = '+' + r.points;

  // Hide voters and pct initially
  const votersEl = document.getElementById('final-popup-voters');
  const pctEl = document.getElementById('final-popup-pct');
  votersEl.classList.add('hidden');
  pctEl.classList.add('hidden');
  votersEl.innerHTML = '';

  // After 2s: pop voters in one by one, then percentage + points
  setTimeout(() => {
    // Pop voters in rapidly using the shared function
    votersEl.classList.remove('hidden');
    popVotersInFinal(votersEl, r.voters);

    // After voters pop in → percentage + points
    const voterDelay = Math.max(r.voters.length * 120, 300) + 400;
    setTimeout(() => {
      pctEl.textContent = pct + '%';
      pctEl.classList.remove('hidden');
      // GSAP: percentage slams in with elastic
      gsap.fromTo(pctEl, { scale: 0, rotation: -40 },
        { scale: 1, rotation: -20, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
      // Play percentage stamp sound
      SFX.percentage.currentTime = 0;
      SFX.percentage.volume = userVolume * 0.3;
      if (!isMuted && audioUnlocked) SFX.percentage.play().catch(() => {});

      const pointsEl = document.getElementById('final-popup-points');
      if (r.points > 0) {
        animateScoreCount(pointsEl, r.points, 700, '+');
      } else {
        pointsEl.textContent = '+0';
      }
    }, voterDelay);
  }, 2000);

  // After 5s total (2s wait + 3s display): close popup, move to next
  setTimeout(() => {
    overlay.classList.add('hidden');
    if (gridCard) {
      gridCard.classList.remove('revealing');
      gridCard.classList.add('revealed');
      // Update grid card with result info
      gridCard.innerHTML += `<div class="final-grid-pct">${pct}%</div>`;
    }
    finalRevealIndex++;
    if (finalRevealIndex < finalRevealResults.length) {
      setTimeout(revealNextFinalAnswer, 800);
    }
  }, 5000);
}

// ============================================================
// SCOREBOARD
// ============================================================
socket.on('scoreboard', ({ scores, subRound, nextSubRound }) => {
  showScreen('scoreboard');
  document.getElementById('scoreboard-sub').textContent =
    nextSubRound ? `אחרי סיבוב ${subRound}/3` : 'תוצאות סופיות';
  renderScoreboard('scoreboard-list', scores);
  playMusic(MUSIC.scores); // Play scores music
  document.getElementById('btn-next-sub').style.display = 'none';
});

document.getElementById('btn-next-sub').addEventListener('click', () => socket.emit('next-sub-round'));

// ============================================================
// ROUND COMPLETE + WINNER
// ============================================================
socket.on('round-complete', ({ scores, winner }) => {
  stopMusic(); // Ensure no leftover music
  showScreen('round-complete');
  renderScoreboard('round-final-scores', scores);

  if (winner) {
    // After 2s → pre-winner splash → winner screen (tighter timing)
    setTimeout(async () => {
      showScreen('pre-winner');
      stopMusic();
      playNarrator(NARRATOR.winner);
      // Short gap then drum roll overlaps end of narrator
      await new Promise(r => setTimeout(r, 1500));
      await playSFX(SFX.drumRolls);

      // Show winner
      showScreen('winner');
      playSFX(SFX.winnerSound);
      playMusic(MUSIC.credits);

      const avatar = AVATARS[getPlayerAvatarIndex(winner.id)];
      const charEl = document.getElementById('winner-character-big');
      charEl.innerHTML = `<img src="${avatar.img}" alt="">`;
      document.getElementById('winner-name-big').textContent = winner.name;
      const winScoreEl = document.getElementById('winner-score-big');
      winScoreEl.textContent = '0 נקודות';

      // GSAP: winner celebration timeline
      const winTl = gsap.timeline();
      winTl.fromTo(charEl, { scale: 0, rotation: -20 },
        { scale: 1, rotation: 0, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
      winTl.fromTo(document.getElementById('winner-name-big'),
        { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'back.out(2)' }, '-=0.3');
      winTl.call(() => {
        animateScoreCount(winScoreEl, winner.score, 1200, '', ' נקודות');
      }, null, '+=0.2');
      // Continuous gentle bounce on character
      winTl.to(charEl, { y: -10, duration: 0.8, ease: 'power1.inOut', yoyo: true, repeat: -1 }, '+=0.5');
      document.getElementById('credits-scroll').innerHTML = CREDITS_HTML;
    }, 2000);
  }
});

// New round = restart game (go back to lobby with all players)
document.getElementById('btn-new-round').addEventListener('click', () => {
  stopMusic();
  socket.emit('restart-game');
});

socket.on('game-restarted', ({ players }) => {
  stopMusic();
  showScreen('lobby');
  playerAvatarMap = new Map();
  playMusic(MUSIC.lobby);
  updateLobby(players, 0, []);
  sessionStorage.setItem('q_host_room', currentRoomCode);
});

socket.on('error-msg', ({ message }) => alert(message));

// ============================================================
// HELPERS
// ============================================================
function renderScoreboard(containerId, scores) {
  const el = document.getElementById(containerId);
  const total = scores.length;

  // Split into balanced rows — no single player alone in a row
  let topRow, bottomRow;
  if (total <= 4) {
    topRow = scores;
    bottomRow = [];
  } else {
    const topCount = Math.ceil(total / 2);
    topRow = scores.slice(0, topCount);
    bottomRow = scores.slice(topCount);
  }

  let html = '<div class="score-grid"><div class="score-row-top">';
  topRow.forEach((s, i) => { html += renderScoreBlock(s, i, i * 0.15); });
  html += '</div>';
  if (bottomRow.length > 0) {
    html += '<div class="score-row-bottom">';
    bottomRow.forEach((s, i) => { html += renderScoreBlock(s, topRow.length + i, (topRow.length + i) * 0.15); });
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;

  // GSAP: stagger score blocks bouncing up
  const blocks = el.querySelectorAll('.score-block');
  gsap.fromTo(blocks, { y: 80, scale: 0.6, opacity: 0 },
    { y: 0, scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.7)',
      stagger: 0.12, onComplete: () => {
        // After all blocks land, count up scores
        el.querySelectorAll('.score-block-points[data-score]').forEach((pointsEl, i) => {
          const target = parseInt(pointsEl.dataset.score) || 0;
          setTimeout(() => animateScoreCount(pointsEl, target, 900), i * 200);
        });
      }
    });
}

function renderScoreBlock(s, rankIndex, delay) {
  const rank = rankIndex + 1;
  const avatar = AVATARS[getPlayerAvatarIndex(s.id)];
  return `<div class="score-block" style="animation-delay: ${delay}s">
    <div class="score-block-rank">${rank}</div>
    <div class="score-block-rank-bg">${rank}</div>
    <div class="score-block-character"><img src="${avatar.img}" alt="" class="score-block-avatar breathing"></div>
    <div class="score-block-name">${esc(s.name)}</div>
    <div class="score-block-points" data-score="${s.score}">0</div>
  </div>`;
}

/**
 * Animate a score counting up from 0 to target value.
 * Plays SFX.scoreCount during counting.
 * prefix: optional string to prepend (e.g. '+')
 * suffix: optional string to append (e.g. ' נקודות')
 */
function animateScoreCount(element, targetValue, duration, prefix, suffix) {
  if (!element || targetValue <= 0) {
    if (element) element.textContent = (prefix || '') + targetValue + (suffix || '');
    return;
  }
  duration = duration || 800;
  prefix = prefix || '';
  suffix = suffix || '';
  const start = performance.now();
  let sfxPlaying = false;

  // Play score count SFX
  if (!isMuted && audioUnlocked) {
    SFX.scoreCount.currentTime = 0;
    SFX.scoreCount.volume = userVolume * 0.6;
    SFX.scoreCount.play().catch(() => {});
    sfxPlaying = true;
  }

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * targetValue);
    element.textContent = prefix + current + suffix;

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.textContent = prefix + targetValue + suffix;
      // Stop SFX when done
      if (sfxPlaying) {
        setTimeout(() => {
          SFX.scoreCount.pause();
          SFX.scoreCount.currentTime = 0;
        }, 100);
      }
    }
  }
  requestAnimationFrame(tick);
}

function autoShrinkText(element, maxFontSize) {
  if (!element) return;
  const parent = element.parentElement;
  if (!parent) return;
  let size = maxFontSize || 32;
  element.style.fontSize = size + 'px';
  while (element.scrollHeight > parent.clientHeight - 10 && size > 14) {
    size -= 2;
    element.style.fontSize = size + 'px';
  }
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
