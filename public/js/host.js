const socket = io();

// ============================================================
// AVATAR SYSTEM — each player gets a character
// ============================================================
const AVATARS = [
  { emoji: '💩', img: 0 }, // poop with sunglasses
  { emoji: '🧦', img: 1 }, // stinky sock
  { emoji: '💨', img: 2 }, // gas cloud
  { emoji: '😂', img: 3 }, // laughing face
  { emoji: '😎', img: 4 }, // cool beans
  { emoji: '🚽', img: 5 }, // toilet
  { emoji: '😡', img: 6 }, // cranky cube
  { emoji: '🪰', img: 7 }, // buzz fly
];

// Track player-to-avatar mapping
let playerAvatarMap = new Map(); // playerId -> avatar index
let nextAvatarSlot = 0;

function getPlayerAvatar(playerId, playerName) {
  if (!playerAvatarMap.has(playerId)) {
    playerAvatarMap.set(playerId, nextAvatarSlot % 8);
    nextAvatarSlot++;
  }
  return AVATARS[playerAvatarMap.get(playerId)];
}

function getPlayerAvatarIndex(playerId) {
  return playerAvatarMap.get(playerId) || 0;
}

// ============================================================
// MUSIC SYSTEM
// ============================================================
const lobbyMusic = new Audio('/assets/lobby-music.mp3');
lobbyMusic.loop = true;
lobbyMusic.volume = 1.0;

const gameMusic = new Audio('/assets/game-music.mp3');
gameMusic.loop = true;
gameMusic.volume = 0.8;

let currentMusic = null;
let isMuted = false;
let audioUnlocked = false;

function playMusic(track) {
  if (currentMusic === track && !currentMusic.paused) return;
  if (currentMusic && currentMusic !== track) {
    currentMusic.pause();
    currentMusic.currentTime = 0;
  }
  currentMusic = track;
  if (!isMuted && audioUnlocked) {
    track.play().catch(() => {
      setTimeout(() => track.play().catch(() => {}), 200);
    });
  }
}

function stopMusic() {
  if (currentMusic) {
    currentMusic.pause();
    currentMusic.currentTime = 0;
    currentMusic = null;
  }
}

function toggleMute() {
  isMuted = !isMuted;
  lobbyMusic.muted = isMuted;
  gameMusic.muted = isMuted;
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = isMuted ? '🔇' : '🔊';
}

function setVolume(val) {
  const v = parseFloat(val);
  lobbyMusic.volume = v;
  gameMusic.volume = v;
}

lobbyMusic.preload = 'auto';
gameMusic.preload = 'auto';

function dismissSplash() {
  audioUnlocked = true;

  // Create and resume AudioContext on user gesture (required by browsers)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => console.log('AudioContext resumed'));
    }
    // Play a tiny silent buffer to fully unlock audio
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch(e) {
    console.log('AudioContext unlock failed:', e.message);
  }

  // Now play the actual music
  lobbyMusic.currentTime = 0;
  lobbyMusic.play().then(() => {
    console.log('Lobby music playing, volume:', lobbyMusic.volume, 'muted:', lobbyMusic.muted);
  }).catch(e => {
    console.log('Music play failed:', e.message);
    // Retry once
    setTimeout(() => {
      lobbyMusic.play().catch(e2 => console.log('Retry failed:', e2.message));
    }, 500);
  });

  showScreen('lobby');
}
window.dismissSplash = dismissSplash;

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

  if (name === 'lobby') playMusic(lobbyMusic);
  else if (['writing'].includes(name)) playMusic(gameMusic);
  else if (name === 'round-complete') { stopMusic(); playRoundCompleteMusic(); }
}

// ============================================================
// ROOM CREATION
// ============================================================
socket.emit('create-room', (res) => {
  if (res.success) {
    document.getElementById('room-code').textContent = res.roomCode;
    const url = window.location.origin;
    document.getElementById('join-url').textContent = url;
  }
});

// ============================================================
// LOBBY — Circular wheel with 8 slots
// ============================================================
socket.on('player-joined', ({ players, spectatorCount }) => updateLobby(players, spectatorCount));
socket.on('player-left', ({ players, spectatorCount }) => updateLobby(players, spectatorCount));

