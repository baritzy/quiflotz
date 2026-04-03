/**
 * Quiflotz Game Engine v2
 * Full Quiplash-style format:
 *   Sub-round 1: Each player gets 2 prompts, 1v1 matchups, 1x points
 *   Sub-round 2: Same, 2x points
 *   Sub-round 3: One prompt for all, 3 votes each, 3x points
 */

class GameEngine {

  createRoom(code, hostId) {
    return {
      code,
      hostId,
      state: 'lobby',       // lobby | playing | finished
      phase: 'waiting',     // waiting | writing | matchup-vote | matchup-result | final-write | final-vote | final-result | scoreboard | round-complete
      players: new Map(),
      mainRound: 0,         // Which main round we're on (1, 2, ...)
      subRound: 0,          // 1, 2, or 3
      multiplier: 1,        // 1x, 2x, 3x
      matchups: [],         // Array of matchup objects
      currentMatchupIndex: 0,
      finalPrompt: null,    // Sub-round 3 prompt
      finalAnswers: new Map(),  // playerId → { text }
      finalVotes: new Map(),    // voterId → { answerId: count, ... }
      usedPromptIds: new Set(),
      timer: null,
      settings: {
        writeTime: 90,
        matchupVoteTime: 15,
        finalVoteTime: 30,
        maxPlayers: 8
      }
    };
  }

  /**
   * Generate matchups for sub-rounds 1 & 2.
   * Each player gets exactly 2 prompts. Each prompt is a 1v1 between 2 players.
   * Uses circular pairing: N players → N matchups.
   */
  generateMatchups(room, allPrompts) {
    const activePlayers = this.getActivePlayers(room);
    const n = activePlayers.length;

    // Shuffle players for random pairing
    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);

    const matchups = [];
    for (let i = 0; i < n; i++) {
      const p1 = shuffled[i];
      const p2 = shuffled[(i + 1) % n];

      const prompt = this.pickPrompt(room, allPrompts);

      matchups.push({
        index: i,
        prompt,
        player1: { id: p1.id, name: p1.name, answer: null },
        player2: { id: p2.id, name: p2.name, answer: null },
        votes: new Map(),    // voterId → 1 or 2
        result: null         // Filled after voting
      });
    }

