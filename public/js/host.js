const socket = io();

// ============================================================
// AVATAR SYSTEM — each player gets a character
// ============================================================
const AVATARS = [
  { name: 'תחת', img: '/assets/img/characters/char-0.png' }, // butt
  { name: 'ענן גז', img: '/assets/img/characters/char-1.png' }, // gas cloud
  { name: 'נייר טואלט', img: '/assets/img/characters/char-2.png' }, // toilet paper
  { name: 'קקי', img: '/assets/img/characters/char-3.png' }, // poop
  { name: 'אסלה', img: '/assets/img/characters/char-4.png' }, // toilet
  { name: 'פלאנג׳ר', img: '/assets/img/characters/char-5.png' }, // plunger
  { name: 'ספריי', img: '/assets/img/characters/char-6.png' }, // spray
  { name: 'נקניקיה', img: '/assets/img/characters/char-7.png' }, // sausage
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
  if (playerAvatarMap.has(playerId)) return playerAvatarMap.get(playerId);
  // Assign next available avatar
  const usedIndices = new Set(playerAvatarMap.values());
  for (let i = 0; i < 8; i++) {
    if (!usedIndices.has(i)) {
      playerAvatarMap.set(playerId, i);
      return i;
    }
  }
  // Fallback: use count-based
  const idx = playerAvatarMap.size % 8;
  playerAvatarMap.set(playerId, idx);
  return idx;
}

function avatarImg(index, cssClass) {
  const avatar = AVATARS[index % 8];
  return `<img src="${avatar.img}" alt="${avatar.name}" class="avatar-img ${cssClass || ''}" />`;
}

// ============================================================
// MUSIC SYSTEM
// ============================================================
const lobbyMusic = new Audio('/assets/lobby-music.mp3');
lobbyMusic.loop = true;
lobbyMusic.volume = 0.3;

const gameMusic = new Audio('/assets/game-music.mp3');
gameMusic.loop = true;
gameMusic.volume = 0.3;

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

  // Show persistent bar on all screens except splash and lobby
  const bar = document.getElementById('persistent-bar');
  if (bar) bar.style.display = (name === 'splash' || name === 'lobby') ? 'none' : 'flex';

  if (name === 'lobby') playMusic(lobbyMusic);
  else if (['writing'].includes(name)) playMusic(gameMusic);
  else if (name === 'round-complete') stopMusic();
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

// Persistent new game button
document.getElementById('btn-persistent-restart').addEventListener('click', () => {
  if (confirm('להתחיל משחק חדש?')) {
    socket.emit('restart-game');
  }
});

// ============================================================
// LOBBY — Circular wheel with 8 slots
// ============================================================
socket.on('player-joined', ({ players, spectatorCount }) => updateLobby(players, spectatorCount));
socket.on('player-left', ({ players, spectatorCount }) => updateLobby(players, spectatorCount));

