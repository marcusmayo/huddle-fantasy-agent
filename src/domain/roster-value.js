'use strict';

const { FLEX_POSITIONS, positionTargets } = require('./league');

const points = player => Math.max(0, Number(player.projectedPoints) || 0);

function seasonLineup(players, roster, valueField = 'projectedPoints') {
  const points = player => Math.max(0, Number(player[valueField]) || 0);
  const groups = {};
  for (const player of players) (groups[player.position] ||= []).push(player);
  for (const group of Object.values(groups)) group.sort((a, b) => points(b) - points(a));
  const starters = [];
  const assignments = [];
  const flex = [];
  for (const [slot, count] of Object.entries(roster)) {
    if (['BN', 'BENCH', 'IR', 'IL', 'NA'].includes(slot)) continue;
    if (FLEX_POSITIONS[slot]) { for (let i = 0; i < count; i++) flex.push({slot, slotIndex:i+1, positions:FLEX_POSITIONS[slot]}); continue; }
    for (let i = 0; i < count; i++) {
      const player = groups[slot === 'DST' ? 'DEF' : slot]?.shift();
      if (player && points(player) > 0) starters.push(player);
      assignments.push({slot, slotIndex:i+1, player:player && points(player)>0 ? player : null});
    }
  }
  function fill(index, counts) {
    if (index === flex.length) return { total: 0, assignments: [] };
    const skipped = fill(index + 1, counts);
    const {slot,slotIndex} = flex[index];
    let best = {total:skipped.total, assignments:[{slot,slotIndex,player:null},...skipped.assignments]};
    for (const position of flex[index].positions) {
      const offset = counts[position] || 0;
      const player = groups[position]?.[offset];
      if (!player) continue;
      const next = fill(index + 1, { ...counts, [position]: offset + 1 });
      if (points(player) + next.total > best.total) best = { total: points(player) + next.total, assignments: [{slot,slotIndex,player}, ...next.assignments] };
    }
    return best;
  }
  const chosen = fill(0, {});
  const allAssignments = [...assignments,...chosen.assignments];
  return { total: starters.reduce((sum, player) => sum + points(player), 0) + chosen.total, players: allAssignments.map(item=>item.player).filter(Boolean), assignments:allAssignments };
}

// A transparent season-projection heuristic, not a calibrated injury simulation.
// Replacement placeholders prevent an empty QB slot from valuing all QB points
// as an advantage over an available streaming option. Bench weights diminish
// with depth; there is no fixed RB/WR quota and an exceptional upgrade can win.
function rosterValue(players, league, baselines) {
  const targets = positionTargets(league.roster);
  const replacements = Object.entries(baselines).flatMap(([position, value]) =>
    Array.from({ length: Object.entries(league.roster).reduce((sum, [slot, count]) => sum + ((FLEX_POSITIONS[slot] || [slot]).includes(position) ? count : 0), 0) }, (_, i) => ({ id: `replacement:${position}:${i}`, position, projectedPoints: value, replacement: true })));
  const lineup = seasonLineup([...players, ...replacements], league.roster);
  const starters = lineup.players.filter(player => !player.replacement);
  const starterIds = new Set(starters.map(player => player.id));
  const depth = {};
  let insurance = 0;
  for (const player of [...players].filter(player => !starterIds.has(player.id)).sort((a, b) => points(b) - points(a))) {
    const rank = depth[player.position] = (depth[player.position] || 0) + 1;
    const target = targets[player.position] || 0;
    const weight = ['RB', 'WR'].includes(player.position) ? Math.min(.5, .12 * target) : player.position === 'TE' ? Math.min(.35, .09 * target) : player.position === 'QB' ? Math.min(.35, .08 * target) : 0;
    // A player matching today's best undrafted option still has ownership
    // value: that option is not guaranteed to remain free after injuries.
    // The 15% floor is a conservative sensitivity assumption, not an injury
    // probability; position weight and depth discount still apply afterward.
    insurance += Math.max(0, points(player) - (baselines[player.position] || 0), points(player) * .15) * weight / rank ** 1.7;
  }
  // Offensive bye cover must come from owned players. The old calculation
  // supplied a full-strength hypothetical waiver QB and credited a reserve
  // only for beating that QB, hiding the actual empty bye-week slot.
  // K/DEF streaming remains an explicit strategy assumption; their benefit is
  // measured above the league-specific observed replacement estimate.
  let byeCoverage = 0;
  const ownedStarters = seasonLineup(players, league.roster).players;
  const streamPositions = league.draftStrategy?.streamingPositions || ['K', 'DEF'];
  const streamReplacements = replacements.filter(player => streamPositions.includes(player.position));
  for (const week of new Set(ownedStarters.map(player => player.byeWeek).filter(week => Number.isInteger(week) && week > 0))) {
    const without = players.filter(player => player.byeWeek !== week);
    const byeLineup = seasonLineup([...without, ...streamReplacements], league.roster);
    const withoutReserves = seasonLineup([...ownedStarters.filter(player => player.byeWeek !== week), ...streamReplacements], league.roster);
    byeCoverage += Math.max(0, byeLineup.total - withoutReserves.total) / 17;
  }
  return { total: lineup.total + insurance + byeCoverage, starters: lineup.total, insurance, byeCoverage, depth };
}

