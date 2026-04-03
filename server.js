const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameEngine } = require('./game-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,      // 60s before considering disconnected (phone in background)
  pingInterval: 25000       // Check every 25s
});

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

  // Host reconnection — rejoin existing room
  socket.on('rejoin-host', ({ roomCode }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return callback({ success: false, error: 'החדר לא נמצא.' });
    // Update host socket id
    room.hostId = socket.id;
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    console.log(`Host reconnected to room ${code}`);
    callback({
      success: true, roomCode: code,
      gameState: room.state, phase: room.phase,
      players: engine.getPlayerList(room),
      spectatorCount: engine.getSpectators(room).length,
      scores: engine.getScoreboard(room),
      subRound: room.subRound
    });
  });

  socket.on('join-room', ({ roomCode, playerName, persistentId }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return callback({ success: false, error: 'החדר לא נמצא. בדוק את הקוד.' });

    // Check if this is a reconnecting player (by persistentId or name)
    let existingPlayer = null;
    if (persistentId) {
      for (const [id, p] of room.players) {
        if (p.persistentId === persistentId) {
          existingPlayer = { oldId: id, player: p };
          break;
        }
      }
    }
    // Fallback: match by name if persistentId not found
    if (!existingPlayer) {
      for (const [id, p] of room.players) {
        if (p.name === playerName.trim().substring(0, 20) && !p.connected) {
          existingPlayer = { oldId: id, player: p };
          break;
        }
      }
    }

    if (existingPlayer) {
      // Reconnecting player — transfer to new socket id
      const { oldId, player } = existingPlayer;
      room.players.delete(oldId);
      player.id = socket.id;
      player.connected = true;
      room.players.set(socket.id, player);

      // Update references in matchups
      room.matchups.forEach(m => {
        if (m.player1.id === oldId) m.player1.id = socket.id;
        if (m.player2.id === oldId) m.player2.id = socket.id;
        if (m.votes.has(oldId)) {
          const vote = m.votes.get(oldId);
          m.votes.delete(oldId);
          m.votes.set(socket.id, vote);
        }
      });
      // Update finalAnswers/finalVotes references
      if (room.finalAnswers.has(oldId)) {
        const ans = room.finalAnswers.get(oldId);
        ans.playerId = socket.id;
        room.finalAnswers.delete(oldId);
        room.finalAnswers.set(socket.id, ans);
      }
      if (room.finalVotes.has(oldId)) {
        const votes = room.finalVotes.get(oldId);
        room.finalVotes.delete(oldId);
        room.finalVotes.set(socket.id, votes);
      }

      socket.join(code);
      socket.roomCode = code;
      socket.isHost = false;

      callback({
        success: true, isSpectator: player.isSpectator, roomCode: code,
        gameState: room.state, phase: room.phase, reconnected: true
      });

      io.to(room.hostId).emit('player-joined', {
        players: engine.getPlayerList(room),
        spectatorCount: engine.getSpectators(room).length
      });
      console.log(`Player ${player.name} reconnected to room ${code}`);
      return;
    }

    // New player
    const activeCount = engine.getActivePlayers(room).length;
    const isSpectator = activeCount >= 8 || room.state !== 'lobby';
    const pid = persistentId || socket.id;

    const player = {
      id: socket.id,
      persistentId: pid,
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
      spectatorCount: engine.getSpectators(room).length,
      spectators: engine.getSpectators(room).map(s => ({ id: s.id, name: s.name }))
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
    // "מיד מתחילים" splash with narrator, then round 1 splash
    showSplashThenDo(room, 'מיד מתחילים!', 'pre-game', 5000, () => {
      showSplashThenDo(room, 'סיבוב 1', 'round-1-start', 7000, () => startSubRound(room, 1));
    });
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
      showSplashThenDo(room, 'כולם ענו! בואו נראה מה הצבעתם', 'lets-see-votes', 4000, () => startFinalVoting(room));
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

  // Host signals prompt narration finished — advance to voting
  socket.on('prompt-reveal-done', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (room.promptRevealCallback) {
      clearTimeout(room.timer);
      const cb = room.promptRevealCallback;
      room.promptRevealCallback = null;
      cb();
    }
  });

  // Host signals narrator finished — advance past splash
  socket.on('splash-done', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (room.splashCallback) {
      clearTimeout(room.timer);
      const cb = room.splashCallback;
      room.splashCallback = null;
      cb();
    }
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
        if (room.state === 'lobby') {
          // In lobby: remove player entirely so slot opens up
          room.players.delete(socket.id);
        } else {
          // During game: mark disconnected but keep in game
          player.connected = false;
        }
        io.to(room.hostId).emit('player-left', {
          playerName: player.name,
          players: engine.getPlayerList(room),
          spectatorCount: engine.getSpectators(room).length,
          spectators: engine.getSpectators(room).map(s => ({ id: s.id, name: s.name }))
        });
      }
    }
  });
});

