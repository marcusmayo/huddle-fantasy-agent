'use strict';

const { draftedRosterSize, nextUserPick, pickOwner, positionTargets } = require('./league');

const BENCH_SLOTS = new Set(['BN', 'BENCH', 'IR', 'IL', 'NA']);
const SLOT_ELIGIBILITY = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DST: ['DEF'],
  'W/R': ['WR', 'RB'], 'W/T': ['WR', 'TE'], 'R/W/T': ['RB', 'WR', 'TE'], FLEX: ['RB', 'WR', 'TE'],
  'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'], SUPERFLEX: ['QB', 'WR', 'RB', 'TE']
};

const STYLES = {
  balanced: { vorp: 0.28, scarcity: 0.16, need: 0.17, urgency: 0.14, upside: 0.07, floor: 0.06, consensus: 0.12, risk: 0.08 },
  upside: { vorp: 0.22, scarcity: 0.13, need: 0.12, urgency: 0.12, upside: 0.25, floor: 0.04, consensus: 0.12, risk: 0.04 },
  safe: { vorp: 0.25, scarcity: 0.14, need: 0.20, urgency: 0.09, upside: 0.04, floor: 0.16, consensus: 0.12, risk: 0.14 }
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || max === min) return values.map(() => 0.5);
  return values.map((value) => (value - min) / (max - min));
}

function groupByPosition(players) {
  return players.reduce((groups, player) => {
    (groups[player.position] ||= []).push(player);
    return groups;
  }, {});
}

function starterSlots(roster = {}) {
  return Object.entries(roster).flatMap(([slot, count]) => {
    const normalized = String(slot).toUpperCase();
    if (BENCH_SLOTS.has(normalized)) return [];
    const eligibility = SLOT_ELIGIBILITY[normalized] || [normalized];
    return Array.from({ length: Math.max(0, Number(count) || 0) }, () => eligibility);
  });
}

function maximumStarterAssignments(positionCounts, roster) {
  const tokens = Object.entries(positionCounts).flatMap(([position, count]) =>
    Array.from({ length: Math.max(0, Number(count) || 0) }, () => position)
  );
  const slots = starterSlots(roster);
  const matchedTokenBySlot = Array(slots.length).fill(-1);
  function assign(tokenIndex, seen) {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (seen.has(slotIndex) || !slots[slotIndex].includes(tokens[tokenIndex])) continue;
      seen.add(slotIndex);
      if (matchedTokenBySlot[slotIndex] === -1 || assign(matchedTokenBySlot[slotIndex], seen)) {
        matchedTokenBySlot[slotIndex] = tokenIndex;
        return true;
      }
    }
    return false;
  }
  let filled = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    if (assign(tokenIndex, new Set())) filled += 1;
  }
  return filled;
}

function defaultPositionMaximums(league) {
  const roster = league.roster || {};
  const bench = Math.max(0, Number(roster.BN || roster.BENCH || 0));
  const slots = starterSlots(roster);
  const configured = league.rosterMaximums || {};
  return Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((position) => {
    const explicit = Number(configured[position]);
    if (Number.isInteger(explicit) && explicit >= 0) return [position, explicit];
    const starterCapacity = slots.filter((eligibility) => eligibility.includes(position)).length;
    if (!starterCapacity) return [position, 0];
    if (['K', 'DEF'].includes(position)) return [position, starterCapacity];
    if (['QB', 'TE'].includes(position)) return [position, starterCapacity + Math.min(2, Math.max(1, Math.ceil(bench / 3)))];
    return [position, starterCapacity + bench];
  }));
}

function assessRosterConstraint(player, mine, league) {
  const rosterSize = draftedRosterSize(league.roster);
  const selected = Object.values(mine).reduce((total, count) => total + count, 0);
  const remainingPicks = rosterSize - selected - 1;
  const maximums = defaultPositionMaximums(league);
  const counts = { ...mine, [player.position]: (mine[player.position] || 0) + 1 };
  const reasons = [];
  if (remainingPicks < 0) reasons.push('Target roster is already full.');
  if ((counts[player.position] || 0) > (maximums[player.position] ?? rosterSize)) {
    reasons.push(`${player.position} roster maximum of ${maximums[player.position]} would be exceeded.`);
  }
  const missingStarterSlots = starterSlots(league.roster).length - maximumStarterAssignments(counts, league.roster);
  if (missingStarterSlots > Math.max(0, remainingPicks)) {
    reasons.push(`This pick would leave ${missingStarterSlots} required starter slots for only ${Math.max(0, remainingPicks)} remaining picks.`);
  }
  return {
    feasible: reasons.length === 0,
    reasons,
    remainingPicks: Math.max(0, remainingPicks),
    missingStarterSlots,
    positionMaximum: maximums[player.position] ?? null
  };
}

