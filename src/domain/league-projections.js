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
    const periodKnown = ['week', 'season'].includes(player.projectionPeriod);
    const aggregateNonlinear = player.projectionPeriod !== 'week' &&
      (player.projectedStats.pointsAllowed != null || (league.scoring?.fractionalPoints === false &&
        ['passingYards', 'rushingYards', 'receivingYards'].some(field => player.projectedStats[field] != null)));
    if (aggregateNonlinear) return {...player, projectionScoringVerified:false,
      projectionScoringWarning:'Season or unknown-period totals cannot reconstruct weekly points-allowed bins or whole-point yardage truncation; the provider point total remains an estimate.'};
    const projectedPoints = scorePlayerStats(player.projectedStats, league);
    const spread = Math.max(12, Math.abs(projectedPoints) * .16);
    const verified = periodKnown && player.projectedStatsComplete === true;
    return {...player, projectedPoints, floor: Math.max(0,projectedPoints-spread), ceiling:projectedPoints+spread,
      rangeEstimated:true, projectionLeagueId:league.id, projectionScoringVerified:verified,
      projectionScoringFingerprint:fingerprint,
      projectionScoringWarning:verified ? undefined : 'Normalized statistics were scored using linear rules, but their period or completeness is unverified; treat the total as an estimate.',
      projectionSource:`${player.projectionSource || 'normalized-stats'}; scored for ${league.id}`};
  }
  if (player.projectionLeagueId === league.id && player.projectionScoringVerified === true
    && player.projectionScoringFingerprint === fingerprint) return {...player};
  if (player.projectionLeagueId === league.id && player.projectionScoringFingerprint === fingerprint && player.projectionScoringWarning)
    return {...player, projectionScoringVerified:false};
  return {...player, projectionScoringVerified:false,
    projectionScoringWarning:'Provider point total lacks a complete stat line or verified scoring match for this league; treat its custom-scoring value as an estimate.'};
}
module.exports = { leagueProjection, scoringFingerprint };