function updateLobby(players, spectatorCount) {
  document.getElementById('player-count').textContent = players.length;

  // Update avatar map
  players.forEach((p, i) => {
    if (!playerAvatarMap.has(p.id)) {
      playerAvatarMap.set(p.id, i % 8);
    }
  });

  // Update circle slots
  const slots = document.querySelectorAll('.circle-slot');
  slots.forEach((slot, i) => {
    const charEl = slot.querySelector('.circle-character');
    const labelEl = slot.querySelector('.circle-label');
    const nameEl = slot.querySelector('.circle-name');
    const player = players[i];

    if (player) {
      const avatar = AVATARS[i % 8];
      charEl.textContent = avatar.emoji;
      charEl.style.display = 'block';
      labelEl.style.display = 'none';
      nameEl.textContent = player.name;
      slot.classList.add('occupied');
      slot.classList.toggle('disconnected', !player.connected);
    } else {
      charEl.textContent = '';
      charEl.style.display = 'none';
      labelEl.style.display = 'block';
      nameEl.textContent = '';
      slot.classList.remove('occupied', 'disconnected');
    }
  });

  document.getElementById('btn-start').disabled = players.length < 3;

  const info = document.getElementById('spectator-info');
  if (spectatorCount > 0) {
    info.style.display = 'block';
    document.getElementById('spectator-count').textContent = spectatorCount;
  } else {
    info.style.display = 'none';
  }
}

document.getElementById('btn-start').addEventListener('click', () => socket.emit('start-game'));

// ============================================================
// WRITING PHASE — Timer top-left, avatars at bottom
// ============================================================
let currentWriteTime = 90;
let writingPlayers = []; // players in current round

socket.on('sub-round-start', ({ subRound, multiplier, matchupCount, writeTime, players }) => {
  currentWriteTime = writeTime;
  writingPlayers = players || [];

  showScreen('writing');
  document.getElementById('write-sub').textContent = subRound;
  document.getElementById('write-multiplier').textContent = `x${multiplier}`;
  document.getElementById('answer-progress').textContent = `0/${matchupCount * 2}`;
  document.getElementById('writing-status-text').textContent = 'השחקנים כותבים תשובות...';
  document.getElementById('writing-prompt-area').style.display = 'none';

  startCircleTimer('write-timer', writeTime);
  buildAvatarFloor(writingPlayers, writeTime);
});

socket.on('final-round-start', ({ prompt, writeTime, players }) => {
  currentWriteTime = writeTime;
  writingPlayers = players || [];

  showScreen('writing');
  document.getElementById('write-sub').textContent = '3';
  document.getElementById('write-multiplier').textContent = 'x3';
  document.getElementById('answer-progress').textContent = `0/${(players || []).length}`;
  document.getElementById('writing-status-text').textContent = '🔥 סיבוב אחרון!';

  // Show prompt for round 3
  document.getElementById('writing-prompt-area').style.display = 'block';
  document.getElementById('writing-prompt-text').textContent = prompt.text;

  startCircleTimer('write-timer', writeTime);
  buildAvatarFloor(writingPlayers, writeTime);
});

function buildAvatarFloor(players, totalTime) {
  const floor = document.getElementById('avatar-floor');
  floor.innerHTML = '';

  players.forEach((p, i) => {
    const avatar = AVATARS[i % 8];
    const el = document.createElement('div');
    el.className = 'floor-avatar breathing-slow';
    el.id = `floor-avatar-${p.id}`;
    el.dataset.playerId = p.id;
    el.innerHTML = `
      <div class="floor-avatar-character">${avatar.emoji}</div>
      <div class="floor-avatar-name">${esc(p.name)}</div>
    `;
    floor.appendChild(el);
  });
}

// Player finished writing — avatar jumps up
socket.on('player-finished-writing', ({ playerId, playerName, timeRemaining }) => {
  const el = document.getElementById(`floor-avatar-${playerId}`);
  if (!el) return;

  // Calculate jump height: more time remaining = higher jump
  // Max jump = 60% of container height
  const maxJump = 60;
  const jumpPercent = (timeRemaining / currentWriteTime) * maxJump;

  el.style.transform = `translateY(-${jumpPercent}vh)`;
  el.classList.add('finished');
  el.classList.remove('breathing-slow');
});

socket.on('writing-progress', ({ submitted, total }) => {
  document.getElementById('answer-progress').textContent = `${submitted}/${total}`;
});

