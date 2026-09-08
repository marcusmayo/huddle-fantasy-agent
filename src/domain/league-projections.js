'use strict';
const { scorePlayerStats } = require('./weekly-management');

function leagueProjection(player, league) {
  if (player.projectedStats && player.projectedStatsComplete !== false) {
    const projectedPoints = scorePlayerStats(player.projectedStats, league);
    const spread = Math.max(12, Math.abs(projectedPoints) * .16);
    return {...player, projectedPoints, floor: Math.max(0,projectedPoints-spread), ceiling:projectedPoints+spread,
      rangeEstimated:true, projectionLeagueId:league.id, projectionScoringVerified:true,
      projectionSource:`${player.projectionSource || 'normalized-stats'}; scored for ${league.id}`};
  }
  if (player.projectionLeagueId === league.id && player.projectionScoringVerified === true) return {...player};
  return {...player, projectionScoringVerified:false,
    projectionScoringWarning:'Provider point total lacks a complete stat line or verified scoring match for this league; treat its custom-scoring value as an estimate.'};
}
module.exports = { leagueProjection };
