'use strict';
const { scorePlayerStats } = require('./weekly-management');
const crypto = require('node:crypto');

function scoringFingerprint(league) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return crypto.createHash('sha256').update(JSON.stringify(canonical({ scoring: league.scoring, scoringType: league.scoringType }))).digest('hex');
}

function leagueProjection(player, league) {
  const fingerprint = scoringFingerprint(league);
  if (player.projectedStats && player.projectedStatsComplete !== false) {
    const projectedPoints = scorePlayerStats(player.projectedStats, league);
    const spread = Math.max(12, Math.abs(projectedPoints) * .16);
    return {...player, projectedPoints, floor: Math.max(0,projectedPoints-spread), ceiling:projectedPoints+spread,
      rangeEstimated:true, projectionLeagueId:league.id, projectionScoringVerified:true,
      projectionScoringFingerprint:fingerprint,
      projectionSource:`${player.projectionSource || 'normalized-stats'}; scored for ${league.id}`};
  }
  if (player.projectionLeagueId === league.id && player.projectionScoringVerified === true
    && player.projectionScoringFingerprint === fingerprint) return {...player};
  return {...player, projectionScoringVerified:false,
    projectionScoringWarning:'Provider point total lacks a complete stat line or verified scoring match for this league; treat its custom-scoring value as an estimate.'};
}
module.exports = { leagueProjection, scoringFingerprint };