// ============================================================
// GAME FLOW FUNCTIONS — Fully automated with splashes & timings
// ============================================================

function showSplashThenDo(room, text, type, duration, callback) {
  // Support old 3-arg calls: showSplashThenDo(room, text, duration, callback)
  if (typeof type === 'number') {
    callback = duration;
    duration = type;
    type = null;
  }
  room.phase = 'splash';

  // Narrated splash types — host will signal when narrator finishes
  const narratedTypes = ['pre-game', 'round-1-start', 'round-2-start', 'round-3-start', 'round-4-start',
                         'scoreboard-1', 'scoreboard-2', 'scoreboard-3'];
  const isNarrated = type && narratedTypes.includes(type);

  io.to(room.code).emit('show-splash', { text, type, duration, waitForNarrator: isNarrated });

  if (isNarrated) {
    // Wait for host to signal narrator finished (with fallback timeout)
    room.splashCallback = callback;
    room.timer = setTimeout(() => {
      room.splashCallback = null;
      callback();
    }, 20000); // 20s fallback safety
  } else {
    room.timer = setTimeout(callback, duration);
  }
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
      showSplashThenDo(room, 'נגמר הזמן!', 'time-is-up', 4000, () => beginMatchupSequence(room));
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
      showSplashThenDo(room, 'נגמר הזמן!', 'time-is-up', 4000, () => startFinalVoting(room));
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
  // Show "let's see" splash before first matchup (all sub-rounds)
  showSplashThenDo(room, 'בואו נראה מה הצבעתם!', 'lets-see-votes', 4000, () => startNextMatchup(room));
}

