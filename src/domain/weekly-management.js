'use strict';

const BENCH_SLOTS = new Set(['BN', 'BENCH', 'IR', 'IL', 'NA']);
const HEALTHY_STATUSES = new Set(['', 'ACTIVE', 'HEALTHY', 'OK', 'PROBABLE']);
const SLOT_ELIGIBILITY = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  DST: ['DEF'],
  'W/R': ['WR', 'RB'],
  'W/T': ['WR', 'TE'],
  'R/W/T': ['RB', 'WR', 'TE'],
  FLEX: ['RB', 'WR', 'TE'],
  'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'],
  SUPERFLEX: ['QB', 'WR', 'RB', 'TE']
};

function weeklyError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, places = 2) {
  const multiplier = 10 ** places;
  return Math.round((finite(value) + Number.EPSILON) * multiplier) / multiplier;
}

function position(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'DST' || normalized === 'D/ST' ? 'DEF' : normalized;
}

function playerIdentity(player) {
  return String(player?.playerId || player?.id || player?.name || '').trim().toLowerCase();
}

function normalizePlayer(player, league, poolByIdentity = new Map(), { preferSharedProjections = false } = {}) {
  const id = String(player?.playerId || player?.id || '').trim() || null;
  const name = String(player?.name || player?.playerName || '').trim();
  const shared = poolByIdentity.get(String(id || '').toLowerCase())
    || poolByIdentity.get(name.toLowerCase())
    || null;
  const sharedWeeklyProjection = shared?.weeklyProjectedPoints ?? shared?.projectedPointsWeek ?? null;
  const sharedRemainingProjection = shared?.remainingProjectedPoints ?? shared?.remainingProjection ?? null;
  const projectedPoints = preferSharedProjections && sharedWeeklyProjection != null
    ? round(sharedWeeklyProjection)
    : player?.projectedPoints == null
    ? player?.projectedStats ? scorePlayerStats(player.projectedStats, league) : null
    : round(player.projectedPoints);
  const remainingProjectedPoints = preferSharedProjections && sharedRemainingProjection != null
    ? round(sharedRemainingProjection)
    : player?.remainingProjectedPoints == null
    ? player?.remainingProjection == null ? projectedPoints : round(player.remainingProjection)
    : round(player.remainingProjectedPoints);
  const actualPoints = player?.actualPoints == null
    ? player?.actualStats ? scorePlayerStats(player.actualStats, league) : null
    : round(player.actualPoints);
  return {
    ...structuredClone(player || {}),
    playerId: id,
    name,
    position: position(player?.position || shared?.position),
    nflTeam: String(player?.nflTeam || player?.team || shared?.team || '').trim().toUpperCase() || null,
    rosterSlot: String(player?.rosterSlot || player?.slot || '').trim().toUpperCase() || null,
    actualPoints,
    projectedPoints,
    remainingProjectedPoints,
    injuryStatus: String(player?.injuryStatus || player?.status || shared?.injuryStatus || '').trim().toUpperCase(),
    byeWeek: player?.byeWeek == null ? shared?.byeWeek ?? null : Number(player.byeWeek),
    sleeperTrend: player?.sleeperTrend || shared?.sleeperTrend || null,
    sourceCoverage: {
      fantasyPros: Boolean(player?.sourceCoverage?.fantasyPros
        ?? shared?.sourceCoverage?.fantasyPros
        ?? (shared?.sourceRanks?.fantasyPros != null || shared?.expertRank != null)),
      tank01: Boolean(player?.sourceCoverage?.tank01
        ?? shared?.sourceCoverage?.tank01
        ?? (shared?.sourceRanks?.tank01 != null || shared?.tank01Projection != null)),
      sleeper: Boolean(player?.sourceCoverage?.sleeper ?? player?.sleeperTrend ?? shared?.sleeperTrend)
    },
    projectionRefreshed: Boolean(preferSharedProjections && (sharedWeeklyProjection != null || sharedRemainingProjection != null))
  };
}

