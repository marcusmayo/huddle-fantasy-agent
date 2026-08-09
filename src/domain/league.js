'use strict';

const FLEX_POSITIONS = {
  'W/T': ['WR', 'TE'],
  'W/R': ['WR', 'RB'],
  'R/W/T': ['RB', 'WR', 'TE'],
  FLEX: ['RB', 'WR', 'TE'],
  'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'],
  SUPERFLEX: ['QB', 'WR', 'RB', 'TE']
};

function validateLeagueConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') errors.push('league config must be an object');
  if (!config?.id) errors.push('league id is required');
  if (!Number.isInteger(config?.teamCount) || config.teamCount < 2) {
    errors.push('teamCount must be an integer greater than one');
  }
  if (!config?.targetTeam) errors.push('targetTeam is required');
  if (!config?.roster || typeof config.roster !== 'object') errors.push('roster settings are required');
  for (const [slot, count] of Object.entries(config?.roster || {})) {
    if (!Number.isInteger(count) || count < 0) errors.push(`roster.${slot} must be a non-negative integer`);
  }
  if (config?.draft?.draftSlot !== null && config?.draft?.draftSlot !== undefined) {
    if (!Number.isInteger(config.draft.draftSlot) || config.draft.draftSlot < 1 || config.draft.draftSlot > config.teamCount) {
      errors.push('draft.draftSlot must be between 1 and teamCount');
    }
  }
  if (errors.length) {
    const error = new Error(`Invalid league configuration: ${errors.join('; ')}`);
    error.code = 'INVALID_LEAGUE_CONFIG';
    error.details = errors;
    throw error;
  }
  return config;
}

function draftedRosterSize(roster) {
  return Object.entries(roster)
    .filter(([slot]) => slot !== 'IR')
    .reduce((total, [, count]) => total + count, 0);
}

function positionTargets(roster) {
  const targets = {
    QB: roster.QB || 0,
    RB: roster.RB || 0,
    WR: roster.WR || 0,
    TE: roster.TE || 0,
    K: roster.K || 0,
    DEF: roster.DEF || 0
  };
  for (const [slot, positions] of Object.entries(FLEX_POSITIONS)) {
    const share = (roster[slot] || 0) / positions.length;
    for (const position of positions) targets[position] += share;
  }
  return targets;
}

function pickOwner(overallPick, teamCount) {
  const round = Math.floor((overallPick - 1) / teamCount) + 1;
  const positionInRound = ((overallPick - 1) % teamCount) + 1;
  return round % 2 === 1 ? positionInRound : teamCount - positionInRound + 1;
}

function nextUserPick(currentOverall, teamCount, draftSlot, includeCurrent = true) {
  if (!draftSlot) return null;
  const first = includeCurrent ? currentOverall : currentOverall + 1;
  for (let overall = first; overall <= currentOverall + teamCount * 3; overall += 1) {
    if (pickOwner(overall, teamCount) === draftSlot) return overall;
  }
  return null;
}

module.exports = {
  FLEX_POSITIONS,
  draftedRosterSize,
  nextUserPick,
  pickOwner,
  positionTargets,
  validateLeagueConfig
};
