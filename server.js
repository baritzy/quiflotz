const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameEngine } = require('./game-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

const rooms = new Map();
const engine = new GameEngine();

let prompts = [];
try {
  prompts = require('./prompts.json').prompts;
  console.log(`Loaded ${prompts.length} prompts`);
} catch (e) {
  console.error('Could not load prompts.json:', e.message);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

// ============================================================
// SOCKET HANDLERS
// ============================================================

io.on('connection', (socket) => {

  // --- Room management ---

  socket.on('create-room', (callback) => {
    const code = generateRoomCode();
    const room = engine.createRoom(code, socket.id);
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    console.log(`Room ${code} created`);
    callback({ success: true, roomCode: code });
  });

  socket.on('join-room', ({ roomCode, playerName }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return callback({ success: false, error: 'החדר לא נמצא. בדוק את הקוד.' });

    const activeCount = engine.getActivePlayers(room).length;
    const isSpectator = activeCount >= 8 || room.state !== 'lobby';

    const player = {
      id: socket.id,
      name: playerName.trim().substring(0, 20),
      score: 0,
      isSpectator,
      connected: true
    };

    room.players.set(socket.id, player);
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = false;

    callback({ success: true, isSpectator, roomCode: code, gameState: room.state });

    io.to(room.hostId).emit('player-joined', {
      players: engine.getPlayerList(room),
      spectatorCount: engine.getSpectators(room).length
    });
  });

  // --- Game start ---

  socket.on('start-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (engine.getActivePlayers(room).length < 3) {
      socket.emit('error-msg', { message: 'צריך לפחות 3 שחקנים כדי להתחיל!' });
      return;
    }

    room.state = 'playing';
    room.mainRound++;
    room.settings.writeTime = 90;
    room.settings.finalWriteTime = 45;
    // Show round splash, then start
    showSplashThenDo(room, `סיבוב 1`, 5000, () => startSubRound(room, 1));
  });

  // --- Sub-round answer submission (rounds 1 & 2) ---

  socket.on('submit-answers', ({ answers }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'writing') return;
    const player = room.players.get(socket.id);
    if (!player || player.isSpectator) return;

    answers.forEach(({ matchupIndex, text }) => {
      engine.submitMatchupAnswer(room, socket.id, matchupIndex, text.trim().substring(0, 25));
    });

    // Check if this player finished all their prompts
    const playerProgress = engine.getPlayerAnswerCount(room, socket.id);
    if (playerProgress.submitted >= playerProgress.total) {
      const player = room.players.get(socket.id);
      const elapsed = Math.floor((Date.now() - (room.writeStartTime || Date.now())) / 1000);
      const timeRemaining = room.settings.writeTime - elapsed;
      io.to(room.hostId).emit('player-finished-writing', {
        playerId: socket.id,
        playerName: player ? player.name : '?',
        timeRemaining: Math.max(0, timeRemaining)
      });
    }

    // Notify host of progress
    const progress = engine.getTotalAnswerProgress(room);
    io.to(room.hostId).emit('writing-progress', progress);

    // If all submitted, skip timer
    if (engine.allAnswersSubmitted(room)) {
      skipToMatchups(room);
    }
  });

  // --- Matchup vote (rounds 1 & 2) ---

  socket.on('submit-matchup-vote', ({ choice }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    // Accept votes during voting phase AND briefly during result phase (race condition grace)
    if (room.phase !== 'matchup-vote' && room.phase !== 'matchup-result') return;

    const matchup = engine.getCurrentMatchup(room);
    if (!matchup || matchup.result) return; // Already resolved, too late

    engine.submitMatchupVote(room, socket.id, choice);

    // Count votes
    const eligible = Array.from(room.players.values())
      .filter(p => p.connected && p.id !== matchup.player1.id && p.id !== matchup.player2.id).length;

    io.to(room.hostId).emit('matchup-vote-progress', {
      count: matchup.votes.size,
      total: eligible
    });

    if (room.phase === 'matchup-vote' && matchup.votes.size >= eligible) {
      clearTimeout(room.timer);
      showMatchupResult(room);
    }
  });

  // --- Host advances (kept for backward compat but flow is now auto-driven) ---

  socket.on('next-matchup', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    advanceAfterMatchup(room);
  });

  socket.on('next-sub-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    advanceToNextSubRound(room);
  });

  // --- Final round (sub-round 3) ---

  socket.on('submit-final-answer', ({ answer }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'final-write') return;

    engine.submitFinalAnswer(room, socket.id, answer.trim().substring(0, 25));

    const player = room.players.get(socket.id);
    const elapsed = Math.floor((Date.now() - (room.writeStartTime || Date.now())) / 1000);
    const writeTime = room.settings.finalWriteTime || 45;
    const timeRemaining = writeTime - elapsed;
    io.to(room.hostId).emit('player-finished-writing', {
      playerId: socket.id,
      playerName: player ? player.name : '?',
      timeRemaining: Math.max(0, timeRemaining)
    });

    const activePlayers = engine.getActivePlayers(room);
    const submitted = room.finalAnswers.size;
    io.to(room.hostId).emit('writing-progress', { submitted, total: activePlayers.length });

    // Round 3: wait for ALL players before starting vote
    if (submitted >= activePlayers.length) {
      clearTimeout(room.timer);
      showSplashThenDo(room, 'כולם ענו! בואו נראה מה הצבעתם', 3000, () => startFinalVoting(room));
    }
  });

  socket.on('submit-final-votes', ({ votes }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'final-vote') return;

    engine.submitFinalVotes(room, socket.id, votes);

    const eligible = Array.from(room.players.values()).filter(p => p.connected).length;
    io.to(room.hostId).emit('final-vote-progress', {
      count: room.finalVotes.size,
      total: eligible
    });

    if (room.finalVotes.size >= eligible) {
      clearTimeout(room.timer);
      showFinalResult(room);
    }
  });

  // --- New main round ---

  socket.on('new-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    room.mainRound++;
    startSubRound(room, 1);
  });

  socket.on('restart-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    engine.resetRoom(room);
    io.to(socket.roomCode).emit('game-restarted', { players: engine.getPlayerList(room) });
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    if (socket.isHost) {
      io.to(socket.roomCode).emit('host-left');
      rooms.delete(socket.roomCode);
    } else {
      const player = room.players.get(socket.id);
      if (player) {
        player.connected = false;
        io.to(room.hostId).emit('player-left', {
          playerName: player.name,
          players: engine.getPlayerList(room),
          spectatorCount: engine.getSpectators(room).length
        });
      }
    }
  });
});

