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
};
const SFX = {
  drumRolls: new Audio('/assets/SFX-drum-rolls.mp3'),
  winnerSound: new Audio('/assets/SFX-winner-sound.mp3'),
  countdown10: new Audio('/assets/Narrator-10-seconds.mp3'),
  countdown5: new Audio('/assets/Narrator-5-seconds.mp3'),
  timeIsUp: new Audio('/assets/Narrator-time-is-up.mp3'),
  scoreCount: new Audio('/assets/SFX-score-count.mp3'),
};

const ALL_AUDIO = [
  ...Object.values(MUSIC),
  ...Object.values(NARRATOR).flat(),
  ...Object.values(SFX)
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

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
  const bar = document.getElementById('persistent-bar');
  if (bar) bar.style.display = (name === 'splash' || name === 'lobby') ? 'none' : 'flex';
  // Clear avatar floor when leaving writing screen
  if (name !== 'writing') {
    const floor = document.getElementById('avatar-floor');
    if (floor) floor.innerHTML = '';
  }
}

// ============================================================
// ROOM CREATION
// ============================================================
let currentRoomCode = '';
socket.emit('create-room', (res) => {
  if (res.success) {
    currentRoomCode = res.roomCode;
    document.getElementById('room-code').textContent = res.roomCode;
    document.getElementById('persistent-room-code').textContent = res.roomCode;
    const url = window.location.origin.replace(/^https?:\/\//, '');
    document.getElementById('join-url').textContent = url;
  }
});

document.getElementById('btn-persistent-restart').addEventListener('click', () => {
  if (confirm('להתחיל משחק חדש?')) socket.emit('restart-game');
});

// ============================================================
// LOBBY
// ============================================================
socket.on('player-joined', ({ players, spectatorCount }) => updateLobby(players, spectatorCount));
socket.on('player-left', ({ players, spectatorCount }) => updateLobby(players, spectatorCount));

function updateLobby(players, spectatorCount) {
  document.getElementById('player-count').textContent = players.length;
  players.forEach(p => getPlayerAvatarIndex(p.id));
  const slots = document.querySelectorAll('.circle-slot');
  slots.forEach((slot, i) => {
    const charEl = slot.querySelector('.circle-character');
    const labelEl = slot.querySelector('.circle-label');
    const nameEl = slot.querySelector('.circle-name');
    const player = players[i];
    if (player) {
      const avatar = AVATARS[getPlayerAvatarIndex(player.id)];
      charEl.innerHTML = `<img src="${avatar.img}" alt="${avatar.name}" class="avatar-img">`;
      charEl.style.display = 'block';
      labelEl.style.display = 'none';
      nameEl.textContent = player.name;
      slot.classList.add('occupied');
      slot.classList.toggle('disconnected', !player.connected);
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
  document.getElementById('answer-progress').parentElement.style.display = 'none'; // Hide counter when big prompt shown
  document.getElementById('writing-prompt-area').style.display = 'block';
  document.getElementById('writing-prompt-text').textContent = prompt.text;
  playMusic(MUSIC.round3); // Start round 3 music at writing phase
  startCircleTimer('write-timer', writeTime, true);
  buildAvatarFloor(writingPlayers);
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
  el.style.transform = `translateY(-${jumpPercent}vh)`;
  el.classList.add('finished');
  el.classList.remove('breathing-slow');
});

socket.on('writing-progress', ({ submitted, total }) => {
  document.getElementById('answer-progress').textContent = `${submitted}/${total}`;
});

// ============================================================
// SPLASH EVENTS — with narrator audio
// ============================================================
socket.on('show-splash', ({ text, type, duration, waitForNarrator }) => {
  document.getElementById('splash-text-content').textContent = text;
  showScreen('splash-text');

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
    playSFX(SFX.timeIsUp);
  }

  // If narrated splash — wait for narrator to finish, then tell server
  if (waitForNarrator && narratorPromise) {
    narratorPromise.then(() => {
      // Small buffer after narrator ends
      setTimeout(() => socket.emit('splash-done'), 500);
    });
  }
});

socket.on('matchup-prompt-reveal', ({ promptText }) => {
  document.getElementById('reveal-prompt-text').textContent = promptText;
  showScreen('prompt-reveal');
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
  document.getElementById('matchup-a1').className = 'matchup-answer left pop-in';
  document.getElementById('matchup-a2').className = 'matchup-answer right pop-in';
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
    // Play narrator + show overlay
    playNarrator(NARRATOR.quiflotz);
    const ov = document.getElementById('quiflotz-overlay');
    ov.classList.remove('hidden');
    setTimeout(() => {
      ov.classList.add('hidden');
      // After quiflotz animation ends → start the result reveal
      startMatchupRevealAnimation(result, isDQ1, isDQ2);
    }, 3500);
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

  // Step 1: Zoom-in animation (5%)
  left.classList.add('zoom-in');
  right.classList.add('zoom-in');

  // Step 2: After 0.5s — voter avatars pop in one by one (rapid)
  setTimeout(() => {
    popVotersIn('mr-voters1', result.player1.voters);
    popVotersIn('mr-voters2', result.player2.voters);
  }, 600);

  // Step 3: After 2s — percentage circles appear
  setTimeout(() => {
    const pct1 = document.getElementById('mr-pct1');
    const pct2 = document.getElementById('mr-pct2');
    if (!isDQ1) {
      pct1.textContent = result.player1.percentage + '%';
      pct1.classList.remove('hidden');
      pct1.classList.add('pop-in');
    }
    if (!isDQ2) {
      pct2.textContent = result.player2.percentage + '%';
      pct2.classList.remove('hidden');
      pct2.classList.add('pop-in');
    }
  }, 2200);

  // Step 4: After 2.8s — score counting animation
  setTimeout(() => {
    if (result.player1.points > 0) {
      animateScoreCount(document.getElementById('mr-points1'), result.player1.points, 700, '+');
    }
    if (result.player2.points > 0) {
      animateScoreCount(document.getElementById('mr-points2'), result.player2.points, 700, '+');
    }
  }, 2800);
}

function popVotersIn(containerId, voters) {
  const el = document.getElementById(containerId);
  if (!el || !voters || voters.length === 0) return;
  const shownIds = new Set();
  const voterElements = voters.map((voter) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter.replace(/ \(x\d+\)$/, '');
    if (voterId && shownIds.has(voterId)) return null;
    if (voterId) shownIds.add(voterId);
    const avatar = AVATARS[voterId ? getPlayerAvatarIndex(voterId) : 0];
    return { html: `<div class="voter-avatar voter-avatar-lg pop-voter">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}</div>
    </div>`, name: voterName };
  }).filter(Boolean);

  // Pop them in one by one, rapidly (120ms apart)
  voterElements.forEach((v, i) => {
    setTimeout(() => {
      el.insertAdjacentHTML('beforeend', v.html);
    }, i * 120);
  });
}

function popVotersInFinal(container, voters) {
  if (!container || !voters || voters.length === 0) return;
  const shownIds = new Set();
  const voterElements = voters.map((voter) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter;
    const count = typeof voter === 'object' ? voter.count : 1;
    const countBadge = count > 1 ? `<span class="voter-count">x${count}</span>` : '';
    if (voterId && shownIds.has(voterId)) return null;
    if (voterId) shownIds.add(voterId);
    const avatar = AVATARS[voterId ? getPlayerAvatarIndex(voterId) : 0];
    return `<div class="voter-avatar voter-avatar-lg pop-voter">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}${countBadge}</div>
    </div>`;
  }).filter(Boolean);

  voterElements.forEach((html, i) => {
    setTimeout(() => container.insertAdjacentHTML('beforeend', html), i * 120);
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
  card.className = 'final-popup-card pop-in' + (isLast ? ' winner-card' : '');

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
      pctEl.classList.add('pop-in');

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
    // After 3s of scoreboard → pre-winner splash → winner screen
    setTimeout(async () => {
      showScreen('pre-winner');
      stopMusic();
      await playNarrator(NARRATOR.winner);
      await playSFX(SFX.drumRolls);

      // Show winner
      showScreen('winner');
      playSFX(SFX.winnerSound);
      playMusic(MUSIC.credits);

      const avatar = AVATARS[getPlayerAvatarIndex(winner.id)];
      document.getElementById('winner-character-big').innerHTML = `<img src="${avatar.img}" alt="">`;
      document.getElementById('winner-name-big').textContent = winner.name;
      const winScoreEl = document.getElementById('winner-score-big');
      winScoreEl.textContent = '0 נקודות';
      setTimeout(() => {
        animateScoreCount(winScoreEl, winner.score, 1200, '', ' נקודות');
      }, 500);
      document.getElementById('credits-scroll').innerHTML = CREDITS_HTML;
    }, 3000);
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
  updateLobby(players, 0);
});

socket.on('error-msg', ({ message }) => alert(message));

// ============================================================
// HELPERS
// ============================================================
function renderScoreboard(containerId, scores) {
  const el = document.getElementById(containerId);
  const topRow = scores.slice(0, 4);
  const bottomRow = scores.slice(4);
  let html = '<div class="score-grid"><div class="score-row-top">';
  topRow.forEach((s, i) => { html += renderScoreBlock(s, i, i * 0.15); });
  html += '</div>';
  if (bottomRow.length > 0) {
    html += '<div class="score-row-bottom">';
    bottomRow.forEach((s, i) => { html += renderScoreBlock(s, i + 4, (i + 4) * 0.15); });
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;

  // Animate score counting after a brief delay for slide-in animation
  setTimeout(() => {
    el.querySelectorAll('.score-block-points[data-score]').forEach((pointsEl, i) => {
      const target = parseInt(pointsEl.dataset.score) || 0;
      setTimeout(() => animateScoreCount(pointsEl, target, 900), i * 200);
    });
  }, 500);
}

function renderScoreBlock(s, rankIndex, delay) {
  const rank = rankIndex + 1;
  const avatar = AVATARS[getPlayerAvatarIndex(s.id)];
  const isTopRow = rankIndex < 4;
  const blockSize = isTopRow ? 'large' : 'small';
  return `<div class="score-block score-block-${blockSize}" style="animation-delay: ${delay}s">
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

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