// ============================================================
// PROMPT REVEAL — Show prompt big, then transition to matchup
// ============================================================

let pendingMatchupData = null;

socket.on('matchup-show', (data) => {
  pendingMatchupData = data;

  // First: show prompt big
  document.getElementById('reveal-prompt-text').textContent = data.promptText;
  showScreen('prompt-reveal');

  // Calculate reading time based on prompt length (min 2s, max 5s)
  const words = data.promptText.split(' ').length;
  const readTime = Math.min(5000, Math.max(2000, words * 400));

  setTimeout(() => {
    showMatchupScreen(data);
  }, readTime);
});

function showMatchupScreen(data) {
  showScreen('matchup');
  document.getElementById('matchup-num').textContent = data.index + 1;
  document.getElementById('matchup-total').textContent = data.total;
  document.getElementById('matchup-prompt').textContent = data.promptText;
  document.getElementById('matchup-multiplier').textContent = `x${data.multiplier}`;
  document.getElementById('matchup-a1-text').textContent = data.answer1;
  document.getElementById('matchup-a2-text').textContent = data.answer2;
  document.getElementById('matchup-vote-count').textContent = '0';

  document.getElementById('matchup-a1').className = 'matchup-answer left pop-in';
  document.getElementById('matchup-a2').className = 'matchup-answer right pop-in';

  if (!data.autoResolve && data.voteTime > 0) {
    startCircleTimer('matchup-timer', data.voteTime);
  }
}

socket.on('matchup-vote-progress', ({ count }) => {
  document.getElementById('matchup-vote-count').textContent = count;
});

// ============================================================
// MATCHUP RESULT — Voter avatars + delayed percentage
// ============================================================

socket.on('matchup-result', ({ result, hasQuiflotz, matchupIndex, totalMatchups, isLastMatchup }) => {
  showScreen('matchup-result');

  document.getElementById('result-prompt').textContent = result.prompt.text;
  document.getElementById('result-name1').textContent = result.player1.name;
  document.getElementById('result-text1').textContent = result.player1.answer;
  document.getElementById('result-pts1').textContent = '+' + result.player1.points;
  document.getElementById('result-bar1').style.width = '0%';

  document.getElementById('result-name2').textContent = result.player2.name;
  document.getElementById('result-text2').textContent = result.player2.answer;
  document.getElementById('result-pts2').textContent = '+' + result.player2.points;
  document.getElementById('result-bar2').style.width = '0%';

  // Hide percentages initially
  document.getElementById('result-pct1').classList.add('hidden');
  document.getElementById('result-pct2').classList.add('hidden');

  // Highlight winner
  const left = document.getElementById('result-left');
  const right = document.getElementById('result-right');
  left.classList.toggle('winner', result.player1.points > result.player2.points);
  right.classList.toggle('winner', result.player2.points > result.player1.points);
  left.classList.toggle('quiflotz-glow', result.player1.quiflotz);
  right.classList.toggle('quiflotz-glow', result.player2.quiflotz);

  // Step 1: Show voter avatars (immediately)
  showVoterAvatars('result-voters1', result.player1.voters);
  showVoterAvatars('result-voters2', result.player2.voters);

  // Step 2: Show percentages after 2 seconds
  setTimeout(() => {
    const pct1El = document.getElementById('result-pct1');
    const pct2El = document.getElementById('result-pct2');
    pct1El.textContent = result.player1.percentage + '%';
    pct2El.textContent = result.player2.percentage + '%';
    pct1El.classList.remove('hidden');
    pct2El.classList.remove('hidden');
    pct1El.classList.add('pop-in');
    pct2El.classList.add('pop-in');

    // Animate bars
    document.getElementById('result-bar1').style.width = result.player1.percentage + '%';
    document.getElementById('result-bar2').style.width = result.player2.percentage + '%';
  }, 2000);

  if (hasQuiflotz) showQuiflotzAnimation();

  const btn = document.getElementById('btn-next-matchup');
  btn.textContent = isLastMatchup ? 'טבלת ניקוד ➡️' : 'הבא ➡️';
});