// ============================================================
// GAME FLOW FUNCTIONS — Fully automated with splashes & timings
// ============================================================

function showSplashThenDo(room, text, duration, callback) {
  room.phase = 'splash';
  io.to(room.code).emit('show-splash', { text, duration });
  room.timer = setTimeout(callback, duration);
}

function startSubRound(room, subRoundNum) {
  room.subRound = subRoundNum;
  room.multiplier = subRoundNum;

  if (subRoundNum <= 2) {
    room.phase = 'writing';
    engine.generateMatchups(room, prompts);
    room.writeStartTime = Date.now();

    const activePlayers = engine.getActivePlayers(room);
    io.to(room.hostId).emit('sub-round-start', {
      mainRound: room.mainRound,
      subRound: subRoundNum,
      multiplier: room.multiplier,
      matchupCount: room.matchups.length,
      writeTime: room.settings.writeTime,
      players: activePlayers.map((p, i) => ({ id: p.id, name: p.name, index: i }))
    });

    engine.getActivePlayers(room).forEach(p => {
      const playerPrompts = engine.getPlayerPrompts(room, p.id);
      io.to(p.id).emit('your-prompts', {
        subRound: subRoundNum,
        multiplier: room.multiplier,
        prompts: playerPrompts,
        writeTime: room.settings.writeTime
      });
    });

    engine.getSpectators(room).forEach(p => {
      io.to(p.id).emit('spectator-writing', { subRound: subRoundNum, multiplier: room.multiplier });
    });

    room.timer = setTimeout(() => {
      // "נגמר הזמן" splash then start matchups
      showSplashThenDo(room, 'נגמר הזמן!', 3000, () => beginMatchupSequence(room));
    }, room.settings.writeTime * 1000);

  } else {
    room.phase = 'final-write';
    engine.setupFinalRound(room, prompts);
    room.writeStartTime = Date.now();
    const writeTime = room.settings.finalWriteTime || 45;
    const activePlayersList = engine.getActivePlayers(room);
    const data = {
      mainRound: room.mainRound,
      subRound: 3,
      multiplier: 3,
      prompt: room.finalPrompt,
      writeTime,
      players: activePlayersList.map((p, i) => ({ id: p.id, name: p.name, index: i }))
    };

    io.to(room.hostId).emit('final-round-start', data);
    engine.getActivePlayers(room).forEach(p => io.to(p.id).emit('final-write-prompt', data));
    engine.getSpectators(room).forEach(p => io.to(p.id).emit('spectator-final-writing', data));

    room.timer = setTimeout(() => {
      showSplashThenDo(room, 'נגמר הזמן!', 3000, () => startFinalVoting(room));
    }, writeTime * 1000);
  }
}

