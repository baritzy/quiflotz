const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 60000
});
let myName = sessionStorage.getItem('q_name') || '';
let isSpectator = false;
let myRoomCode = sessionStorage.getItem('q_room') || '';
let myPersistentId = sessionStorage.getItem('q_pid') || ('p_' + Math.random().toString(36).substr(2, 9));
sessionStorage.setItem('q_pid', myPersistentId);

// Auto-rejoin room after reconnection or page refresh
socket.on('connect', () => {
  if (myName && myRoomCode) {
    socket.emit('join-room', { roomCode: myRoomCode, playerName: myName, persistentId: myPersistentId }, (res) => {
      if (res.success) {
        isSpectator = res.isSpectator;
        console.log(res.reconnected ? 'Reconnected to game' : 'Rejoined room');
        document.getElementById('display-name').textContent = myName;
        document.getElementById('waiting-role').textContent = isSpectator ? '👀 צופה — תוכל להצביע!' : '🎮 שחקן';
        // If game is in progress, show waiting screen
        if (res.gameState === 'playing') {
          showScreen('between');
        } else {
          showScreen('waiting');
        }
      }
    });
  }
});

// --- Screen management ---
const screens = {};
document.querySelectorAll('.screen').forEach(s => { screens[s.id.replace('screen-', '')] = s; });
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

// --- Join ---
document.getElementById('input-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});
document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('input-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
document.getElementById('input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('input-name').focus();
});

function joinRoom() {
  const code = document.getElementById('input-code').value.trim();
  const name = document.getElementById('input-name').value.trim();
  if (!code || code.length !== 4) return showError('צריך קוד חדר (4 אותיות)');
  if (!name) return showError('מה השם שלך?');

  myName = name;
  socket.emit('join-room', { roomCode: code, playerName: name, persistentId: myPersistentId }, (res) => {
    if (res.success) {
      isSpectator = res.isSpectator;
      myRoomCode = res.roomCode;
      sessionStorage.setItem('q_name', myName);
      sessionStorage.setItem('q_room', myRoomCode);
      document.getElementById('display-name').textContent = name;
      document.getElementById('waiting-role').textContent = isSpectator ? '👀 צופה — תוכל להצביע!' : '🎮 שחקן';
      showScreen('waiting');
    } else {
      showError(res.error);
    }
  });
}

function showError(msg) {
  const el = document.getElementById('join-error');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ============================================================
// SUB-ROUNDS 1 & 2: Writing 2 prompts
// ============================================================

// Sequential prompt handling: show one prompt at a time
let currentPrompts = [];
let currentPromptIndex = 0;
let collectedAnswers = [];
let writeTimerEnd = 0;
let writeTimerInterval = null;

socket.on('your-prompts', ({ subRound, multiplier, prompts, writeTime }) => {
  showScreen('write-prompts');
  document.getElementById('p-sub-round').textContent = subRound;
  document.getElementById('p-multiplier').textContent = `x${multiplier}`;

  currentPrompts = prompts;
  currentPromptIndex = 0;
  collectedAnswers = [];
  writeTimerEnd = Date.now() + writeTime * 1000;

  showCurrentPrompt();
  startCountdown('p-write-timer', writeTime);
});

function showCurrentPrompt() {
  const p = currentPrompts[currentPromptIndex];
  if (!p) return;

  const container = document.getElementById('prompts-container');
  container.innerHTML = `
    <div class="prompt-counter">${currentPromptIndex + 1}/${currentPrompts.length}</div>
    <div class="prompt-card mobile">
      <div class="prompt-text">${esc(p.promptText)}</div>
    </div>
    <input type="text" class="input-answer" placeholder="Write your answer..."
      maxlength="25" autocomplete="off" dir="ltr"
      data-matchup="${p.matchupIndex}" id="current-answer">
    <div class="char-warning" id="char-warning" style="display:none">הגעת למספר מירבי של תווים</div>
  `;

  const input = document.getElementById('current-answer');
  input.addEventListener('input', () => {
    const warn = document.getElementById('char-warning');
    if (input.value.length >= 25) {
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  });

  setTimeout(() => input?.focus(), 100);
}

document.getElementById('btn-submit-answers').addEventListener('click', submitCurrentAnswer);

function submitCurrentAnswer() {
  const input = document.getElementById('current-answer');
  if (!input) return;
  const text = input.value.trim();
  const matchupIndex = parseInt(input.dataset.matchup);

  // Send each answer immediately to the server
  if (text) {
    collectedAnswers.push({ matchupIndex, text });
    socket.emit('submit-answers', { answers: [{ matchupIndex, text }] });
  }

  currentPromptIndex++;

  if (currentPromptIndex < currentPrompts.length) {
    // Show next prompt
    showCurrentPrompt();
  } else {
    // All prompts done
    showScreen('submitted');
    clearInterval(writeTimerInterval);
  }
}

// Allow Enter to submit
document.getElementById('prompts-container')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCurrentAnswer();
});

// ============================================================
// MATCHUP VOTING (1v1)
// ============================================================

socket.on('matchup-vote', ({ promptText, answer1, answer2, isMyMatchup, autoResolve, noAnswer1, noAnswer2, voteTime }) => {
  if (isMyMatchup || autoResolve) {
    showScreen(isMyMatchup ? 'matchup-watch' : 'between');
    return;
  }

  showScreen('matchup-vote');
  document.getElementById('p-matchup-prompt').textContent = promptText;

  const area = document.getElementById('matchup-vote-area');
  area.innerHTML = `
    <button class="vote-card-1v1 clickable" data-choice="1">
      <div class="vote-answer">${esc(answer1)}</div>
    </button>
    <div class="vote-vs">VS</div>
    <button class="vote-card-1v1 clickable" data-choice="2">
      <div class="vote-answer">${esc(answer2)}</div>
    </button>
  `;

  area.querySelectorAll('.vote-card-1v1.clickable').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('submit-matchup-vote', { choice: parseInt(btn.dataset.choice) });
      showScreen('voted');
    });
  });
});

