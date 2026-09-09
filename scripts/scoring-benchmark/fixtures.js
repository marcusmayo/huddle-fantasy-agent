'use strict';
const { createHash } = require('node:crypto');
const { scoringFingerprint } = require('../../src/domain/league-projections');
const example = require('../../config/leagues/yahoo-example.json');

// Keyed noise keeps unrelated random draws, policy order and branch traversal
// from changing an opponent's preferences. It is not a calibrated room model.
function noise(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest().readUInt32BE(0) / 0x100000000;
}
function syntheticFixture(seed, split = 'development') {
  const league = { ...structuredClone(example), id: 'synthetic-dr-benchmark', name: 'SIMULATED DR scoring benchmark',
    roster: { QB: 2, WR: 4, RB: 3, TE: 1, 'W/T': 1, 'W/R': 1, K: 1, DEF: 2, BN: 5, IR: 2 },
    provenance: { source: 'Synthetic scenario with observed DR roster/scoring rules', season: 2026 } };
  const basis = { source: 'SIMULATED common projection input', version: `generator-v1:${seed}`, season: 2026,
    period: 'season', scoringFingerprint: scoringFingerprint(league), observedAt: '2026-09-08T23:00:00.000Z' };
  const shapes = { QB: [32, 440, 7, 270, .6], RB: [52, 325, 4.4, 90, 1], WR: [64, 310, 3, 90, 1],
    TE: [26, 240, 5, 70, .8], K: [20, 155, 2, 130, .4], DEF: [22, 170, 3, 130, .4] };
  let ordinal = 0;
  const players = Object.entries(shapes).flatMap(([position, [count, top, slope, replacement, marketWeight]]) =>
    Array.from({ length: count }, (_, index) => {
      const id = `sim-${position}-${index + 1}`;
      const marketShift = split === 'held-out' ? .82 + noise(seed, position, 'shift') * .36 : 1;
      const points = Math.round(Math.max(20, top - slope * index - Math.floor(index / 8) * 7 + (noise(seed, id, 'points') - .5) * 22) * 100) / 100;
      const market = (points - replacement) * marketWeight * marketShift + (noise(seed, id, 'price') - .5) * 35;
      return { id, name: `SIMULATED ${position} ${index + 1}`, position, team: 'BUF', yahooPlayerKey: String(900000 + ++ordinal),
        projectedPoints: points, floor: points * .84, ceiling: points * 1.16, rangeEstimated: true, risk: .2,
        byeWeek: 5 + Math.floor(noise(seed, id, 'bye') * 10), sourceConsensus: .5,
        projectionSource: basis.source, projectionLeagueId: league.id, projectionScoringFingerprint: basis.scoringFingerprint,
        projectionScoringVerified: true, projectionSeason: basis.season, projectionPeriod: basis.period,
        projectionBasis: { ...basis }, injuryStatus: '', injurySource: 'SIMULATED designation', injuryObservedAt: basis.observedAt,
        injurySeason: basis.season, market };
    }));
  const marketOrder = [...players].sort((a, b) => b.market - a.market || a.id.localeCompare(b.id));
  marketOrder.forEach((player, index) => { player.adp = index + 1; player.expertRank = index + 1; player.tier = 1 + Math.floor(index / 12); delete player.market; });
  return { schemaVersion: 1, kind: 'synthetic', seed, split, league, basis,
    adpBasis: { source: 'SIMULATED market order', format: 'Six-team two-QB DR scenario assumptions; no observed room distribution', observedAt: basis.observedAt }, players,
    limitation: 'Synthetic player values and opponent preferences. No Yahoo projection, actual injury report, season outcome or grade is reproduced.' };
}
module.exports = { noise, syntheticFixture };