// Called when all answers submitted early
function skipToMatchups(room) {
  clearTimeout(room.timer);
  showSplashThenDo(room, 'כולם ענו! יאללה...', 2000, () => beginMatchupSequence(room));
}

function beginMatchupSequence(room) {
  room.currentMatchupIndex = 0;
  startNextMatchup(room);
}

function startNextMatchup(room) {
  const matchup = engine.getCurrentMatchup(room);
  if (!matchup) {
    // All matchups done — show scoreboard
    showSplashThenDo(room, 'בואו נראה את התוצאות עד כה', 3000, () => showScoreboard(room));
    return;
  }

  // 3 second pause before each matchup
  room.phase = 'matchup-pause';
  io.to(room.code).emit('matchup-pause', { index: matchup.index, total: room.matchups.length });

  room.timer = setTimeout(() => {
    // Show prompt big for 7 seconds
    room.phase = 'matchup-prompt-reveal';
    io.to(room.code).emit('matchup-prompt-reveal', {
      promptText: matchup.prompt.text,
      index: matchup.index,
      total: room.matchups.length
    });

    room.timer = setTimeout(() => {
      startMatchupVoting(room);
    }, 7000);
  }, 3000);
}

function startMatchupVoting(room) {
  room.phase = 'matchup-vote';
  const matchup = engine.getCurrentMatchup(room);
  if (!matchup) return;

  const a1 = matchup.player1.answer;
  const a2 = matchup.player2.answer;
  const noAnswer1 = !a1;
  const noAnswer2 = !a2;

  if (noAnswer1 || noAnswer2) {
    const data = {
      index: matchup.index, total: room.matchups.length,
      promptText: matchup.prompt.text,
      answer1: a1 || '💨 אין תשובה', answer2: a2 || '💨 אין תשובה',
      noAnswer1, noAnswer2, autoResolve: true, voteTime: 0,
      subRound: room.subRound, multiplier: room.multiplier
    };
    io.to(room.hostId).emit('matchup-show', data);
    room.players.forEach((player, id) => {
      if (!player.connected) return;
      io.to(id).emit('matchup-vote', { ...data, isMyMatchup: matchup.player1.id === id || matchup.player2.id === id });
    });
    room.timer = setTimeout(() => {
      engine.autoResolveMatchup(room, noAnswer1, noAnswer2);
      showMatchupResult(room);
    }, 2000);
    return;
  }

  const data = {
    index: matchup.index, total: room.matchups.length,
    promptText: matchup.prompt.text,
    answer1: a1, answer2: a2,
    noAnswer1: false, noAnswer2: false, autoResolve: false,
    voteTime: room.settings.matchupVoteTime,
    subRound: room.subRound, multiplier: room.multiplier
  };

  io.to(room.hostId).emit('matchup-show', data);
  room.players.forEach((player, id) => {
    if (!player.connected) return;
    io.to(id).emit('matchup-vote', { ...data, isMyMatchup: matchup.player1.id === id || matchup.player2.id === id });
  });

  room.timer = setTimeout(() => {
    setTimeout(() => showMatchupResult(room), 1500);
  }, room.settings.matchupVoteTime * 1000);
}

