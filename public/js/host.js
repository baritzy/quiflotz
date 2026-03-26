const socket = io();

// --- Screen management ---
const screens = {};
document.querySelectorAll('.screen').forEach(s => { screens[s.id.replace('screen-', '')] = s; });
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

// --- Room creation ---
socket.emit('create-room', (res) => {
  if (res.success) {
    document.getElementById('room-code').textContent = res.roomCode;
    // Show the actual URL for players
    const url = window.location.origin;
    document.getElementById('join-url').textContent = url;
  }
});

// --- Lobby ---
socket.on('player-joined', ({ players, spectatorCount }) => {
  updateLobby(players, spectatorCount);
});
socket.on('player-left', ({ players, spectatorCount }) => {
  updateLobby(players, spectatorCount);
});

function updateLobby(players, spectatorCount) {
  const grid = document.getElementById('players-grid');
  document.getElementById('player-count').textContent = players.length;
  const emojis = ['🍑', '💨', '🤡', '💀', '🐒', '🤪', '👻', '🦄'];
  grid.innerHTML = players.map((p, i) => `
    <div class="player-card${p.connected ? '' : ' disconnected'}">
      <span class="player-emoji">${emojis[i % emojis.length]}</span>
      <span class="player-name">${esc(p.name)}</span>
    </div>
  `).join('');
  document.getElementById('btn-start').disabled = players.length < 3;

  const info = document.getElementById('spectator-info');
  if (spectatorCount > 0) {
    info.style.display = 'block';
    document.getElementById('spectator-count').textContent = spectatorCount;
  } else {
    info.style.display = 'none';
  }
}

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start-game');
});

// --- Sub-round start (writing phase, rounds 1 & 2) ---
socket.on('sub-round-start', ({ subRound, multiplier, matchupCount, writeTime }) => {
  showScreen('writing');
  document.getElementById('write-sub').textContent = subRound;
  document.getElementById('write-multiplier').textContent = `x${multiplier}`;
  document.getElementById('answer-progress').textContent = `0/${matchupCount * 2}`;
  startTimer('write-timer-bar', writeTime);
  animateFart();
});

socket.on('writing-progress', ({ submitted, total }) => {
  document.getElementById('answer-progress').textContent = `${submitted}/${total}`;
  // Also update final write if visible
  document.getElementById('final-write-progress').textContent = `${submitted}/${total}`;
});

// --- Matchup show (1v1) ---
socket.on('matchup-show', ({ index, total, promptText, answer1, answer2, voteTime, subRound, multiplier }) => {
  showScreen('matchup');
  document.getElementById('matchup-num').textContent = index + 1;
  document.getElementById('matchup-total').textContent = total;
  document.getElementById('matchup-prompt').textContent = promptText;
  document.getElementById('matchup-multiplier').textContent = `x${multiplier}`;
  document.getElementById('matchup-a1-text').textContent = answer1;
  document.getElementById('matchup-a2-text').textContent = answer2;
  document.getElementById('matchup-vote-count').textContent = '0';

  // Animate answers appearing
  document.getElementById('matchup-a1').className = 'matchup-answer left pop-in';
  document.getElementById('matchup-a2').className = 'matchup-answer right pop-in';

  startTimer('matchup-timer-bar', voteTime);
});

socket.on('matchup-vote-progress', ({ count }) => {
  document.getElementById('matchup-vote-count').textContent = count;
});

// --- Matchup result ---
socket.on('matchup-result', ({ result, hasQuiflotz, matchupIndex, totalMatchups, isLastMatchup }) => {
  showScreen('matchup-result');

  document.getElementById('result-prompt').textContent = result.prompt.text;
  document.getElementById('result-name1').textContent = result.player1.name;
  document.getElementById('result-text1').textContent = result.player1.answer;
  document.getElementById('result-pct1').textContent = result.player1.percentage + '%';
  document.getElementById('result-pts1').textContent = '+' + result.player1.points;
  document.getElementById('result-bar1').style.width = result.player1.percentage + '%';

  document.getElementById('result-name2').textContent = result.player2.name;
  document.getElementById('result-text2').textContent = result.player2.answer;
  document.getElementById('result-pct2').textContent = result.player2.percentage + '%';
  document.getElementById('result-pts2').textContent = '+' + result.player2.points;
  document.getElementById('result-bar2').style.width = result.player2.percentage + '%';

  // Highlight winner
  const left = document.getElementById('result-left');
  const right = document.getElementById('result-right');
  left.classList.toggle('winner', result.player1.points > result.player2.points);
  right.classList.toggle('winner', result.player2.points > result.player1.points);
  left.classList.toggle('quiflotz-glow', result.player1.quiflotz);
  right.classList.toggle('quiflotz-glow', result.player2.quiflotz);

  if (hasQuiflotz) showQuiflotzAnimation();

  const btn = document.getElementById('btn-next-matchup');
  btn.textContent = isLastMatchup ? 'טבלת ניקוד ➡️' : 'הבא ➡️';
});

