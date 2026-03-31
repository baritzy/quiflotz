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

function startCircleTimer(containerId, seconds) {
  clearInterval(activeTimerInterval);
  const el = document.getElementById(containerId);
  if (!el) return;
  let remaining = seconds;
  el.innerHTML = renderCircle(remaining, seconds);
  activeTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(activeTimerInterval); remaining = 0; }
    el.innerHTML = renderCircle(remaining, seconds);
  }, 1000);
}

function renderCircle(remaining, total) {
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const deg = (pct / 100) * 360;
  const color = remaining <= 5 ? '#FF1493' : remaining <= 15 ? '#FFD700' : '#39FF14';
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
  startCircleTimer('write-timer', writeTime);
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
  startCircleTimer('write-timer', writeTime);
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
socket.on('show-splash', ({ text, type, duration }) => {
  document.getElementById('splash-text-content').textContent = text;
  showScreen('splash-text');

  // Round intro splashes and scoreboard splashes = stop music, narrator only
  // Mid-round splashes (no type) = just visual pause, keep music
  const stopTypes = ['pre-game', 'round-1-start', 'round-2-start', 'round-3-start', 'round-4-start',
                     'scoreboard-1', 'scoreboard-2', 'scoreboard-3'];
  if (type && stopTypes.includes(type)) {
    stopMusic();
  }

  if (type === 'pre-game') {
    playNarrator(NARRATOR.letsStart);
  } else if (type === 'round-1-start') {
    playNarrator(NARRATOR.round1);
  } else if (type === 'round-2-start') {
    playNarrator(NARRATOR.round2);
  } else if (type === 'round-3-start') {
    playNarrator(NARRATOR.round3);
  } else if (type === 'round-4-start') {
    playNarrator(NARRATOR.round4);
  } else if (type === 'scoreboard-1') {
    playNarrator(NARRATOR.pointsTable1);
  } else if (type === 'scoreboard-2') {
    playNarrator(NARRATOR.pointsTable2);
  } else if (type === 'scoreboard-3') {
    playNarrator(NARRATOR.pointsTable3);
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
// MATCHUP RESULT
// ============================================================
socket.on('matchup-result', ({ result, hasQuiflotz }) => {
  showScreen('matchup-result');
  document.getElementById('result-prompt').textContent = result.prompt.text;
  document.getElementById('result-name1').textContent = result.player1.name;
  document.getElementById('result-name2').textContent = result.player2.name;

  const isDQ1 = result.player1.answer === '💨 אין תשובה' || result.player1.answer === '(no answer)';
  const isDQ2 = result.player2.answer === '💨 אין תשובה' || result.player2.answer === '(no answer)';

  document.getElementById('result-text1').textContent = isDQ1 ? '💨 פסול!' : result.player1.answer;
  document.getElementById('result-text2').textContent = isDQ2 ? '💨 פסול!' : result.player2.answer;
  document.getElementById('result-pts1').textContent = '+' + result.player1.points;
  document.getElementById('result-pts2').textContent = '+' + result.player2.points;
  document.getElementById('result-bar1').style.width = '0%';
  document.getElementById('result-bar2').style.width = '0%';
  document.getElementById('result-pct1').classList.add('hidden');
  document.getElementById('result-pct2').classList.add('hidden');

  const left = document.getElementById('result-left');
  const right = document.getElementById('result-right');
  left.className = 'matchup-result-side left';
  right.className = 'matchup-result-side right';
  if (isDQ1) left.classList.add('disqualified');
  if (isDQ2) right.classList.add('disqualified');
  left.classList.toggle('winner', !isDQ1 && result.player1.points > result.player2.points);
  right.classList.toggle('winner', !isDQ2 && result.player2.points > result.player1.points);
  left.classList.toggle('quiflotz-glow', result.player1.quiflotz);
  right.classList.toggle('quiflotz-glow', result.player2.quiflotz);

  showVoterAvatars('result-voters1', result.player1.voters);
  showVoterAvatars('result-voters2', result.player2.voters);

  // Narrator priority: no-show wins over quiflotz announcement
  const hasNoShow = (isDQ1 || isDQ2) && currentSubRound <= 2;
  if (hasNoShow) {
    playNarrator(NARRATOR.noShow);
  } else if (hasQuiflotz) {
    playNarrator(NARRATOR.quiflotz);
  }

  // Quiflotz overlay (visual only, narrator handled above)
  if (hasQuiflotz && !hasNoShow) {
    const ov = document.getElementById('quiflotz-overlay');
    ov.classList.remove('hidden');
    setTimeout(() => ov.classList.add('hidden'), 3000);
  }

  setTimeout(() => {
    const pct1El = document.getElementById('result-pct1');
    const pct2El = document.getElementById('result-pct2');
    if (!isDQ1 && !isDQ2) {
      pct1El.textContent = result.player1.percentage + '%';
      pct2El.textContent = result.player2.percentage + '%';
      pct1El.classList.remove('hidden'); pct2El.classList.remove('hidden');
      pct1El.classList.add('pop-in'); pct2El.classList.add('pop-in');
      document.getElementById('result-bar1').style.width = result.player1.percentage + '%';
      document.getElementById('result-bar2').style.width = result.player2.percentage + '%';
    } else if (isDQ1 && !isDQ2) {
      pct2El.textContent = '100%'; pct2El.classList.remove('hidden'); pct2El.classList.add('pop-in');
      document.getElementById('result-bar2').style.width = '100%';
    } else if (!isDQ1 && isDQ2) {
      pct1El.textContent = '100%'; pct1El.classList.remove('hidden'); pct1El.classList.add('pop-in');
      document.getElementById('result-bar1').style.width = '100%';
    }
  }, 2000);

  document.getElementById('btn-next-matchup').style.display = 'none';
});

function showVoterAvatars(containerId, voters) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!voters || voters.length === 0) { el.innerHTML = ''; return; }
  const shownIds = new Set();
  el.innerHTML = voters.map((voter, i) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter.replace(/ \(x\d+\)$/, '');
    if (voterId && shownIds.has(voterId)) return '';
    if (voterId) shownIds.add(voterId);
    const avatar = AVATARS[voterId ? getPlayerAvatarIndex(voterId) : 0];
    return `<div class="voter-avatar voter-avatar-lg" style="animation-delay: ${i * 0.2}s">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}</div>
    </div>`;
  }).filter(Boolean).join('');
}

document.getElementById('btn-next-matchup').addEventListener('click', () => socket.emit('next-matchup'));

// ============================================================
// FINAL ROUND VOTING
// ============================================================
socket.on('final-voting-start', ({ prompt, answers, voteTime }) => {
  showScreen('writing');
  document.getElementById('write-sub').textContent = '3';
  document.getElementById('write-multiplier').textContent = 'x3';
  document.getElementById('writing-status-text').textContent = 'השחקנים מצביעים...';
  document.getElementById('writing-prompt-area').style.display = 'block';
  document.getElementById('writing-prompt-text').textContent = prompt.text;
  document.getElementById('answer-progress').textContent = '';
  playMusic(MUSIC.round3);
  startCircleTimer('write-timer', voteTime);
});

socket.on('final-vote-progress', ({ count }) => {
  const el = document.getElementById('answer-progress');
  if (el) el.textContent = `${count} הצביעו`;
});

// ============================================================
// FINAL ROUND RESULTS
// ============================================================
let finalRevealResults = [];
let finalRevealIndex = 0;

socket.on('final-round-result', ({ prompt, results }) => {
  showScreen('final-result');
  document.getElementById('final-result-prompt').textContent = prompt.text;
  document.getElementById('final-results-list').innerHTML = '';
  document.getElementById('btn-after-final').style.display = 'none';
  finalRevealResults = results.filter(r => r.points > 0);
  if (finalRevealResults.length === 0) {
    document.getElementById('final-results-list').innerHTML = '<div class="waiting-text">אף אחד לא הצביע...</div>';
    return;
  }
  finalRevealResults.reverse();
  finalRevealIndex = 0;
  revealNextFinalAnswer();
});

function revealNextFinalAnswer() {
  if (finalRevealIndex >= finalRevealResults.length) return;
  const r = finalRevealResults[finalRevealIndex];
  const isLast = finalRevealIndex === finalRevealResults.length - 1;
  const card = document.getElementById('final-reveal-card');
  card.style.display = 'block';
  card.className = 'final-reveal-card pop-in' + (isLast ? ' winner-card' : '');
  document.getElementById('final-reveal-answer').textContent = r.text;
  document.getElementById('final-reveal-player').textContent = r.playerName;
  document.getElementById('final-reveal-points').textContent = '+' + r.points;

  const votersEl = document.getElementById('final-reveal-voters');
  votersEl.innerHTML = r.voters.map((voter, i) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter;
    const count = typeof voter === 'object' ? voter.count : 1;
    const countBadge = count > 1 ? `<span class="voter-count">x${count}</span>` : '';
    const avatar = AVATARS[voterId ? getPlayerAvatarIndex(voterId) : 0];
    return `<div class="voter-avatar voter-avatar-lg" style="animation-delay: ${i * 0.2}s">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}${countBadge}</div>
    </div>`;
  }).join('');

  const pctEl = document.getElementById('final-reveal-pct');
  pctEl.classList.add('hidden');
  setTimeout(() => {
    const totalVotes = finalRevealResults.reduce((sum, r2) => sum + r2.votes, 0);
    const pct = totalVotes > 0 ? Math.round((r.votes / totalVotes) * 100) : 0;
    pctEl.textContent = pct + '%';
    pctEl.classList.remove('hidden'); pctEl.classList.add('pop-in');
  }, 2000);

  const displayTime = isLast ? 4000 : 3500;
  setTimeout(() => {
    const list = document.getElementById('final-results-list');
    const qBadge = r.quiflotz ? '<span class="quiflotz-badge">💨 QUIFLOTZ!</span>' : '';
    const medal = isLast ? '👑 ' : '';
    list.innerHTML = `<div class="result-card${r.quiflotz ? ' quiflotz-winner' : ''}">
      <div class="result-header"><span class="result-name">${medal}${esc(r.playerName)}</span><span class="result-score">+${r.points}</span></div>
      <div class="result-answer">${esc(r.text)}</div>${qBadge}
    </div>` + list.innerHTML;
    card.style.display = 'none';
    finalRevealIndex++;
    if (finalRevealIndex < finalRevealResults.length) setTimeout(revealNextFinalAnswer, 500);
  }, displayTime);
}

document.getElementById('btn-after-final').addEventListener('click', () => socket.emit('next-sub-round'));

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
      document.getElementById('winner-score-big').textContent = winner.score + ' נקודות';
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
}

function renderScoreBlock(s, rankIndex, delay) {
  const rank = rankIndex + 1;
  const avatar = AVATARS[getPlayerAvatarIndex(s.id)];
  const isTopRow = rankIndex < 4;
  const blockSize = isTopRow ? 'large' : 'small';
  return `<div class="score-block score-block-${blockSize}" style="animation-delay: ${delay}s">
    <div class="score-block-rank">${rank}</div>
    <div class="score-block-character"><img src="${avatar.img}" alt="" class="score-block-avatar breathing"></div>
    <div class="score-block-info">
      <div class="score-block-name">${esc(s.name)}</div>
      <div class="score-block-points">${s.score}</div>
    </div>
  </div>`;
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