function scorePlayerStats(stats = {}, league = {}) {
  const offense = league.scoring?.offense || {};
  const kicking = league.scoring?.kicking || {};
  const defense = league.scoring?.defense || {};
  const allowNegative = league.scoring?.negativePoints !== false;
  const multiply = (value, rule) => {
    const weight = finite(rule);
    return !allowNegative && weight < 0 ? 0 : finite(value) * weight;
  };
  const per = (value, divisor) => {
    if (!divisor) return 0;
    const result = finite(value) / finite(divisor, 1);
    return league.scoring?.fractionalPoints === false ? Math.trunc(result) : result;
  };
  let points = 0;
  points += per(stats.passingYards, offense.passingYardsPerPoint);
  points += multiply(stats.passingTouchdowns, offense.passingTouchdown);
  points += multiply(stats.interceptions, offense.interception);
  points += per(stats.rushingYards, offense.rushingYardsPerPoint);
  points += multiply(stats.rushingTouchdowns, offense.rushingTouchdown);
  points += multiply(stats.receptions, offense.reception);
  points += per(stats.receivingYards, offense.receivingYardsPerPoint);
  points += multiply(stats.receivingTouchdowns, offense.receivingTouchdown);
  points += multiply(stats.returnTouchdowns, offense.returnTouchdown);
  points += multiply(stats.twoPointConversions, offense.twoPointConversion);
  points += multiply(stats.fumblesLost, offense.fumbleLost);
  points += multiply(stats.offensiveFumbleReturnTouchdowns, offense.offensiveFumbleReturnTouchdown);
  points += multiply(stats.fieldGoals0To19, kicking.fieldGoal0To19);
  points += multiply(stats.fieldGoals20To29, kicking.fieldGoal20To29);
  points += multiply(stats.fieldGoals30To39, kicking.fieldGoal30To39);
  points += multiply(stats.fieldGoals40To49, kicking.fieldGoal40To49);
  points += multiply(stats.fieldGoals50Plus, kicking.fieldGoal50Plus);
  points += multiply(stats.extraPointsMade, kicking.pointAfterAttemptMade);
  points += multiply(stats.sacks, defense.sack);
  points += multiply(stats.defensiveInterceptions, defense.interception);
  points += multiply(stats.fumbleRecoveries, defense.fumbleRecovery);
  points += multiply(stats.defensiveTouchdowns, defense.touchdown);
  points += multiply(stats.safeties, defense.safety);
  points += multiply(stats.blockedKicks, defense.blockedKick);
  points += multiply(stats.kickoffOrPuntReturnTouchdowns, defense.kickoffOrPuntReturnTouchdown);
  points += multiply(stats.extraPointsReturned, defense.extraPointReturned);
  if (stats.pointsAllowed != null) {
    const allowedScore = defensePointsAllowed(stats.pointsAllowed, defense.pointsAllowed || {});
    points += !allowNegative && allowedScore < 0 ? 0 : allowedScore;
  }
  return round(points);
}

function defensePointsAllowed(pointsAllowed, rules) {
  const points = finite(pointsAllowed);
  for (const [range, score] of Object.entries(rules)) {
    if (range.endsWith('+') && points >= finite(range.slice(0, -1))) return finite(score);
    if (range.includes('-')) {
      const [minimum, maximum] = range.split('-').map(Number);
      if (points >= minimum && points <= maximum) return finite(score);
    } else if (points === Number(range)) return finite(score);
  }
  return 0;
}

function startingSlots(roster = {}) {
  return Object.entries(roster).flatMap(([slot, count]) => {
    const normalized = String(slot).toUpperCase();
    if (BENCH_SLOTS.has(normalized)) return [];
    return Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => ({ slot: normalized, index: index + 1 }));
  });
}

function eligible(player, slot) {
  return (SLOT_ELIGIBILITY[slot] || [slot]).includes(position(player.position));
}