document.getElementById('btn-next-matchup').addEventListener('click', () => {
  socket.emit('next-matchup');
});

// --- Final round (sub-round 3) ---
socket.on('final-round-start', ({ prompt, writeTime }) => {
  showScreen('final-write');
  document.getElementById('final-prompt-text').textContent = prompt.text;
  document.getElementById('final-write-progress').textContent = '0/0';
  startTimer('final-write-timer', writeTime);
});

socket.on('final-voting-start', ({ prompt, answers, voteTime }) => {
  showScreen('final-vote');
  document.getElementById('final-vote-prompt').textContent = prompt.text;
  document.getElementById('final-vote-count').textContent = '0';

  const grid = document.getElementById('final-answers-grid');
  grid.innerHTML = answers.map((a, i) => `
    <div class="final-answer-card" style="animation-delay: ${i * 0.15}s">
      <div class="final-answer-text">${esc(a.text)}</div>
    </div>
  `).join('');

  startTimer('final-vote-timer', voteTime);
});

socket.on('final-vote-progress', ({ count }) => {
  document.getElementById('final-vote-count').textContent = count;
});

socket.on('final-round-result', ({ prompt, results, scores }) => {
  showScreen('final-result');
  document.getElementById('final-result-prompt').textContent = prompt.text;

  const list = document.getElementById('final-results-list');
  list.innerHTML = results.map((r, i) => {
    const medal = i === 0 ? '👑 ' : '';
    const qBadge = r.quiflotz ? '<span class="quiflotz-badge">💨 QUIFLOTZ!</span>' : '';
    return `<div class="result-card${r.quiflotz ? ' quiflotz-winner' : ''}" style="animation-delay: ${i * 0.2}s">
      <div class="result-header">
        <span class="result-name">${medal}${esc(r.playerName)}</span>
        <span class="result-score">+${r.points}</span>
      </div>
      <div class="result-answer">${esc(r.text)}</div>
      ${qBadge}
      ${r.voters.length ? `<div class="result-voters">הצביעו: ${r.voters.map(n => esc(n)).join(', ')}</div>` : ''}
    </div>`;
  }).join('');
});

document.getElementById('btn-after-final').addEventListener('click', () => {
  socket.emit('next-sub-round');
});

// --- Scoreboard ---
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

// --- Round complete ---
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

document.getElementById('btn-new-round').addEventListener('click', () => {
  socket.emit('new-round');
});
document.getElementById('btn-back-lobby').addEventListener('click', () => {
  socket.emit('restart-game');
});

socket.on('game-restarted', ({ players }) => {
  showScreen('lobby');
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

function startTimer(barId, seconds) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.style.transition = 'none';
  bar.style.width = '100%';
  bar.offsetHeight;
  bar.style.transition = `width ${seconds}s linear`;
  bar.style.width = '0%';
}

let fartInterval;
function animateFart() {
  clearInterval(fartInterval);
  const fart = document.getElementById('waiting-fart');
  let pos = 0;
  fartInterval = setInterval(() => {
    pos += 2;
    fart.style.transform = `translateX(${Math.sin(pos / 10) * 50}px) rotate(${pos * 2}deg)`;
  }, 50);
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
    const notes = [523, 587, 659, 698, 784, 880, 988, 1047]; // C5 to C6
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
    // Final fart
    setTimeout(() => playFartSound(), notes.length * 150 + 100);
  } catch (e) {}
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