function startNextMatchup(room) {
  const matchup = engine.getCurrentMatchup(room);
  if (!matchup) {
    // All matchups done — show scoreboard with round-specific narrator
    const scoreType = room.subRound === 1 ? 'scoreboard-1' : room.subRound === 2 ? 'scoreboard-2' : 'scoreboard-3';
    showSplashThenDo(room, 'בואו נראה את התוצאות עד כה', scoreType, 5000, () => showScoreboard(room));
    return;
  }

  // 3 second pause before each matchup
  room.phase = 'matchup-pause';
  io.to(room.code).emit('matchup-pause', { index: matchup.index, total: room.matchups.length });

  room.timer = setTimeout(() => {
    // Show prompt big — audio determines duration, host signals when done
    room.phase = 'matchup-prompt-reveal';
    io.to(room.code).emit('matchup-prompt-reveal', {
      promptText: matchup.prompt.text,
      promptAudio: matchup.prompt.audio || null,
      index: matchup.index,
      total: room.matchups.length
    });

    // Wait for host signal (prompt-reveal-done) or fallback 10s
    room.promptRevealCallback = () => startMatchupVoting(room);
    room.timer = setTimeout(() => {
      room.promptRevealCallback = null;
      startMatchupVoting(room);
    }, 10000);
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

  // Side-by-side reveal: quiflotz first (if any) → zoom + voters + pct + score count
  const quiflotzTime = hasQuiflotz ? 4000 : 0;
  const revealTime = 500 + 4500; // zoom-in + voters + pct + score count + buffer
  const totalTime = quiflotzTime + revealTime + 3000;

  // Auto-advance to next matchup after display
  room.timer = setTimeout(() => {
    advanceAfterMatchup(room);
  }, totalTime);
}

function advanceAfterMatchup(room) {
  clearTimeout(room.timer);
  if (engine.nextMatchup(room)) {
    startNextMatchup(room);
  } else {
    const scoreType = room.subRound === 1 ? 'scoreboard-1' : room.subRound === 2 ? 'scoreboard-2' : 'scoreboard-3';
    showSplashThenDo(room, 'בואו נראה את התוצאות עד כה', scoreType, 5000, () => showScoreboard(room));
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

  // Auto-advance: 3s splash + 1.5s initial + ~6.3s per voted answer + buffer
  // After round 3 final results → show scoreboard with Points Table 3 narrator, then round-complete
  const votedCount = results.filter(r => r.votes > 0).length || 1;
  const totalRevealTime = 3000 + 1500 + votedCount * 6300 + 3000;
  room.timer = setTimeout(() => {
    showSplashThenDo(room, 'בואו נראה את התוצאות עד כה', 'scoreboard-3', 5000, () => showScoreboard(room));
  }, totalRevealTime);
}

function showScoreboard(room) {
  room.phase = 'scoreboard';

  // Scoreboard only on host — players see "look at the screen"
  io.to(room.hostId).emit('scoreboard', {
    scores: engine.getScoreboard(room),
    subRound: room.subRound,
    mainRound: room.mainRound,
    nextSubRound: room.subRound < 3 ? room.subRound + 1 : null
  });

  // Tell players to look at host screen
  room.players.forEach((player, id) => {
    if (player.connected && id !== room.hostId) {
      io.to(id).emit('show-splash', { text: 'הסתכלו על המסך הראשי!' });
    }
  });

  // Auto-advance after 12 seconds (extra time to see scores)
  room.timer = setTimeout(() => {
    advanceToNextSubRound(room);
  }, 12000);
}

function advanceToNextSubRound(room) {
  clearTimeout(room.timer);
  if (room.subRound === 1) {
    showSplashThenDo(room, 'סיבוב 2', 'round-2-start', 7000, () => startSubRound(room, 2));
  } else if (room.subRound === 2) {
    showSplashThenDo(room, 'סיבוב 3', 'round-3-start', 7000, () => startSubRound(room, 3));
  } else {
    showRoundComplete(room);
  }
}

function showRoundComplete(room) {
  const scores = engine.getScoreboard(room);

  // Check for tiebreaker — only after sub-round 3 (not after tiebreaker itself)
  if (room.subRound === 3) {
    const tied = engine.detectTie(room);
    if (tied) {
      // Tiebreaker! Round 4 with only the two tied players
      showSplashThenDo(room, 'תיקו! סיבוב המחץ!', 'round-4-start', 7000, () => {
        startTiebreakerRound(room, tied);
      });
      return;
    }
  }

  // Normal winner declaration
  room.phase = 'round-complete';
  const winner = scores[0] || null;

  io.to(room.hostId).emit('round-complete', {
    mainRound: room.mainRound,
    scores,
    winner
  });

  room.players.forEach((player, id) => {
    if (player.connected && id !== room.hostId) {
      io.to(id).emit('show-splash', { text: 'הסתכלו על המסך הראשי!' });
    }
  });
}

function startTiebreakerRound(room, tiedPlayers) {
  // Reuse round 1/2 matchup system with just 1 matchup between the 2 tied players
  room.subRound = 4;
  room.multiplier = 1; // Points don't really matter, winner of matchup wins

  room.phase = 'writing';
  // Pick a prompt using engine
  const prompt = engine.pickPrompt(room, prompts);
  room.matchups = [{
    index: 0,
    prompt,
    player1: { id: tiedPlayers[0].id, name: tiedPlayers[0].name, answer: null },
    player2: { id: tiedPlayers[1].id, name: tiedPlayers[1].name, answer: null },
    votes: new Map(),
    result: null
  }];
  room.currentMatchupIndex = 0;
  room.writeStartTime = Date.now();

  const writeTime = 45;
  const tiedIds = new Set([tiedPlayers[0].id, tiedPlayers[1].id]);

  // Tell host
  const activePlayers = engine.getActivePlayers(room);
  io.to(room.hostId).emit('sub-round-start', {
    mainRound: room.mainRound,
    subRound: 4,
    multiplier: 1,
    matchupCount: 1,
    writeTime,
    players: activePlayers.map((p, i) => ({ id: p.id, name: p.name, index: i }))
  });

  // Only the two tied players write
  tiedPlayers.forEach(tp => {
    const playerPrompts = engine.getPlayerPrompts(room, tp.id);
    io.to(tp.id).emit('your-prompts', {
      subRound: 4,
      multiplier: 1,
      prompts: playerPrompts,
      writeTime
    });
  });

  // Everyone else waits
  room.players.forEach((player, id) => {
    if (player.connected && !tiedIds.has(id) && id !== room.hostId) {
      io.to(id).emit('spectator-writing', { subRound: 4, multiplier: 1 });
    }
  });

  room.timer = setTimeout(() => {
    showSplashThenDo(room, 'נגמר הזמן!', 'time-is-up', 4000, () => beginMatchupSequence(room));
  }, writeTime * 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n💨 Quiflotz server running on http://localhost:${PORT}\n`);
});