function replacementBaselines(players, league) {
  const groups = groupByPosition(players);
  const targets = positionTargets(league.roster);
  const baselines = {};
  for (const [position, group] of Object.entries(groups)) {
    const sorted = [...group].sort((a, b) => b.projectedPoints - a.projectedPoints);
    const demand = Math.max(1, Math.round((targets[position] || 1) * league.teamCount));
    baselines[position] = sorted[Math.min(demand - 1, sorted.length - 1)]?.projectedPoints || 0;
  }
  return baselines;
}

function countMineByPosition(picks, playerById) {
  const counts = {};
  for (const pick of picks.filter((item) => item.isMine)) {
    const position = playerById.get(pick.playerId)?.position || pick.position;
    if (position) counts[position] = (counts[position] || 0) + 1;
  }
  return counts;
}

function calculateNeed(position, mine, targets) {
  const target = targets[position] || 0;
  const have = mine[position] || 0;
  if (target === 0) return 0.1;
  if (have < target) return clamp((target - have) / target, 0.25, 1);
  if (have < Math.ceil(target + 1)) return 0.14;
  return 0.04;
}

function availabilityAtPick(adp, nextPick) {
  if (!Number.isFinite(adp) || !nextPick) return 0.5;
  return clamp(1 / (1 + Math.exp(-(adp - nextPick) / 6)));
}

function phasePenalty(position, currentOverall, league) {
  if (!['K', 'DEF'].includes(position)) return 0;
  const totalPicks = draftedRosterSize(league.roster) * league.teamCount;
  const phase = currentOverall / totalPicks;
  if (phase < 0.55) return 0.42;
  if (phase < 0.75) return 0.18;
  return 0;
}

function injuryPenalty(player) {
  const status = String(player.injuryStatus || '').toLowerCase();
  if (['ir', 'out', 'pup'].includes(status)) return 0.35;
  if (['doubtful'].includes(status)) return 0.22;
  if (['questionable'].includes(status)) return 0.08;
  return 0;
}

function whyLines(player, components, mine, targets, waitProbability) {
  const lines = [];
  const have = mine[player.position] || 0;
  const target = targets[player.position] || 0;
  if (components.need >= 0.65) lines.push(`${player.position} need: ${have} drafted against a ${target.toFixed(1)}-slot target.`);
  if (components.vorp >= 0.7) lines.push('Strong value above the currently available replacement level.');
  if (components.scarcity >= 0.7) lines.push(`A meaningful ${player.position} tier drop follows this player.`);
  if (components.upside >= 0.75) lines.push('Ceiling projection creates above-average upside.');
  if (player.sourceDisagreement) lines.push('FantasyPros and Tank01 disagree materially; review both source ranks.');
  if (player.sleeperTrend?.direction === 'rising') lines.push('Sleeper add activity is rising and breaks close ranking ties.');
  if (waitProbability < 0.35) lines.push('Model says this player is unlikely to reach your next turn.');
  if (!lines.length) lines.push('Best blended projection, roster-fit, scarcity, and next-turn value.');
  return lines.slice(0, 3);
}