function optimizeLineup(players, roster) {
  const slots = startingSlots(roster).sort((a, b) => {
    const aCount = (SLOT_ELIGIBILITY[a.slot] || [a.slot]).length;
    const bCount = (SLOT_ELIGIBILITY[b.slot] || [b.slot]).length;
    return aCount - bCount;
  });
  const groups = new Map();
  for (const player of players) {
    const key = position(player.position);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => finite(b.actualPoints) - finite(a.actualPoints));
  }
  const positions = [...groups.keys()].sort();
  const positionIndex = new Map(positions.map((value, index) => [value, index]));
  const memo = new Map();
  function solve(slotIndex, counts) {
    if (slotIndex >= slots.length) return { total: 0, assignments: [] };
    const key = `${slotIndex}:${counts.join(',')}`;
    if (memo.has(key)) return memo.get(key);
    const slot = slots[slotIndex];
    const skipped = solve(slotIndex + 1, counts);
    let best = { total: skipped.total, assignments: [{ slot: slot.slot, slotIndex: slot.index, player: null }, ...skipped.assignments] };
    for (const candidatePosition of SLOT_ELIGIBILITY[slot.slot] || [slot.slot]) {
      const index = positionIndex.get(candidatePosition);
      const group = groups.get(candidatePosition) || [];
      if (index == null || counts[index] >= group.length) continue;
      const player = group[counts[index]];
      const nextCounts = [...counts];
      nextCounts[index] += 1;
      const next = solve(slotIndex + 1, nextCounts);
      const total = finite(player.actualPoints) + next.total;
      if (total > best.total) {
        best = {
          total,
          assignments: [{ slot: slot.slot, slotIndex: slot.index, player }, ...next.assignments]
        };
      }
    }
    memo.set(key, best);
    return best;
  }
  const result = solve(0, Array(positions.length).fill(0));
  return { total: round(result.total), assignments: result.assignments };
}

function isStarter(player) {
  if (typeof player.starter === 'boolean') return player.starter;
  return !BENCH_SLOTS.has(String(player.rosterSlot || '').toUpperCase());
}

function lineupReview(players, league) {
  const actualStarters = players.filter(isStarter);
  const actualPoints = round(actualStarters.reduce((total, player) => total + finite(player.actualPoints), 0));
  const optimal = optimizeLineup(players, league.roster);
  const actualIds = new Set(actualStarters.map(playerIdentity));
  const optimalPlayers = optimal.assignments.map((item) => item.player).filter(Boolean);
  const optimalIds = new Set(optimalPlayers.map(playerIdentity));
  const benchAdds = optimalPlayers.filter((player) => !actualIds.has(playerIdentity(player)));
  const starterRemovals = actualStarters.filter((player) => !optimalIds.has(playerIdentity(player)));
  return {
    actualPoints,
    optimalPoints: optimal.total,
    pointsLeftOnBench: round(Math.max(0, optimal.total - actualPoints)),
    optimalAssignments: optimal.assignments,
    suggestedSwitches: benchAdds.map((add, index) => ({
      start: { playerId: add.playerId, name: add.name, position: add.position, actualPoints: add.actualPoints },
      sit: starterRemovals[index] ? {
        playerId: starterRemovals[index].playerId,
        name: starterRemovals[index].name,
        position: starterRemovals[index].position,
        actualPoints: starterRemovals[index].actualPoints
      } : null
    }))
  };
}

function lineupRisks(players, week) {
  return players.flatMap((player) => {
    const risks = [];
    if (Number(player.byeWeek) === Number(week)) risks.push('BYE');
    if (!HEALTHY_STATUSES.has(player.injuryStatus)) risks.push(player.injuryStatus || 'INJURY');
    if (isStarter(player) && finite(player.projectedPoints) <= 0) risks.push('NO_PROJECTION');
    return risks.length ? [{
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      rosterSlot: player.rosterSlot,
      severity: risks.includes('BYE') || risks.includes('OUT') || risks.includes('IR') ? 'high' : 'medium',
      risks
    }] : [];
  });
}