// After matchup result, go to between screen
socket.on('matchup-result', () => {
  showScreen('between');
});

// ============================================================
// FINAL ROUND (Sub-round 3)
// ============================================================

socket.on('final-write-prompt', ({ prompt, writeTime }) => {
  showScreen('final-write');
  document.getElementById('p-final-prompt').textContent = prompt.text;
  const finalInput = document.getElementById('input-final-answer');
  finalInput.value = '';
  finalInput.addEventListener('input', () => {
    const warn = document.getElementById('final-char-warning');
    if (finalInput.value.length >= 25) {
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  });
  setTimeout(() => finalInput?.focus(), 100);
  startGenericCountdown('p-final-write-timer', writeTime, true);
});

document.getElementById('btn-submit-final').addEventListener('click', () => {
  const answer = document.getElementById('input-final-answer').value.trim();
  if (!answer) return;
  socket.emit('submit-final-answer', { answer });
  showScreen('submitted');
});

document.getElementById('input-final-answer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-submit-final').click();
});

// --- Final voting: 3 votes to distribute ---

let voteAllocations = {}; // answerId → count
let votesRemaining = 3;

socket.on('final-vote-options', ({ prompt, answers, voteTime }) => {
  showScreen('final-vote');
  voteAllocations = {};
  votesRemaining = 3;
  updateVotesUI();

  const list = document.getElementById('final-vote-list');
  list.innerHTML = answers.map(a => {
    if (a.isMine) {
      return `<div class="final-vote-card mine">
        <div class="vote-answer">${esc(a.text)}</div>
        <div class="vote-mine-label">התשובה שלך 🍑</div>
      </div>`;
    }
    return `<div class="final-vote-card clickable" data-id="${a.id}">
      <div class="vote-answer">${esc(a.text)}</div>
      <div class="vote-controls">
        <button class="vote-minus" data-id="${a.id}">-</button>
        <span class="vote-count" id="vc-${a.id}">0</span>
        <button class="vote-plus" data-id="${a.id}">+</button>
      </div>
    </div>`;
  }).join('');

  // Add/remove vote handlers
  list.querySelectorAll('.vote-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (votesRemaining <= 0) return;
      voteAllocations[id] = (voteAllocations[id] || 0) + 1;
      votesRemaining--;
      updateVotesUI();
    });
  });

  list.querySelectorAll('.vote-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!voteAllocations[id] || voteAllocations[id] <= 0) return;
      voteAllocations[id]--;
      votesRemaining++;
      if (voteAllocations[id] === 0) delete voteAllocations[id];
      updateVotesUI();
    });
  });

  startGenericCountdown('p-final-vote-timer', voteTime);
});