function scoreAvailablePlayers({ players, picks, league, draftSlot, style = 'balanced' }) {
  if (!STYLES[style]) throw new Error(`Unknown recommendation style: ${style}`);
  const draftedIds = new Set(picks.map((pick) => pick.playerId));
  const available = players.filter((player) => !draftedIds.has(player.id));
  if (!available.length) return [];

  const playerById = new Map(players.map((player) => [player.id, player]));
  const groups = groupByPosition(available);
  for (const group of Object.values(groups)) group.sort((a, b) => b.projectedPoints - a.projectedPoints);
  const baselines = replacementBaselines(available, league);
  const targets = positionTargets(league.roster);
  const mine = countMineByPosition(picks, playerById);
  const currentOverall = picks.length + 1;
  const currentOwner = draftSlot ? pickOwner(currentOverall, league.teamCount) : null;
  const nextPick = nextUserPick(
    currentOverall,
    league.teamCount,
    draftSlot,
    currentOwner !== draftSlot
  );
  const raw = available.map((player) => {
    const positionGroup = groups[player.position] || [];
    const positionIndex = positionGroup.findIndex((candidate) => candidate.id === player.id);
    const nextAtPosition = positionGroup[positionIndex + 1];
    const waitProbability = availabilityAtPick(player.adp, nextPick);
    const rosterConstraint = assessRosterConstraint(player, mine, league);
    return {
      player,
      waitProbability,
      rosterConstraint,
      vorp: player.projectedPoints - (baselines[player.position] || 0),
      scarcity: Math.max(0, player.projectedPoints - (nextAtPosition?.projectedPoints || baselines[player.position] || 0)),
      need: calculateNeed(player.position, mine, targets),
      urgency: 1 - waitProbability,
      upside: Math.max(0, player.ceiling - player.projectedPoints),
      floor: player.floor,
      consensus: Number.isFinite(player.sourceConsensus) ? player.sourceConsensus : 0.5,
      risk: clamp(Number(player.risk) || 0) + injuryPenalty(player),
      penalty: phasePenalty(player.position, currentOverall, league)
    };
  });

  const normalized = {};
  for (const key of ['vorp', 'scarcity', 'need', 'urgency', 'upside', 'floor']) {
    normalized[key] = normalize(raw.map((row) => row[key]));
  }
  const weights = STYLES[style];
  return raw.map((row, index) => {
    const components = Object.fromEntries(
      ['vorp', 'scarcity', 'need', 'urgency', 'upside', 'floor'].map((key) => [key, normalized[key][index]])
    );
    components.consensus = row.consensus;
    const positive = Object.entries(components).reduce((sum, [key, value]) => sum + value * weights[key], 0);
    const trendAdjustment = row.player.sleeperTrend?.direction === 'rising' ? 0.01
      : row.player.sleeperTrend?.direction === 'falling' ? -0.01
        : 0;
    const score = row.rosterConstraint.feasible
      ? clamp(positive - row.risk * weights.risk - row.penalty + trendAdjustment)
      : 0;
    const sleeper = Number.isFinite(row.player.adp)
      && Number.isFinite(row.player.expertRank)
      && row.player.adp - row.player.expertRank >= 10
      && row.player.ceiling - row.player.projectedPoints >= 45;
    return {
      player: row.player,
      score: Math.round(score * 1000) / 10,
      rosterFeasible: row.rosterConstraint.feasible,
      rosterConstraint: row.rosterConstraint,
      style,
      sleeper,
      waitProbability: Math.round(row.waitProbability * 1000) / 1000,
      risk: Math.round(row.risk * 1000) / 1000,
      trendAdjustment: Math.round(trendAdjustment * 1000) / 10,
      components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 1000) / 1000])),
      why: row.rosterConstraint.feasible
        ? whyLines(row.player, components, mine, targets, row.waitProbability)
        : row.rosterConstraint.reasons.slice(0, 3)
    };
  }).sort((a, b) => Number(b.rosterFeasible) - Number(a.rosterFeasible)
    || b.score - a.score || a.player.expertRank - b.player.expertRank);
}

function buildRecommendationCard(input) {
  const board = scoreAvailablePlayers({ ...input, style: 'balanced' });
  const upside = scoreAvailablePlayers({ ...input, style: 'upside' });
  const safe = scoreAvailablePlayers({ ...input, style: 'safe' });
  const picks = input.picks;
  const currentOverall = picks.length + 1;
  const owner = input.draftSlot ? pickOwner(currentOverall, input.league.teamCount) : null;
  const preferred = board.find((item) => item.rosterFeasible) || null;
  return {
    generatedAt: new Date().toISOString(),
    currentOverall,
    draftSlot: input.draftSlot || null,
    onClock: Boolean(input.draftSlot && owner === input.draftSlot),
    nextUserPick: nextUserPick(currentOverall, input.league.teamCount, input.draftSlot, owner !== input.draftSlot),
    preferred,
    alternatives: {
      safe: safe.find((item) => item.rosterFeasible && item.player.id !== preferred?.player.id) || preferred,
      upside: upside.find((item) => item.rosterFeasible && item.player.id !== preferred?.player.id) || preferred
    },
    board
  };
}

module.exports = {
  STYLES,
  assessRosterConstraint,
  availabilityAtPick,
  buildRecommendationCard,
  defaultPositionMaximums,
  maximumStarterAssignments,
  replacementBaselines,
  scoreAvailablePlayers
};