function teamResults(teams) {
  const byId = new Map(teams.map((team) => [String(team.teamId), team]));
  return teams.map((team) => {
    const opponent = byId.get(String(team.opponentId));
    const score = finite(team.score);
    const opponentScore = opponent ? finite(opponent.score) : team.opponentScore == null ? null : finite(team.opponentScore);
    const result = team.result || (opponentScore == null ? null : score > opponentScore ? 'W' : score < opponentScore ? 'L' : 'T');
    const rank = team.standingRank == null ? null : Number(team.standingRank);
    const previous = team.previousStandingRank == null ? rank : Number(team.previousStandingRank);
    return {
      ...structuredClone(team),
      teamId: String(team.teamId),
      score: round(score),
      opponentName: opponent?.name || team.opponentName || null,
      opponentScore: opponentScore == null ? null : round(opponentScore),
      result,
      standingRank: rank,
      previousStandingRank: previous,
      positionMovement: rank == null || previous == null ? null : previous - rank,
      pointsFor: team.pointsFor == null ? null : round(team.pointsFor),
      pointsAgainst: team.pointsAgainst == null ? null : round(team.pointsAgainst)
    };
  });
}

function dropCompatible(candidate, player) {
  if (candidate.position === player.position) return true;
  return ['RB', 'WR', 'TE'].includes(candidate.position) && ['RB', 'WR', 'TE'].includes(player.position);
}

function projection(player) {
  return player.remainingProjectedPoints ?? player.projectedPoints;
}

function confidenceFor(candidate, drop) {
  let value = 0.45;
  if (projection(candidate) != null && projection(drop) != null) value += 0.2;
  if (candidate.sourceCoverage.fantasyPros) value += 0.1;
  if (candidate.sourceCoverage.tank01) value += 0.1;
  if (candidate.sourceCoverage.sleeper) value += 0.05;
  if (candidate.availabilityStatus || candidate.available === true) value += 0.1;
  return Math.min(0.95, round(value));
}

function waiverRecommendation({ roster, availablePlayers, league, waiver = {}, holdThreshold = 2 }) {
  const droppable = roster.filter((player) => !isStarter(player) && !player.noCut && !player.locked);
  const evaluated = [];
  for (const candidate of availablePlayers.filter((player) => player.available !== false)) {
    const compatible = droppable.filter((player) => dropCompatible(candidate, player));
    const candidates = compatible.length ? compatible : droppable;
    const drop = [...candidates].sort((a, b) => finite(projection(a)) - finite(projection(b)))[0];
    if (!drop || projection(candidate) == null || projection(drop) == null) continue;
    const expectedPointsGained = round(finite(projection(candidate)) - finite(projection(drop)));
    const trendAdjustment = candidate.sleeperTrend?.direction === 'rising' ? 0.25
      : candidate.sleeperTrend?.direction === 'falling' ? -0.25 : 0;
    evaluated.push({
      candidate,
      drop,
      expectedPointsGained,
      rankScore: expectedPointsGained + trendAdjustment,
      confidence: confidenceFor(candidate, drop)
    });
  }
  evaluated.sort((a, b) => b.rankScore - a.rankScore || b.confidence - a.confidence);
  const best = evaluated[0];
  if (!best || best.expectedPointsGained < finite(holdThreshold, 2)) {
    return {
      action: 'HOLD',
      expectedPointsGained: best?.expectedPointsGained || 0,
      confidence: best?.confidence || 0.7,
      confidenceLabel: best?.confidence >= 0.8 ? 'high' : best?.confidence >= 0.6 ? 'medium' : 'low',
      faab: { recommended: 0, percent: 0, budgetRemaining: finite(waiver.budgetRemaining) },
      priorityGuidance: 'Preserve waiver priority this week.',
      reasons: [best
        ? `The best reviewed move gains only ${best.expectedPointsGained} projected points, below the ${finite(holdThreshold, 2)}-point claim threshold.`
        : 'No available player has enough league-scored projection evidence and a valid drop candidate.']
    };
  }
  const percent = best.expectedPointsGained >= 8 ? 20 : best.expectedPointsGained >= 5 ? 12 : 6;
  const budgetRemaining = finite(waiver.budgetRemaining);
  const confidence = best.confidence;
  return {
    action: 'ADD_DROP',
    add: best.candidate,
    drop: best.drop,
    expectedPointsGained: best.expectedPointsGained,
    confidence,
    confidenceLabel: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
    faab: {
      recommended: budgetRemaining ? Math.max(1, Math.round(budgetRemaining * percent / 100)) : null,
      percent,
      budgetRemaining
    },
    priorityGuidance: best.expectedPointsGained >= 5
      ? 'Use a strong waiver priority if roster need is immediate.'
      : 'Use a claim only if losing normal rolling priority is acceptable.',
    reasons: [
      `${best.candidate.name} projects ${best.expectedPointsGained} points above ${best.drop.name} in this league's scoring.`,
      best.candidate.sleeperTrend?.direction === 'rising'
        ? 'Sleeper add activity is rising and breaks a close projection tie.'
        : 'The recommendation is driven by league-scored projection value, not market activity.'
    ]
  };
}