function updateLobby(players, spectatorCount) {
  document.getElementById('player-count').textContent = players.length;

  // Assign avatars using getPlayerAvatarIndex (no duplicates)
  players.forEach(p => getPlayerAvatarIndex(p.id));

  // Update circle slots
  const slots = document.querySelectorAll('.circle-slot');
  slots.forEach((slot, i) => {
    const charEl = slot.querySelector('.circle-character');
    const labelEl = slot.querySelector('.circle-label');
    const nameEl = slot.querySelector('.circle-name');
    const player = players[i];

    if (player) {
      const avatarIdx = getPlayerAvatarIndex(player.id);
      const avatar = AVATARS[avatarIdx];
      charEl.innerHTML = `<img src="${avatar.img}" alt="${avatar.name}" class="avatar-img">`;
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

  players.forEach((p) => {
    const avatarIdx = getPlayerAvatarIndex(p.id);
    const avatar = AVATARS[avatarIdx];
    const el = document.createElement('div');
    el.className = 'floor-avatar breathing-slow';
    el.id = `floor-avatar-${p.id}`;
    el.dataset.playerId = p.id;
    el.innerHTML = `
      <div class="floor-avatar-character"><img src="${avatar.img}" alt="${avatar.name}" class="avatar-img"></div>
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
  // Max jump = 85% of viewport height (full screen range)
  const maxJump = 85;
  const jumpPercent = (timeRemaining / currentWriteTime) * maxJump;

  el.style.transform = `translateY(-${jumpPercent}vh)`;
  el.classList.add('finished');
  el.classList.remove('breathing-slow');
});

socket.on('writing-progress', ({ submitted, total }) => {
  document.getElementById('answer-progress').textContent = `${submitted}/${total}`;
});

// ============================================================
// SPLASH EVENTS (server-driven flow)
// ============================================================

socket.on('show-splash', ({ text, duration }) => {
  document.getElementById('splash-text-content').textContent = text;
  showScreen('splash-text');
  playMusic(gameMusic);
});

// Matchup prompt reveal (shown separately before voting)
socket.on('matchup-prompt-reveal', ({ promptText }) => {
  document.getElementById('reveal-prompt-text').textContent = promptText;
  showScreen('prompt-reveal');
});

// Matchup pause (brief pause between matchups — no numbering)
socket.on('matchup-pause', () => {
  document.getElementById('splash-text-content').textContent = '';
  showScreen('splash-text');
});

// ============================================================
// MATCHUP VOTING — answers appear (prompt already shown separately)
// ============================================================

socket.on('matchup-show', (data) => {
  showMatchupScreen(data);
});

function showMatchupScreen(data) {
  showScreen('matchup');
  document.getElementById('matchup-prompt').textContent = data.promptText;
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
  document.getElementById('result-name2').textContent = result.player2.name;

  const isDisqualified1 = result.player1.answer === '💨 אין תשובה' || result.player1.answer === '(no answer)';
  const isDisqualified2 = result.player2.answer === '💨 אין תשובה' || result.player2.answer === '(no answer)';

  document.getElementById('result-text1').textContent = isDisqualified1 ? '💨 פסול!' : result.player1.answer;
  document.getElementById('result-text2').textContent = isDisqualified2 ? '💨 פסול!' : result.player2.answer;
  document.getElementById('result-pts1').textContent = '+' + result.player1.points;
  document.getElementById('result-pts2').textContent = '+' + result.player2.points;
  document.getElementById('result-bar1').style.width = '0%';
  document.getElementById('result-bar2').style.width = '0%';

  // Hide percentages initially
  document.getElementById('result-pct1').classList.add('hidden');
  document.getElementById('result-pct2').classList.add('hidden');

  // Highlight winner / disqualified
  const left = document.getElementById('result-left');
  const right = document.getElementById('result-right');
  left.className = 'matchup-result-side left';
  right.className = 'matchup-result-side right';
  if (isDisqualified1) left.classList.add('disqualified');
  if (isDisqualified2) right.classList.add('disqualified');
  left.classList.toggle('winner', !isDisqualified1 && result.player1.points > result.player2.points);
  right.classList.toggle('winner', !isDisqualified2 && result.player2.points > result.player1.points);
  left.classList.toggle('quiflotz-glow', result.player1.quiflotz);
  right.classList.toggle('quiflotz-glow', result.player2.quiflotz);

  // Show voter avatars (immediately)
  showVoterAvatars('result-voters1', result.player1.voters);
  showVoterAvatars('result-voters2', result.player2.voters);

  // Show percentages after 2 seconds — but NOT for disqualified answers
  setTimeout(() => {
    const pct1El = document.getElementById('result-pct1');
    const pct2El = document.getElementById('result-pct2');

    if (!isDisqualified1 && !isDisqualified2) {
      pct1El.textContent = result.player1.percentage + '%';
      pct2El.textContent = result.player2.percentage + '%';
      pct1El.classList.remove('hidden');
      pct2El.classList.remove('hidden');
      pct1El.classList.add('pop-in');
      pct2El.classList.add('pop-in');
      document.getElementById('result-bar1').style.width = result.player1.percentage + '%';
      document.getElementById('result-bar2').style.width = result.player2.percentage + '%';
    } else if (isDisqualified1 && !isDisqualified2) {
      pct2El.textContent = '100%';
      pct2El.classList.remove('hidden');
      pct2El.classList.add('pop-in');
      document.getElementById('result-bar2').style.width = '100%';
    } else if (!isDisqualified1 && isDisqualified2) {
      pct1El.textContent = '100%';
      pct1El.classList.remove('hidden');
      pct1El.classList.add('pop-in');
      document.getElementById('result-bar1').style.width = '100%';
    }
    // Both disqualified — show nothing
  }, 2000);

  if (hasQuiflotz) {
    const ov = document.getElementById('quiflotz-overlay');
    ov.classList.remove('hidden');
    setTimeout(() => ov.classList.add('hidden'), 3000);
  }

  document.getElementById('btn-next-matchup').style.display = 'none';
});

function showVoterAvatars(containerId, voters) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!voters || voters.length === 0) {
    el.innerHTML = '';
    return;
  }

  // Track which voters we've already shown to avoid duplicates
  const shownIds = new Set();

  el.innerHTML = voters.map((voter, i) => {
    // Support both old format (string) and new format (object with id/name)
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter.replace(/ \(x\d+\)$/, '');

    // Skip duplicates
    if (voterId && shownIds.has(voterId)) return '';
    if (voterId) shownIds.add(voterId);

    // Get correct avatar for this voter
    const avatarIdx = voterId ? getPlayerAvatarIndex(voterId) : 0;
    const avatar = AVATARS[avatarIdx % 8];

    return `<div class="voter-avatar voter-avatar-lg" style="animation-delay: ${i * 0.2}s">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}</div>
    </div>`;
  }).filter(Boolean).join('');
}

document.getElementById('btn-next-matchup').addEventListener('click', () => {
  socket.emit('next-matchup');
});

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
  startCircleTimer('write-timer', voteTime);
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
  votersEl.innerHTML = r.voters.map((voter, i) => {
    const voterId = typeof voter === 'object' ? voter.id : null;
    const voterName = typeof voter === 'object' ? voter.name : voter.replace(/ \(x\d+\)$/, '');
    const count = typeof voter === 'object' ? voter.count : 1;
    const countBadge = count > 1 ? `<span class="voter-count">x${count}</span>` : '';
    const avatarIdx = voterId ? getPlayerAvatarIndex(voterId) : 0;
    const avatar = AVATARS[avatarIdx % 8];
    return `<div class="voter-avatar voter-avatar-lg" style="animation-delay: ${i * 0.2}s">
      <div class="voter-avatar-icon-lg"><img src="${avatar.img}" class="voter-char-img"></div>
      <div class="voter-avatar-name-lg">${esc(voterName)}${countBadge}</div>
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

  // Auto-advance is server-driven — hide manual button
  document.getElementById('btn-next-sub').style.display = 'none';
});

document.getElementById('btn-next-sub').addEventListener('click', () => {
  socket.emit('next-sub-round');
});

// ============================================================
// ROUND COMPLETE — show final scoreboard, then winner after 3s
// ============================================================
socket.on('round-complete', ({ mainRound, scores, winner }) => {
  showScreen('round-complete');
  renderScoreboard('round-final-scores', scores);

  // After 3 seconds, transition to winner announcement
  if (winner) {
    setTimeout(() => {
      showScreen('winner');
      stopMusic();

      const avatarIdx = getPlayerAvatarIndex(winner.id);
      const avatar = AVATARS[avatarIdx % 8];

      document.getElementById('winner-character-big').innerHTML =
        `<img src="${avatar.img}" alt="">`;
      document.getElementById('winner-name-big').textContent = winner.name;
      document.getElementById('winner-score-big').textContent = winner.score + ' נקודות';
    }, 3000);
  }
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

  // Quiplash-style: numbered blocks with characters on top, ALL players shown
  // Layout: top row (up to 4), bottom row (remaining)
  const topRow = scores.slice(0, 4);
  const bottomRow = scores.slice(4);

  let html = '<div class="score-grid">';

  // Top row
  html += '<div class="score-row-top">';
  topRow.forEach((s, i) => {
    html += renderScoreBlock(s, i, i * 0.15);
  });
  html += '</div>';

  // Bottom row
  if (bottomRow.length > 0) {
    html += '<div class="score-row-bottom">';
    bottomRow.forEach((s, i) => {
      html += renderScoreBlock(s, i + 4, (i + 4) * 0.15);
    });
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

function renderScoreBlock(s, rankIndex, delay) {
  const rank = rankIndex + 1;
  const avatarIdx = getPlayerAvatarIndex(s.id);
  const avatar = AVATARS[avatarIdx % 8];

  // Block colors based on rank
  const blockColors = [
    'linear-gradient(180deg, #4a90d9, #2563a0)', // 1st - blue
    'linear-gradient(180deg, #4a90d9, #2563a0)', // 2nd
    'linear-gradient(180deg, #4a90d9, #2563a0)', // 3rd
    'linear-gradient(180deg, #4a90d9, #2563a0)', // 4th
    'linear-gradient(180deg, #3a7abd, #1e5490)', // 5th
    'linear-gradient(180deg, #3a7abd, #1e5490)', // 6th
    'linear-gradient(180deg, #3a7abd, #1e5490)', // 7th
    'linear-gradient(180deg, #3a7abd, #1e5490)', // 8th
  ];
  const isTopRow = rankIndex < 4;
  const blockSize = isTopRow ? 'large' : 'small';

  return `<div class="score-block score-block-${blockSize}" style="animation-delay: ${delay}s">
    <div class="score-block-rank">${rank}</div>
    <div class="score-block-character">
      <img src="${avatar.img}" alt="" class="score-block-avatar breathing">
    </div>
    <div class="score-block-info">
      <div class="score-block-name">${esc(s.name)}</div>
      <div class="score-block-points">${s.score}</div>
    </div>
  </div>`;
}

// Sound effects removed — music tracks only

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
