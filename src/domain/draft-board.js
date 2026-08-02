'use strict';

const { draftedRosterSize, nextUserPick, pickOwner, positionTargets } = require('./league');

const STYLES = {
  balanced: { vorp: 0.34, scarcity: 0.18, need: 0.18, urgency: 0.15, upside: 0.08, floor: 0.07, risk: 0.08 },
  upside: { vorp: 0.26, scarcity: 0.14, need: 0.13, urgency: 0.13, upside: 0.28, floor: 0.06, risk: 0.04 },
  safe: { vorp: 0.30, scarcity: 0.16, need: 0.22, urgency: 0.10, upside: 0.04, floor: 0.18, risk: 0.14 }
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
    return {
      player,
      waitProbability,
      vorp: player.projectedPoints - (baselines[player.position] || 0),
      scarcity: Math.max(0, player.projectedPoints - (nextAtPosition?.projectedPoints || baselines[player.position] || 0)),
      need: calculateNeed(player.position, mine, targets),
      urgency: 1 - waitProbability,
      upside: Math.max(0, player.ceiling - player.projectedPoints),
      floor: player.floor,
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
    const positive = Object.entries(components).reduce((sum, [key, value]) => sum + value * weights[key], 0);
    const score = clamp(positive - row.risk * weights.risk - row.penalty);
    const sleeper = Number.isFinite(row.player.adp)
      && Number.isFinite(row.player.expertRank)
      && row.player.adp - row.player.expertRank >= 10
      && row.player.ceiling - row.player.projectedPoints >= 45;
    return {
      player: row.player,
      score: Math.round(score * 1000) / 10,
      style,
      sleeper,
      waitProbability: Math.round(row.waitProbability * 1000) / 1000,
      risk: Math.round(row.risk * 1000) / 1000,
      components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 1000) / 1000])),
      why: whyLines(row.player, components, mine, targets, row.waitProbability)
    };
  }).sort((a, b) => b.score - a.score || a.player.expertRank - b.player.expertRank);
}

function buildRecommendationCard(input) {
  const board = scoreAvailablePlayers({ ...input, style: 'balanced' });
  const upside = scoreAvailablePlayers({ ...input, style: 'upside' });
  const safe = scoreAvailablePlayers({ ...input, style: 'safe' });
  const picks = input.picks;
  const currentOverall = picks.length + 1;
  const owner = input.draftSlot ? pickOwner(currentOverall, input.league.teamCount) : null;
  const preferred = board[0] || null;
  return {
    generatedAt: new Date().toISOString(),
    currentOverall,
    draftSlot: input.draftSlot || null,
    onClock: Boolean(input.draftSlot && owner === input.draftSlot),
    nextUserPick: nextUserPick(currentOverall, input.league.teamCount, input.draftSlot, owner !== input.draftSlot),
    preferred,
    alternatives: {
      safe: safe.find((item) => item.player.id !== preferred?.player.id) || safe[0] || null,
      upside: upside.find((item) => item.player.id !== preferred?.player.id) || upside[0] || null
    },
    board: board.slice(0, 12)
  };
}

module.exports = {
  STYLES,
  availabilityAtPick,
  buildRecommendationCard,
  replacementBaselines,
  scoreAvailablePlayers
};