function validateWeeklySnapshot(snapshot, league, expectedWeek) {
  const details = [];
  if (!snapshot || typeof snapshot !== 'object') details.push('snapshot must be an object');
  const week = Number(expectedWeek ?? snapshot?.week);
  if (!Number.isInteger(week) || week < 1 || week > 18) details.push('week must be an integer from 1 to 18');
  if (!Array.isArray(snapshot?.teams) || snapshot.teams.length !== league.teamCount) details.push(`teams must contain all ${league.teamCount} league teams`);
  if (!Array.isArray(snapshot?.roster)) details.push('roster must be an array for the target team');
  if (!Array.isArray(snapshot?.availablePlayers)) details.push('availablePlayers must be an array (use an empty array when none are loaded)');
  const teamIds = new Set((snapshot?.teams || []).map((team) => String(team.teamId || '')));
  if (teamIds.has('')) details.push('every team requires teamId');
  if (teamIds.size !== (snapshot?.teams || []).length) details.push('teamId values must be unique');
  for (const team of snapshot?.teams || []) {
    if (!team.name) details.push('every team requires a name');
    if (team.bye === true) {
      if (team.opponentId) details.push(`team ${team.teamId || '(missing)'} cannot have both bye=true and opponentId`);
      continue;
    }
    if (!team.opponentId || !teamIds.has(String(team.opponentId))) details.push(`team ${team.teamId || '(missing)'} requires a valid opponentId or bye=true`);
    const opponent = (snapshot?.teams || []).find((candidate) => String(candidate.teamId) === String(team.opponentId));
    if (opponent && String(opponent.opponentId) !== String(team.teamId)) {
      details.push(`team ${team.teamId} and opponent ${team.opponentId} must reference each other`);
    }
  }
  for (const player of [...(snapshot?.roster || []), ...(snapshot?.availablePlayers || [])]) {
    if (!String(player?.name || player?.playerName || '').trim() || !position(player?.position)) {
      details.push('every roster and available player requires name and position');
      break;
    }
  }
  const targetMatches = (snapshot?.teams || []).filter((team) => team.isTarget || team.name === league.targetTeam);
  if (targetMatches.length !== 1) details.push(`exactly one team must match target team ${league.targetTeam} or set isTarget=true`);
  const usedSlots = new Map();
  const configuredSlots = new Map(Object.entries(league.roster || {}).map(([slot, count]) => [String(slot).toUpperCase(), Number(count) || 0]));
  for (const player of snapshot?.roster || []) {
    const slot = String(player?.rosterSlot || player?.slot || '').trim().toUpperCase();
    if (!slot) {
      details.push(`roster player ${player?.name || '(missing)'} requires a rosterSlot`);
      continue;
    }
    if (!configuredSlots.has(slot)) {
      details.push(`roster slot ${slot} is not configured for ${league.name}`);
      continue;
    }
    usedSlots.set(slot, (usedSlots.get(slot) || 0) + 1);
    if (!BENCH_SLOTS.has(slot) && !eligible(player, slot)) {
      details.push(`${player?.name || '(missing)'} (${position(player?.position)}) is not eligible for ${slot}`);
    }
  }
  for (const [slot, count] of usedSlots) {
    if (count > configuredSlots.get(slot)) details.push(`roster slot ${slot} contains ${count} players but allows ${configuredSlots.get(slot)}`);
  }
  if (details.length) throw weeklyError('INVALID_WEEKLY_SNAPSHOT', `Invalid weekly snapshot: ${details.join('; ')}`, details);
  return week;
}