function showVoterAvatars(containerId, voterNames) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!voterNames || voterNames.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = voterNames.map((name, i) => {
    // Find this voter's avatar by name
    const cleanName = name.replace(/ \(x\d+\)$/, '');
    const voteCount = name.match(/\(x(\d+)\)$/);
    const countBadge = voteCount ? `<span class="voter-count">x${voteCount[1]}</span>` : '';

    return `<div class="voter-avatar pop-in" style="animation-delay: ${i * 0.15}s">
      <div class="voter-avatar-icon">👤</div>
      <div class="voter-avatar-name">${esc(cleanName)}${countBadge}</div>
    </div>`;
  }).join('');
}

document.getElementById('btn-next-matchup').addEventListener('click', () => {
  socket.emit('next-matchup');
});

// ============================================================
// FINAL ROUND VOTING
// ============================================================

socket.on('final-voting-start', ({ prompt, answers, voteTime }) => {
  // Show prompt first
  document.getElementById('reveal-prompt-text').textContent = prompt.text;
  showScreen('prompt-reveal');

  const words = prompt.text.split(' ').length;
  const readTime = Math.min(5000, Math.max(2000, words * 400));

  // We don't show answers on host during voting in round 3
  // Just show that voting is happening
  setTimeout(() => {
    showScreen('writing');
    document.getElementById('write-sub').textContent = '3';
    document.getElementById('write-multiplier').textContent = 'x3';
    document.getElementById('writing-status-text').textContent = 'השחקנים כותבים תשובות...';
    document.getElementById('writing-prompt-area').style.display = 'block';
    document.getElementById('writing-prompt-text').textContent = prompt.text;
    document.getElementById('answer-progress').textContent = '';
    startCircleTimer('write-timer', voteTime);
  }, readTime);
});

socket.on('final-vote-progress', ({ count }) => {
  // Update count if visible
  const el = document.getElementById('answer-progress');
  if (el) el.textContent = `${count} הצביעו`;
});

// ============================================================
// FINAL ROUND RESULTS — Ranked reveal (lowest to highest)
// ============================================================

let finalRevealResults = [];
let finalRevealIndex = 0;

socket.on('final-round-result', ({ prompt, results, scores }) => {
  showScreen('final-result');
  document.getElementById('final-result-prompt').textContent = prompt.text;
  document.getElementById('final-results-list').innerHTML = '';
  document.getElementById('btn-after-final').style.display = 'none';

  // Filter out answers with 0 votes
  finalRevealResults = results.filter(r => r.points > 0);

  if (finalRevealResults.length === 0) {
    // Edge case: no one got votes
    document.getElementById('final-results-list').innerHTML = '<div class="waiting-text">אף אחד לא הצביע...</div>';
    document.getElementById('btn-after-final').style.display = 'inline-block';
    return;
  }

  // Reverse: show from lowest to highest
  finalRevealResults.reverse();
  finalRevealIndex = 0;

  revealNextFinalAnswer();
});

function revealNextFinalAnswer() {
  if (finalRevealIndex >= finalRevealResults.length) {
    // All revealed — show button
    document.getElementById('btn-after-final').style.display = 'inline-block';
    return;
  }

  const r = finalRevealResults[finalRevealIndex];
  const isLast = finalRevealIndex === finalRevealResults.length - 1;

  // Show the reveal card
  const card = document.getElementById('final-reveal-card');
  card.style.display = 'block';
  card.className = 'final-reveal-card pop-in' + (isLast ? ' winner-card' : '');

  document.getElementById('final-reveal-answer').textContent = r.text;
  document.getElementById('final-reveal-player').textContent = r.playerName;
  document.getElementById('final-reveal-points').textContent = '+' + r.points;

  // Show voter avatars
  const votersEl = document.getElementById('final-reveal-voters');
  votersEl.innerHTML = r.voters.map((name, i) => {
    const cleanName = name.replace(/ \(x\d+\)$/, '');
    const voteCount = name.match(/\(x(\d+)\)$/);
    const countBadge = voteCount ? `<span class="voter-count">x${voteCount[1]}</span>` : '';
    return `<div class="voter-avatar pop-in" style="animation-delay: ${i * 0.15}s">
      <div class="voter-avatar-icon">👤</div>
      <div class="voter-avatar-name">${esc(cleanName)}${countBadge}</div>
    </div>`;
  }).join('');

  // Show percentage after 2s
  const pctEl = document.getElementById('final-reveal-pct');
  pctEl.classList.add('hidden');

  setTimeout(() => {
    const totalVotes = finalRevealResults.reduce((sum, r2) => sum + r2.votes, 0);
    const pct = totalVotes > 0 ? Math.round((r.votes / totalVotes) * 100) : 0;
    pctEl.textContent = pct + '%';
    pctEl.classList.remove('hidden');
    pctEl.classList.add('pop-in');
  }, 2000);

  // After display time, add to accumulated list and show next
  const displayTime = isLast ? 4000 : 3500;
  setTimeout(() => {
    // Add to accumulated results list
    const list = document.getElementById('final-results-list');
    const qBadge = r.quiflotz ? '<span class="quiflotz-badge">💨 QUIFLOTZ!</span>' : '';
    const medal = isLast ? '👑 ' : '';
    list.innerHTML = `<div class="result-card${r.quiflotz ? ' quiflotz-winner' : ''}" style="animation-delay: 0s">
      <div class="result-header">
        <span class="result-name">${medal}${esc(r.playerName)}</span>
        <span class="result-score">+${r.points}</span>
      </div>
      <div class="result-answer">${esc(r.text)}</div>
      ${qBadge}
    </div>` + list.innerHTML;

    // Hide reveal card
    card.style.display = 'none';

    finalRevealIndex++;

    if (finalRevealIndex < finalRevealResults.length) {
      setTimeout(revealNextFinalAnswer, 500);
    } else {
      document.getElementById('btn-after-final').style.display = 'inline-block';
    }
  }, displayTime);
}