function byeCoverageReport(players, league) {
  const starters = seasonLineup(players, league.roster);
  const weeks = [...new Set(starters.players.map(player => player.byeWeek).filter(week => Number.isInteger(week) && week >= 1 && week <= 18))].sort((a,b)=>a-b);
  const gaps = weeks.flatMap(week => {
    const available = seasonLineup(players.filter(player => player.byeWeek !== week), league.roster);
    const base = new Map(starters.assignments.filter(item=>item.player).map(item=>[`${item.slot}:${item.slotIndex}`,item]));
    return available.assignments.filter(item=>!item.player && base.has(`${item.slot}:${item.slotIndex}`))
      .map(item=>({week,slot:item.slot,slotIndex:item.slotIndex}));
  });
  const unknownByes = players.filter(player=>!Number.isInteger(player.byeWeek)||player.byeWeek<1||player.byeWeek>18).length;
  const unknownValues = players.filter(player => player.projectedPoints == null || !Number.isFinite(Number(player.projectedPoints))).length;
  const weeklyLosses = weeks.map(week => {
    const available = seasonLineup(players.filter(player => player.byeWeek !== week), league.roster);
    return { week, estimatedPointsLost: Math.round(Math.max(0, starters.total - available.total) / 17 * 100) / 100 };
  });
  return {gaps, unknownByes, unknownValues,
    coverageVerified: unknownByes === 0 && unknownValues === 0,
    weeklyLosses: unknownByes || unknownValues ? null : weeklyLosses,
    lossBasis: 'Season totals divided by 17 games; owned replacements only, not a matchup-specific weekly forecast.',
    streamingPositions:league.draftStrategy?.streamingPositions || ['K','DEF'],
    assumption:'Future waiver availability is unverified. Offensive bye coverage is valued from owned players; K/DEF streaming uses an estimate.'};
}

function contribution(player, owned, league, baselines, before = rosterValue(owned, league, baselines)) {
  const after = rosterValue([...owned, player], league, baselines);
  return {
    marginalValue: Math.max(0, after.total - before.total),
    starterGain: Math.max(0, after.starters - before.starters),
    insuranceGain: after.insurance - before.insurance,
    byeCoverageGain: after.byeCoverage - before.byeCoverage,
    replacementPoints: baselines[player.position] || 0,
    positionCountAfter: owned.filter(item => item.position === player.position).length + 1,
    projectionBasis: 'season projection; diminishing bench coverage heuristic'
  };
}

module.exports = { contribution, rosterValue, seasonLineup, byeCoverageReport };