function buildWeeklyReview({ snapshot, league, playerPool = { players: [] }, expectedWeek, preferSharedProjections = false }) {
  const week = validateWeeklySnapshot(snapshot, league, expectedWeek);
  const season = Number(snapshot.season || new Date().getFullYear());
  const poolByIdentity = new Map();
  for (const player of playerPool.players || []) {
    if (player.id) poolByIdentity.set(String(player.id).toLowerCase(), player);
    if (player.name) poolByIdentity.set(String(player.name).toLowerCase(), player);
  }
  const roster = snapshot.roster.map((player) => normalizePlayer(player, league, poolByIdentity, { preferSharedProjections }));
  const availablePlayers = snapshot.availablePlayers.map((player) => normalizePlayer(player, league, poolByIdentity, { preferSharedProjections }));
  const teams = teamResults(snapshot.teams);
  const targetTeam = teams.find((team) => team.isTarget || team.name === league.targetTeam);
  const topScore = Math.max(...teams.map((team) => finite(team.score)));
  const winners = teams.filter((team) => finite(team.score) === topScore).map((team) => ({ teamId: team.teamId, name: team.name, score: team.score }));
  const lineup = lineupReview(roster, league);
  if (lineup.optimalPoints + 0.001 < lineup.actualPoints) {
    throw weeklyError('INVALID_WEEKLY_LINEUP', 'Actual lineup points exceed the legal optimal lineup; verify roster slots and player results.');
  }
  const risks = lineupRisks(roster, week);
  const recommendation = waiverRecommendation({
    roster,
    availablePlayers,
    league,
    waiver: snapshot.waiver,
    holdThreshold: snapshot.holdThreshold
  });
  const transactions = (snapshot.transactions || []).map((transaction, index) => ({
    id: String(transaction.id || `transaction:${season}:${week}:${index + 1}`),
    type: String(transaction.type || 'unknown').toLowerCase(),
    teamId: transaction.teamId == null ? null : String(transaction.teamId),
    playersAdded: structuredClone(transaction.playersAdded || []),
    playersDropped: structuredClone(transaction.playersDropped || []),
    faab: transaction.faab == null ? null : finite(transaction.faab),
    successful: transaction.successful == null ? null : Boolean(transaction.successful),
    occurredAt: transaction.occurredAt || null
  }));
  return {
    schemaVersion: 1,
    leagueId: league.id,
    leagueName: league.name,
    targetTeam: league.targetTeam,
    season,
    week,
    observedAt: snapshot.observedAt || new Date().toISOString(),
    source: snapshot.source || 'normalized-import',
    weeklyWinners: winners,
    teams,
    targetResult: targetTeam,
    standings: [...teams].sort((a, b) => (a.standingRank ?? 999) - (b.standingRank ?? 999)),
    lineup,
    roster,
    availablePlayers,
    lineupRisks: risks,
    transactions,
    waiver: {
      rules: structuredClone(league.waivers || {}),
      state: structuredClone(snapshot.waiver || {}),
      recommendation
    },
    evidence: {
      sharedPlayerSource: playerPool.source || 'not-loaded',
      sharedFetchedAt: playerPool.fetchedAt || null,
      leagueScoringApplied: true,
      yahooAuthority: 'League scoring, roster, availability, and waiver rules are authoritative per league.',
      availablePlayersReviewed: availablePlayers.length,
      projectionsRefreshed: [...roster, ...availablePlayers].filter((player) => player.projectionRefreshed).length,
      sourceCoverage: {
        fantasyPros: availablePlayers.filter((player) => player.sourceCoverage.fantasyPros).length,
        tank01: availablePlayers.filter((player) => player.sourceCoverage.tank01).length,
        sleeper: availablePlayers.filter((player) => player.sourceCoverage.sleeper).length
      }
    },
    execution: 'recommendation-only'
  };
}

module.exports = {
  BENCH_SLOTS,
  buildWeeklyReview,
  defensePointsAllowed,
  eligible,
  lineupReview,
  lineupRisks,
  optimizeLineup,
  scorePlayerStats,
  startingSlots,
  validateWeeklySnapshot,
  waiverRecommendation
};