document.getElementById('btn-after-final').addEventListener('click', () => {
  socket.emit('next-sub-round');
});

// ============================================================
// SCOREBOARD
// ============================================================
socket.on('scoreboard', ({ scores, subRound, nextSubRound }) => {
  showScreen('scoreboard');
  document.getElementById('scoreboard-sub').textContent =
    nextSubRound ? `אחרי סיבוב ${subRound}/3` : 'תוצאות סופיות';
  renderScoreboard('scoreboard-list', scores);

  const btn = document.getElementById('btn-next-sub');
  if (nextSubRound) {
    btn.textContent = nextSubRound === 3 ? '🔥 סיבוב אחרון! ➡️' : `סיבוב ${nextSubRound}/3 ➡️`;
    btn.style.display = 'inline-block';
  } else {
    btn.style.display = 'none';
  }
});

document.getElementById('btn-next-sub').addEventListener('click', () => {
  socket.emit('next-sub-round');
});

// ============================================================
// ROUND COMPLETE
// ============================================================
socket.on('round-complete', ({ mainRound, scores, winner }) => {
  showScreen('round-complete');
  if (winner) {
    document.getElementById('round-winner-showcase').innerHTML = `
      <div class="winner-emoji">🍑👑</div>
      <div class="winner-name">${esc(winner.name)}</div>
      <div class="winner-score">${winner.score} נקודות</div>
    `;
  }
  renderScoreboard('round-final-scores', scores);
  playRoundCompleteMusic();
});

document.getElementById('btn-new-round').addEventListener('click', () => socket.emit('new-round'));
document.getElementById('btn-back-lobby').addEventListener('click', () => socket.emit('restart-game'));

socket.on('game-restarted', ({ players }) => {
  showScreen('lobby');
  playerAvatarMap = new Map();
  nextAvatarSlot = 0;
  updateLobby(players, 0);
});

socket.on('error-msg', ({ message }) => alert(message));

// ============================================================
// HELPERS
// ============================================================

function renderScoreboard(containerId, scores) {
  const el = document.getElementById(containerId);
  el.innerHTML = scores.map((s, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const medal = medals[i] || `#${i + 1}`;
    return `<div class="final-score-row">
      <span class="final-rank">${medal}</span>
      <span class="final-name">${esc(s.name)}</span>
      <span class="final-score-value">${s.score}</span>
    </div>`;
  }).join('');
}

function showQuiflotzAnimation() {
  const ov = document.getElementById('quiflotz-overlay');
  ov.classList.remove('hidden');
  playFartSound();
  setTimeout(() => ov.classList.add('hidden'), 3000);
}

function playFartSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

function playRoundCompleteMusic() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523, 587, 659, 698, 784, 880, 988, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.3);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.3);
    });
    setTimeout(() => playFartSound(), notes.length * 150 + 100);
  } catch (e) {}
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
