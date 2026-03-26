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
    // Timers: 55s for rounds 1&2 (two prompts), 35s for round 3 (one prompt)
    room.settings.writeTime = 55;
    room.settings.finalWriteTime = 35;
    startSubRound(room, 1);
  });

  // --- Sub-round answer submission (rounds 1 & 2) ---

  socket.on('submit-answers', ({ answers }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'writing') return;
    const player = room.players.get(socket.id);
    if (!player || player.isSpectator) return;

    answers.forEach(({ matchupIndex, text }) => {
      engine.submitMatchupAnswer(room, socket.id, matchupIndex, text.trim().substring(0, 100));
    });

    // Notify host of progress
    const progress = engine.getTotalAnswerProgress(room);
    io.to(room.hostId).emit('writing-progress', progress);

    // If all submitted, skip timer
    if (engine.allAnswersSubmitted(room)) {
      clearTimeout(room.timer);
      startMatchupVoting(room);
    }
  });

  // --- Matchup vote (rounds 1 & 2) ---

  socket.on('submit-matchup-vote', ({ choice }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'matchup-vote') return;

    engine.submitMatchupVote(room, socket.id, choice);

    // Count votes
    const matchup = engine.getCurrentMatchup(room);
    const eligible = Array.from(room.players.values())
      .filter(p => p.connected && p.id !== matchup.player1.id && p.id !== matchup.player2.id).length;

    io.to(room.hostId).emit('matchup-vote-progress', {
      count: matchup.votes.size,
      total: eligible
    });

    if (matchup.votes.size >= eligible) {
      clearTimeout(room.timer);
      showMatchupResult(room);
    }
  });

  // --- Host advances (next matchup, scoreboard, next sub-round) ---

  socket.on('next-matchup', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;

    if (engine.nextMatchup(room)) {
      startMatchupVoting(room);
    } else {
      // All matchups done — show scoreboard
      showScoreboard(room);
    }
  });

  socket.on('next-sub-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;

    if (room.subRound === 1) {
      startSubRound(room, 2);
    } else if (room.subRound === 2) {
      startSubRound(room, 3);
    } else {
      // After sub-round 3 — round complete
      showRoundComplete(room);
    }
  });

  // --- Final round (sub-round 3) ---

  socket.on('submit-final-answer', ({ answer }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'final-write') return;

    engine.submitFinalAnswer(room, socket.id, answer.trim().substring(0, 100));

    const activePlayers = engine.getActivePlayers(room);
    const submitted = room.finalAnswers.size;
    io.to(room.hostId).emit('writing-progress', { submitted, total: activePlayers.length });

    // Round 3: wait for ALL players before starting vote
    if (submitted >= activePlayers.length) {
      clearTimeout(room.timer);
      // Brief pause so last player sees "submitted" screen
      setTimeout(() => startFinalVoting(room), 1500);
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
// GAME FLOW FUNCTIONS
// ============================================================

function startSubRound(room, subRoundNum) {
  room.subRound = subRoundNum;
  room.multiplier = subRoundNum; // 1x, 2x, 3x

  if (subRoundNum <= 2) {
    // Rounds 1 & 2: matchup-based
    room.phase = 'writing';
    engine.generateMatchups(room, prompts);

    // Tell host
    io.to(room.hostId).emit('sub-round-start', {
      mainRound: room.mainRound,
      subRound: subRoundNum,
      multiplier: room.multiplier,
      matchupCount: room.matchups.length,
      writeTime: room.settings.writeTime
    });

    // Send each player their 2 prompts
    engine.getActivePlayers(room).forEach(p => {
      const playerPrompts = engine.getPlayerPrompts(room, p.id);
      io.to(p.id).emit('your-prompts', {
        subRound: subRoundNum,
        multiplier: room.multiplier,
        prompts: playerPrompts,
        writeTime: room.settings.writeTime
      });
    });

    // Spectators see waiting screen
    engine.getSpectators(room).forEach(p => {
      io.to(p.id).emit('spectator-writing', {
        subRound: subRoundNum,
        multiplier: room.multiplier
      });
    });

    // Timer
    room.timer = setTimeout(() => {
      startMatchupVoting(room);
    }, room.settings.writeTime * 1000);

  } else {
    // Sub-round 3: final round
    room.phase = 'final-write';
    engine.setupFinalRound(room, prompts);

    const writeTime = room.settings.finalWriteTime || 35;
    const data = {
      mainRound: room.mainRound,
      subRound: 3,
      multiplier: 3,
      prompt: room.finalPrompt,
      writeTime
    };

    io.to(room.hostId).emit('final-round-start', data);

    engine.getActivePlayers(room).forEach(p => {
      io.to(p.id).emit('final-write-prompt', data);
    });

    engine.getSpectators(room).forEach(p => {
      io.to(p.id).emit('spectator-final-writing', data);
    });

    room.timer = setTimeout(() => {
      startFinalVoting(room);
    }, writeTime * 1000);
  }
}

function startMatchupVoting(room) {
  room.phase = 'matchup-vote';
  const matchup = engine.getCurrentMatchup(room);
  if (!matchup) return;

  const a1 = matchup.player1.answer;
  const a2 = matchup.player2.answer;
  const noAnswer1 = !a1;
  const noAnswer2 = !a2;

  // If one or both have no answer — auto-resolve, skip voting
  if (noAnswer1 || noAnswer2) {
    // Auto-win for the one who answered (or tie if both empty)
    const data = {
      index: matchup.index,
      total: room.matchups.length,
      promptText: matchup.prompt.text,
      answer1: a1 || '💨 אין תשובה',
      answer2: a2 || '💨 אין תשובה',
      noAnswer1,
      noAnswer2,
      autoResolve: true,
      voteTime: 0,
      subRound: room.subRound,
      multiplier: room.multiplier
    };

    io.to(room.hostId).emit('matchup-show', data);
    room.players.forEach((player, id) => {
      if (!player.connected) return;
      io.to(id).emit('matchup-vote', { ...data, isMyMatchup: matchup.player1.id === id || matchup.player2.id === id });
    });

    // Auto-resolve after brief display
    room.timer = setTimeout(() => {
      engine.autoResolveMatchup(room, noAnswer1, noAnswer2);
      showMatchupResult(room);
    }, 2000);
    return;
  }

  const data = {
    index: matchup.index,
    total: room.matchups.length,
    promptText: matchup.prompt.text,
    answer1: a1,
    answer2: a2,
    noAnswer1: false,
    noAnswer2: false,
    autoResolve: false,
    voteTime: room.settings.matchupVoteTime,
    subRound: room.subRound,
    multiplier: room.multiplier
  };

  io.to(room.hostId).emit('matchup-show', data);

  room.players.forEach((player, id) => {
    if (!player.connected) return;
    io.to(id).emit('matchup-vote', {
      ...data,
      isMyMatchup: matchup.player1.id === id || matchup.player2.id === id
    });
  });

  room.timer = setTimeout(() => {
    showMatchupResult(room);
  }, room.settings.matchupVoteTime * 1000);
}

function showMatchupResult(room) {
  clearTimeout(room.timer);
  room.phase = 'matchup-result';
  const result = engine.resolveMatchup(room);
  if (!result) return;

  const hasQuiflotz = result.player1.quiflotz || result.player2.quiflotz;

  const data = {
    result,
    hasQuiflotz,
    matchupIndex: room.currentMatchupIndex,
    totalMatchups: room.matchups.length,
    isLastMatchup: room.currentMatchupIndex >= room.matchups.length - 1,
    scores: engine.getScoreboard(room)
  };

  io.to(room.code).emit('matchup-result', data);
}

function startFinalVoting(room) {
  room.phase = 'final-vote';
  const answers = Array.from(room.finalAnswers.values());

  // Shuffle answers
  const shuffled = answers.sort(() => Math.random() - 0.5);

  const hostData = {
    prompt: room.finalPrompt,
    answers: shuffled.map(a => ({ id: a.playerId, text: a.text })),
    voteTime: room.settings.finalVoteTime
  };

  io.to(room.hostId).emit('final-voting-start', hostData);

  // Send to each player (mark own answer)
  room.players.forEach((player, id) => {
    if (!player.connected) return;
    io.to(id).emit('final-vote-options', {
      prompt: room.finalPrompt,
      answers: shuffled.map(a => ({
        id: a.playerId,
        text: a.text,
        isMine: a.playerId === id
      })),
      voteTime: room.settings.finalVoteTime
    });
  });

  room.timer = setTimeout(() => {
    showFinalResult(room);
  }, room.settings.finalVoteTime * 1000);
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
}

function showScoreboard(room) {
  room.phase = 'scoreboard';
  io.to(room.code).emit('scoreboard', {
    scores: engine.getScoreboard(room),
    subRound: room.subRound,
    mainRound: room.mainRound,
    nextSubRound: room.subRound < 3 ? room.subRound + 1 : null
  });
}

function showRoundComplete(room) {
  room.phase = 'round-complete';
  io.to(room.code).emit('round-complete', {
    mainRound: room.mainRound,
    scores: engine.getScoreboard(room),
    winner: engine.getScoreboard(room)[0] || null
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n💨 Quiflotz server running on http://localhost:${PORT}\n`);
});