    room.matchups = matchups;
    room.currentMatchupIndex = 0;
    return matchups;
  }

  /**
   * Get the 2 prompts assigned to a specific player.
   */
  getPlayerPrompts(room, playerId) {
    return room.matchups
      .filter(m => m.player1.id === playerId || m.player2.id === playerId)
      .map(m => ({
        matchupIndex: m.index,
        promptText: m.prompt.text,
        promptCategory: m.prompt.category
      }));
  }

  /**
   * Submit answer for a matchup.
   */
  submitMatchupAnswer(room, playerId, matchupIndex, answerText) {
    const matchup = room.matchups[matchupIndex];
    if (!matchup) return false;

    if (matchup.player1.id === playerId) {
      matchup.player1.answer = answerText;
      return true;
    } else if (matchup.player2.id === playerId) {
      matchup.player2.answer = answerText;
      return true;
    }
    return false;
  }

  /**
   * Check if all players submitted their answers for the current sub-round.
   */
  allAnswersSubmitted(room) {
    if (room.subRound <= 2) {
      // Only check connected players' answers
      return room.matchups.every(m => {
        const p1 = room.players.get(m.player1.id);
        const p2 = room.players.get(m.player2.id);
        const p1Done = m.player1.answer !== null || !p1 || !p1.connected;
        const p2Done = m.player2.answer !== null || !p2 || !p2.connected;
        return p1Done && p2Done;
      });
    } else {
      // Sub-round 3 — only connected players need to answer
      const activePlayers = this.getActivePlayers(room);
      return activePlayers.every(p => room.finalAnswers.has(p.id));
    }
  }

  /**
   * Get current matchup for voting.
   */
  getCurrentMatchup(room) {
    return room.matchups[room.currentMatchupIndex] || null;
  }

  /**
   * Submit a vote on a matchup (1 = player1, 2 = player2).
   */
  submitMatchupVote(room, voterId, choice) {
    const matchup = this.getCurrentMatchup(room);
    if (!matchup) return false;

    // Can't vote on your own matchup
    if (matchup.player1.id === voterId || matchup.player2.id === voterId) return false;

    // Already voted
    if (matchup.votes.has(voterId)) return false;

    matchup.votes.set(voterId, choice);
    return true;
  }

  /**
   * Auto-resolve a matchup when one or both players have no answer.
   * The player who answered gets all points automatically.
   */
  autoResolveMatchup(room, noAnswer1, noAnswer2) {
    const matchup = this.getCurrentMatchup(room);
    if (!matchup) return;

    const eligible = Array.from(room.players.values())
      .filter(p => p.connected && !p.isSpectator && p.id !== matchup.player1.id && p.id !== matchup.player2.id).length;
    const basePoints = eligible * 100 * room.multiplier;

    if (noAnswer1 && !noAnswer2) {
      // Player 2 wins automatically
      matchup.result = {
        prompt: matchup.prompt,
        player1: { name: matchup.player1.name, answer: '💨 אין תשובה', points: 0, percentage: 0, voters: [], quiflotz: false },
        player2: { name: matchup.player2.name, answer: matchup.player2.answer, points: basePoints, percentage: 100, voters: ['אוטומטי'], quiflotz: true }
      };
      const p2 = room.players.get(matchup.player2.id);
      if (p2) p2.score += basePoints;
    } else if (!noAnswer1 && noAnswer2) {
      matchup.result = {
        prompt: matchup.prompt,
        player1: { name: matchup.player1.name, answer: matchup.player1.answer, points: basePoints, percentage: 100, voters: ['אוטומטי'], quiflotz: true },
        player2: { name: matchup.player2.name, answer: '💨 אין תשובה', points: 0, percentage: 0, voters: [], quiflotz: false }
      };
      const p1 = room.players.get(matchup.player1.id);
      if (p1) p1.score += basePoints;
    } else {
      // Both no answer — 0 points each
      matchup.result = {
        prompt: matchup.prompt,
        player1: { name: matchup.player1.name, answer: '💨 אין תשובה', points: 0, percentage: 50, voters: [], quiflotz: false },
        player2: { name: matchup.player2.name, answer: '💨 אין תשובה', points: 0, percentage: 50, voters: [], quiflotz: false }
      };
    }
  }

  /**
   * Calculate matchup result and award points.
   */
  resolveMatchup(room) {
    const matchup = this.getCurrentMatchup(room);
    if (!matchup) return null;
    if (matchup.result) return matchup.result; // Already auto-resolved

    let p1Votes = 0, p2Votes = 0;
    const p1Voters = [], p2Voters = [];

    matchup.votes.forEach((choice, voterId) => {
      const voter = room.players.get(voterId);
      if (!voter) return;
      const weight = voter.isSpectator ? 50 : 100;

      if (choice === 1) {
        p1Votes += weight;
        p1Voters.push({ id: voterId, name: voter.name, isSpectator: voter.isSpectator });
      } else {
        p2Votes += weight;
        p2Voters.push({ id: voterId, name: voter.name, isSpectator: voter.isSpectator });
      }
    });

    // Apply multiplier
    const multiplied1 = p1Votes * room.multiplier;
    const multiplied2 = p2Votes * room.multiplier;

    // [BUG #8] Check for Quiflotz — ALL eligible NON-SPECTATOR voters must have voted
    const totalVoters = matchup.votes.size;
    const eligibleVoters = Array.from(room.players.values())
      .filter(p => p.connected && !p.isSpectator && p.id !== matchup.player1.id && p.id !== matchup.player2.id).length;
    const allVoted = totalVoters >= eligibleVoters && eligibleVoters > 0;
    const p1Quiflotz = allVoted && p2Votes === 0 && p1Votes > 0;
    const p2Quiflotz = allVoted && p1Votes === 0 && p2Votes > 0;

    // If Quiflotz, double the already-multiplied points
    const final1 = p1Quiflotz ? multiplied1 * 2 : multiplied1;
    const final2 = p2Quiflotz ? multiplied2 * 2 : multiplied2;

    // Award points
    const player1 = room.players.get(matchup.player1.id);
    const player2 = room.players.get(matchup.player2.id);
    if (player1) player1.score += final1;
    if (player2) player2.score += final2;

    // Calculate vote percentages
    const totalWeight = p1Votes + p2Votes;
    const p1Pct = totalWeight > 0 ? Math.round((p1Votes / totalWeight) * 100) : 50;
    const p2Pct = totalWeight > 0 ? 100 - p1Pct : 50;

    matchup.result = {
      prompt: matchup.prompt,
      player1: {
        name: matchup.player1.name,
        answer: matchup.player1.answer || '(no answer)',
        points: final1,
        percentage: p1Pct,
        voters: p1Voters,
        quiflotz: p1Quiflotz
      },
      player2: {
        name: matchup.player2.name,
        answer: matchup.player2.answer || '(no answer)',
        points: final2,
        percentage: p2Pct,
        voters: p2Voters,
        quiflotz: p2Quiflotz
      }
    };

    return matchup.result;
  }

  /**
   * Advance to next matchup. Returns true if there is one, false if done.
   */
  nextMatchup(room) {
    room.currentMatchupIndex++;
    return room.currentMatchupIndex < room.matchups.length;
  }

  /**
   * Set up sub-round 3 (final round) with one prompt for all.
   */
  setupFinalRound(room, allPrompts) {
    room.finalPrompt = this.pickPrompt(room, allPrompts);
    room.finalAnswers = new Map();
    room.finalVotes = new Map();
    room.subRound = 3;
    room.multiplier = 3;
  }

  /**
   * Submit final round answer.
   */
  submitFinalAnswer(room, playerId, text) {
    const player = room.players.get(playerId);
    if (!player || player.isSpectator) return false;
    room.finalAnswers.set(playerId, {
      playerId,
      playerName: player.name,
      text
    });
    return true;
  }

  /**
   * Submit final round votes (3 votes to distribute).
   * voteMap = { answerId: count, ... } where total counts = 3
   */
  submitFinalVotes(room, voterId, voteMap) {
    if (room.finalVotes.has(voterId)) return false;

    // Validate: total votes = 3, can't vote for self
    let total = 0;
    for (const [answerId, count] of Object.entries(voteMap)) {
      if (answerId === voterId) return false; // Can't vote for self
      if (count < 0) return false;
      total += count;
    }
    if (total !== 3) return false;

    room.finalVotes.set(voterId, voteMap);
    return true;
  }

  /**
   * Resolve final round and award points.
   */
  resolveFinalRound(room) {
    const answers = Array.from(room.finalAnswers.values());

    // Count votes for each answer
    const voteCounts = new Map(); // answerId → total weighted votes
    const voterNames = new Map(); // answerId → [names]

    answers.forEach(a => {
      voteCounts.set(a.playerId, 0);
      voterNames.set(a.playerId, []);
    });

    room.finalVotes.forEach((voteMap, voterId) => {
      const voter = room.players.get(voterId);
      if (!voter) return;
      const weight = voter.isSpectator ? 50 : 100;

      for (const [answerId, count] of Object.entries(voteMap)) {
        if (count > 0 && voteCounts.has(answerId)) {
          voteCounts.set(answerId, (voteCounts.get(answerId) || 0) + count * weight);
          const names = voterNames.get(answerId) || [];
          names.push({ id: voterId, name: voter.name, count, isSpectator: voter.isSpectator });
          voterNames.set(answerId, names);
        }
      }
    });

    // [BUG #9] Check for Quiflotz — ALL eligible NON-SPECTATOR voters must have voted
    const totalVoters = room.finalVotes.size;
    const eligibleVoters = Array.from(room.players.values()).filter(p => p.connected && !p.isSpectator).length;
    const allVoted = totalVoters >= eligibleVoters && eligibleVoters > 1;
    const answersWithVotes = Array.from(voteCounts.values()).filter(v => v > 0).length;

    // Build results sorted by votes
    const results = answers.map(a => {
      const rawVotes = voteCounts.get(a.playerId) || 0;
      const points = rawVotes * room.multiplier;
      const isQuiflotz = allVoted && answersWithVotes === 1 && rawVotes > 0;
      const finalPoints = isQuiflotz ? points * 2 : points;

      // Award points
      const player = room.players.get(a.playerId);
      if (player) player.score += finalPoints;

      return {
        playerId: a.playerId,
        playerName: a.playerName,
        text: a.text,
        votes: rawVotes,
        points: finalPoints,
        voters: voterNames.get(a.playerId) || [],
        quiflotz: isQuiflotz
      };
    }).sort((a, b) => b.points - a.points);

    return results;
  }

  // --- Helper methods ---

  pickPrompt(room, allPrompts) {
    let available = allPrompts.filter(p => !room.usedPromptIds.has(p.id));
    if (available.length === 0) {
      room.usedPromptIds.clear();
      available = allPrompts;
    }
    const prompt = available[Math.floor(Math.random() * available.length)];
    room.usedPromptIds.add(prompt.id);
    return prompt;
  }

  getActivePlayers(room) {
    return Array.from(room.players.values())
      .filter(p => !p.isSpectator && p.connected);
  }

  getSpectators(room) {
    return Array.from(room.players.values())
      .filter(p => p.isSpectator && p.connected);
  }

  getPlayerList(room) {
    return Array.from(room.players.values())
      .filter(p => !p.isSpectator)
      .map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }));
  }

  getScoreboard(room) {
    return Array.from(room.players.values())
      .filter(p => !p.isSpectator)
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, id: p.id }));
  }

  /**
   * Detect if the top 2 players are tied.
   * Returns the two tied player objects if tied, null otherwise.
   */
  detectTie(room) {
    const scores = this.getScoreboard(room);
    if (scores.length < 2) return null;
    if (scores[0].score === scores[1].score) {
      return [scores[0], scores[1]];
    }
    return null;
  }

  resetRoom(room) {
    room.state = 'lobby';
    room.phase = 'waiting';
    room.mainRound = 0;
    room.subRound = 0;
    room.multiplier = 1;
    room.matchups = [];
    room.currentMatchupIndex = 0;
    room.finalPrompt = null;
    room.finalAnswers = new Map();
    room.finalVotes = new Map();
    room.usedPromptIds = new Set();
    clearTimeout(room.timer);
    let count = 0;
    room.players.forEach(p => {
      p.score = 0;
      p.isSpectator = count >= 8;
      count++;
    });
  }

  /**
   * Count how many answers a player has submitted for current sub-round matchups.
   */
  getPlayerAnswerCount(room, playerId) {
    let submitted = 0;
    let total = 0;
    room.matchups.forEach(m => {
      if (m.player1.id === playerId) {
        total++;
        if (m.player1.answer !== null) submitted++;
      }
      if (m.player2.id === playerId) {
        total++;
        if (m.player2.answer !== null) submitted++;
      }
    });
    return { submitted, total };
  }

  /**
   * Count total answer submissions across all matchups.
   */
  getTotalAnswerProgress(room) {
    let submitted = 0;
    let total = 0;
    room.matchups.forEach(m => {
      total += 2;
      if (m.player1.answer !== null) submitted++;
      if (m.player2.answer !== null) submitted++;
    });
    return { submitted, total };
  }
}

module.exports = { GameEngine };