function showMatchupResult(room) {
  clearTimeout(room.timer);
  room.phase = 'matchup-result';
  const result = engine.resolveMatchup(room);
  if (!result) return;

  const hasQuiflotz = result.player1.quiflotz || result.player2.quiflotz;

  const data = {
    result, hasQuiflotz,
    matchupIndex: room.currentMatchupIndex,
    totalMatchups: room.matchups.length,
    isLastMatchup: room.currentMatchupIndex >= room.matchups.length - 1,
    scores: engine.getScoreboard(room)
  };

  io.to(room.code).emit('matchup-result', data);

  // Show "בואו נראה מה כולם הצביעו" splash, then voter reveal, then auto-advance
  const splashTime = 2000;
  const voterRevealTime = 2000;
  const percentageTime = 2000;
  const quiflotzTime = hasQuiflotz ? 2500 : 0;

  // Auto-advance to next matchup after display
  room.timer = setTimeout(() => {
    advanceAfterMatchup(room);
  }, splashTime + voterRevealTime + percentageTime + quiflotzTime + 1500);
}

function advanceAfterMatchup(room) {
  clearTimeout(room.timer);
  if (engine.nextMatchup(room)) {
    startNextMatchup(room);
  } else {
    showSplashThenDo(room, 'בואו נראה את התוצאות עד כה', 3000, () => showScoreboard(room));
  }
}

function startFinalVoting(room) {
  room.phase = 'final-vote';
  const answers = Array.from(room.finalAnswers.values());
  const shuffled = answers.sort(() => Math.random() - 0.5);

  const hostData = {
    prompt: room.finalPrompt,
    answers: shuffled.map(a => ({ id: a.playerId, text: a.text })),
    voteTime: room.settings.finalVoteTime
  };

  io.to(room.hostId).emit('final-voting-start', hostData);

  room.players.forEach((player, id) => {
    if (!player.connected) return;
    io.to(id).emit('final-vote-options', {
      prompt: room.finalPrompt,
      answers: shuffled.map(a => ({ id: a.playerId, text: a.text, isMine: a.playerId === id })),
      voteTime: room.settings.finalVoteTime
    });
  });

  room.timer = setTimeout(() => showFinalResult(room), room.settings.finalVoteTime * 1000);
}

function showFinalResult(room) {
  clearTimeout(room.timer);
  room.phase = 'final-result';
  const results = engine.resolveFinalRound(room);

  io.to(room.code).emit('final-round-result', {
    prompt: room.finalPrompt,
    results,
    scores: engine.getScoreboard(room)
  });

  // Auto-advance: final reveal takes ~5s per answer + extra time
  const revealCount = results.filter(r => r.points > 0).length || 1;
  const totalRevealTime = revealCount * 5500 + 3000;
  room.timer = setTimeout(() => {
    showSplashThenDo(room, 'בואו נראה את התוצאות הסופיות לסיבוב זה', 2000, () => {
      showScoreboard(room);
    });
  }, totalRevealTime);
}

function showScoreboard(room) {
  room.phase = 'scoreboard';
  io.to(room.code).emit('scoreboard', {
    scores: engine.getScoreboard(room),
    subRound: room.subRound,
    mainRound: room.mainRound,
    nextSubRound: room.subRound < 3 ? room.subRound + 1 : null
  });

  // Auto-advance after 7 seconds
  room.timer = setTimeout(() => {
    advanceToNextSubRound(room);
  }, 7000);
}

function advanceToNextSubRound(room) {
  clearTimeout(room.timer);
  if (room.subRound === 1) {
    showSplashThenDo(room, 'סיבוב 2', 5000, () => startSubRound(room, 2));
  } else if (room.subRound === 2) {
    showSplashThenDo(room, 'סיבוב 3', 5000, () => startSubRound(room, 3));
  } else {
    showRoundComplete(room);
  }
}

function showRoundComplete(room) {
  room.phase = 'round-complete';
  const scores = engine.getScoreboard(room);
  const winner = scores[0] || null;

  io.to(room.code).emit('round-complete', {
    mainRound: room.mainRound,
    scores,
    winner
  });

  // Winner display (5s) → credits roll (auto) → "משחק חדש" button stays
  // No auto-advance here — host decides to start new game
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n💨 Quiflotz server running on http://localhost:${PORT}\n`);
});