function updateVotesUI() {
  document.getElementById('votes-left').textContent = votesRemaining;

  // Update all counters
  document.querySelectorAll('.vote-count').forEach(el => {
    const id = el.id.replace('vc-', '');
    el.textContent = voteAllocations[id] || 0;
  });

  // Enable submit only when all 3 votes are used
  document.getElementById('btn-submit-final-votes').disabled = votesRemaining > 0;
}

document.getElementById('btn-submit-final-votes').addEventListener('click', () => {
  if (votesRemaining > 0) return;
  socket.emit('submit-final-votes', { votes: voteAllocations });
  showScreen('voted');
});

// ============================================================
// SCOREBOARD & ROUND COMPLETE
// ============================================================

socket.on('scoreboard', ({ scores }) => {
  showScreen('scoreboard');
  const board = document.getElementById('mobile-scoreboard');
  board.innerHTML = scores.map((s, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const medal = medals[i] || `#${i + 1}`;
    const isMe = s.name === myName ? ' is-me' : '';
    return `<div class="mobile-board-row${isMe}">
      <span>${medal} ${esc(s.name)}</span>
      <span>${s.score}</span>
    </div>`;
  }).join('');
});

socket.on('round-complete', ({ scores, winner }) => {
  showScreen('round-complete');
  const content = document.getElementById('mobile-round-result');
  let html = '';
  if (winner) {
    html += `<div class="mobile-winner"><h2>👑 ${esc(winner.name)}</h2><p>${winner.score} נקודות</p></div>`;
  }
  const myScore = scores.find(s => s.name === myName);
  if (myScore) {
    html += `<div class="mobile-my-rank"><p>מקום ${myScore.rank}</p><p class="mobile-my-final-score">${myScore.score} נקודות</p></div>`;
  }
  content.innerHTML = html;
});

socket.on('final-round-result', () => {
  showScreen('between');
});

// ============================================================
// SPECTATOR EVENTS
// ============================================================

socket.on('spectator-writing', ({ subRound }) => {
  showScreen('spectator');
  document.getElementById('spectator-status').textContent = `סיבוב ${subRound}/3 — השחקנים כותבים...`;
});

socket.on('spectator-final-writing', ({ prompt }) => {
  showScreen('spectator');
  document.getElementById('spectator-status').textContent = `🔥 סיבוב אחרון! השחקנים כותבים...`;
});

// Spectators can vote on matchups too
// (matchup-vote event handles this — isMyMatchup will be false for spectators)

// ============================================================
// MISC
// ============================================================

socket.on('show-splash', ({ text }) => {
  showScreen('between');
  const hint = document.querySelector('#screen-between .waiting-hint');
  if (hint) hint.textContent = text;
});

socket.on('matchup-pause', () => showScreen('between'));
socket.on('matchup-prompt-reveal', () => showScreen('between'));

socket.on('game-restarted', () => showScreen('waiting'));
socket.on('host-left', () => {
  // [BUG #12] Clear session storage so player doesn't auto-rejoin dead room
  sessionStorage.removeItem('q_name');
  sessionStorage.removeItem('q_room');
  sessionStorage.removeItem('q_pid');
  alert('ה-Host עזב 😢');
  showScreen('join');
});

function startCountdown(timerId, seconds) {
  clearInterval(writeTimerInterval);
  const el = document.getElementById(timerId);
  if (!el) return;

  let remaining = seconds;
  el.innerHTML = createCircleTimer(remaining, seconds, true);

  writeTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(writeTimerInterval);
      remaining = 0;
      // Auto-submit current answer if player is still writing
      if (collectedAnswers.length < currentPrompts.length) {
        const input = document.getElementById('current-answer');
        if (input && input.value.trim()) {
          const text = input.value.trim();
          const matchupIndex = parseInt(input.dataset.matchup);
          socket.emit('submit-answers', { answers: [{ matchupIndex, text }] });
        }
        showScreen('submitted');
      }
    }
    el.innerHTML = createCircleTimer(remaining, seconds, true);
  }, 1000);
}

function startGenericCountdown(timerId, seconds, isWritePhase) {
  const el = document.getElementById(timerId);
  if (!el) return;
  let remaining = seconds;
  el.innerHTML = createCircleTimer(remaining, seconds, isWritePhase);
  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(iv); remaining = 0; }
    el.innerHTML = createCircleTimer(remaining, seconds, isWritePhase);
  }, 1000);
}

function createCircleTimer(remaining, total, isWritePhase) {
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const deg = (pct / 100) * 360;
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

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
