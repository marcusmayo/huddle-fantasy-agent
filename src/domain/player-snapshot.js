'use strict';

function normalizeTeam(value) {
  const team = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(team) || ['FA', 'NA', 'UNK'].includes(team)) return null;
  return ({ JAX: 'JAC', WSH: 'WAS', LA: 'LAR' })[team] || team;
}

function knownNumber(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

// Only normalized football evidence is retained, never a raw provider response.
function playerSnapshot(player = {}, context = {}) {
  const bye = knownNumber(player.byeWeek);
  const projectedPoints = knownNumber(player.projectedPoints);
  const snapshot = {
    team: normalizeTeam(player.team) || 'FA',
    byeWeek: Number.isInteger(bye) && bye >= 1 && bye <= 18 ? bye : null,
    injuryStatus: player.injuryStatus == null ? null : String(player.injuryStatus).slice(0, 32),
    projectedPoints,
    projectionScoringVerified: player.projectionScoringVerified === true,
    projectionImputed: player.projectionImputed === true,
    valueStatus: projectedPoints === null ? 'missing' : player.projectionScoringVerified === true ? 'verified' : 'estimated'
  };
  for (const field of ['projectionSource', 'projectionLeagueId', 'projectionScoringFingerprint', 'projectionScoringWarning', 'projectionPeriod', 'projectionSeason', 'evidenceObservedAt', 'injuryUpdatedAt', 'injuryObservedAt', 'injurySource', 'byeSource', 'byeObservedAt', 'teamSource', 'teamObservedAt', 'yahooEvidenceObservedAt', 'yahooEvidenceSeason']) {
    if (player[field] != null) snapshot[field] = String(player[field]).slice(0, 500);
  }
  if (context.observedAt) snapshot.evidenceObservedAt ||= context.observedAt;
  if (context.source) snapshot.evidenceSource = context.source;
  return snapshot;
}

function ownedPlayer(pick, poolPlayer) {
  const result = { ...poolPlayer, ...pick, id: pick.playerId, name: pick.playerName || poolPlayer?.name };
  for (const field of ['position', 'byeWeek', 'projectedPoints']) result[field] = pick[field] ?? poolPlayer?.[field] ?? null;
  result.team = normalizeTeam(pick.team) || normalizeTeam(poolPlayer?.team) || 'FA';
  result.valueStatus = knownNumber(result.projectedPoints) === null ? 'missing' : result.projectionScoringVerified === true ? 'verified' : 'estimated';
  return result;
}

module.exports = { normalizeTeam, knownNumber, playerSnapshot, ownedPlayer };
