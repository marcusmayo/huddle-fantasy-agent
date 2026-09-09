'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBaseline } = require('../scripts/scoring-benchmark/baseline');
const { syntheticFixture, noise } = require('../scripts/scoring-benchmark/fixtures');
const { validateFixture, stateFor, compareNextTurn, advance, opponentChoice, runDraft, releaseGate, evaluateRoster, choose } = require('../scripts/scoring-benchmark/core');
const baseline = loadBaseline();
const player = (id, position, projectedPoints, adp) => ({ id, name: id, position, projectedPoints, adp, expertRank: adp, byeWeek: 8, risk: .1 });

test('common-input fixture rejects mixed scoring, period, source version, identities and missing evidence', () => {
  const fixture = syntheticFixture(101);
  assert.equal(typeof validateFixture(fixture), 'string');
  for (const mutate of [f => { f.players[0].projectionBasis.version = 'different'; }, f => { f.players[0].projectionPeriod = 'week'; },
    f => { f.players[0].projectionScoringVerified = false; }, f => { f.players[0].projectionImputed = true; },
    f => { f.players[0].byeWeek = null; }, f => { f.players[0].yahooPlayerKey = f.players[1].yahooPlayerKey; },
    f => { f.league.scoring.offense.passingTouchdown = 4; }, f => { f.adpBasis.format = ''; },
    f => { f.players[0].projectedPoints = NaN; }]) {
    const bad = structuredClone(fixture); mutate(bad); assert.throws(() => validateFixture(bad), /Incomparable/);
  }
});

test('two-choice comparison waits on deep QB supply but protects the scarce QB tier', () => {
  const league = { teamCount: 2, roster: { QB: 1, WR: 1, BN: 0 } };
  const makeState = players => ({ league, players, available: players, picks: [], teams: [[], []], seat: 1 });
  const deepQb = makeState([player('QB-A', 'QB', 300, 3), player('QB-B', 'QB', 298, 4), player('QB-C', 'QB', 296, 5),
    player('WR-A', 'WR', 200, 1), player('WR-B', 'WR', 150, 2), player('WR-C', 'WR', 100, 6)]);
  const comparison = compareNextTurn(deepQb, baseline);
  assert.equal(comparison.preferred.id, 'WR-A');
  assert.equal(comparison.target, 4);
  const qbFirst = comparison.rows.find(row => row.player.id === 'QB-A');
  assert.ok(comparison.rows[0].meanGain > qbFirst.meanGain + 40);
  assert.ok(comparison.rows[0].scenarios.every(row => row.nextPlayer.startsWith('QB')));
  const scarce = makeState([player('QB-A', 'QB', 300, 1), player('QB-B', 'QB', 100, 2), player('QB-C', 'QB', 80, 3),
    player('WR-A', 'WR', 200, 20), player('WR-B', 'WR', 199, 21), player('WR-C', 'WR', 198, 22)]);
  assert.equal(compareNextTurn(scarce, baseline).preferred.id, 'QB-A');
});

test('consecutive snake turns contain no imaginary opponent pick and final turn has no follow-up', () => {
  const league = { teamCount: 2, roster: { QB: 1, WR: 1, BN: 0 } };
  const players = [player('QB-A', 'QB', 300, 1), player('QB-B', 'QB', 298, 2), player('WR-A', 'WR', 200, 3), player('WR-B', 'WR', 190, 4)];
  let state = { league, players, available: players, picks: [], teams: [[], []], seat: 2 };
  state = advance(state, players[0], baseline);
  const pair = compareNextTurn(state, baseline);
  assert.equal(pair.target, 3);
  assert.ok(pair.rows.every(row => row.scenarios.every(s => s.nextPlayer !== row.player.id)));
  state = advance(state, pair.preferred, baseline);
  assert.equal(compareNextTurn(state, baseline).target, null);
  assert.ok(compareNextTurn(state, baseline).rows.every(row => row.scenarios.every(s => s.nextPlayer === null)));
});

test('candidate sees only current state while opponent randomness is stable across policy order', () => {
  const fixture = syntheticFixture(101), state = stateFor(fixture, 1);
  const first = compareNextTurn(state, baseline);
  const changedSeed = { ...fixture, seed: 999999 };
  assert.equal(compareNextTurn(stateFor(changedSeed, 1), baseline).preferred.id, first.preferred.id);
  const expected = opponentChoice(state, baseline, 'qb-run', 71).id;
  for (let index = 0; index < 200; index++) noise('unrelated', index);
  assert.equal(opponentChoice(state, baseline, 'qb-run', 71).id, expected);
  assert.deepEqual(compareNextTurn(state, baseline), first);
  assert.equal(state.picks.length, 0);
});

test('independent lineup metric flags missing DEF2 and separates bye legality from point loss', () => {
  const league = { roster: { QB: 1, WR: 1, DEF: 2, BN: 1 }, teamCount: 6 };
  const team = [player('Q', 'QB', 340, 1), player('W', 'WR', 170, 2), player('D1', 'DEF', 170, 3), player('D2', 'DEF', 170, 4),
    { ...player('backup', 'QB', 170, 5), byeWeek: 9 }];
  const metric = evaluateRoster(team, league, baseline);
  assert.equal(metric.complete, true);
  assert.ok(metric.byePointLoss > 0);
  assert.equal(metric.byeWeeks.find(row => row.week === 8).missing.includes('QB:1'), false);
  const short = evaluateRoster(team.filter(row => row.id !== 'D2'), league, baseline);
  assert.equal(short.complete, false);
  assert.ok(short.missingStarters.includes('DEF:2') || short.missingStarters.includes('DEF:1'));
  assert.equal(metric.normalStartingLineupSeasonTotal, 850);
  assert.ok(metric.uniformWeekLineupPoints < metric.normalStartingLineupSeasonTotal);
});

test('complete six-team replay uses common constraints without mutating or repeating players', () => {
  const fixture = syntheticFixture(101), before = JSON.stringify(fixture);
  const run = runDraft(fixture, baseline, { seat: 6, behavior: 'qb-run', policy: 'adp', audit: false });
  assert.equal(run.completedPicks, 120);
  assert.equal(run.uniquePicks, 120);
  assert.equal(run.metrics.complete, true);
  assert.equal(run.allRostersComplete, true);
  assert.equal(run.decisions.length, 20);
  assert.equal(run.metrics.positions.DEF, 2);
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(releaseGate([run]).eligible, false);
  assert.equal(releaseGate([run]).released, false);
  assert.throws(() => choose(stateFor(fixture, 1), baseline, 'unknown'), /Unknown policy/);
});

test('release gate rejects missing matrix cells, duplicates and mismatched input pairs', () => {
  const base = { key: 'held-out:307:adp:1', split: 'held-out', kind: 'synthetic', seed: 307, behavior: 'adp', seat: 1,
    policy: 'frozen-huddle', inputHash: 'same', metrics: { complete: true, uniformWeekLineupPoints: 100 }, failures: [], decisions: [] };
  const candidate = { ...base, policy: 'next-turn', metrics: { complete: true, uniformWeekLineupPoints: 110 } };
  const gate = releaseGate([base, candidate]);
  assert.equal(gate.checks.completePairs, true);
  assert.equal(gate.checks.completeMatrix, false);
  assert.equal(gate.checks.independentSourcedInputs, false);
  assert.equal(gate.checks.actualBrowserTimingAccepted, false);
  assert.equal(gate.eligible, false);
  assert.equal(releaseGate([base, { ...candidate, inputHash: 'other' }]).checks.completePairs, false);
  assert.equal(releaseGate([base, base, candidate]).checks.completeMatrix, false);
});

test('artifact check detects duplicate identities, wrong snake turns and inflated lineup value', () => {
  const { verifyRun } = require('../scripts/scoring-benchmark/verify');
  const fixture = syntheticFixture(211);
  const run = runDraft(fixture, baseline, { seat: 1, behavior: 'balanced', policy: 'projection', audit: false });
  assert.equal(verifyRun(run, fixture, baseline), true);
  for (const mutate of [r => { r.draftedPlayers[1] = r.draftedPlayers[0]; },
    r => { r.decisions[0].overall = 2; }, r => { r.metrics.uniformWeekLineupPoints += 10; }]) {
    const bad = structuredClone(run); mutate(bad); assert.throws(() => verifyRun(bad, fixture, baseline));
  }
});

test('artifact verification can establish a dependency lock against the declared Git source', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { lockEvaluation } = require('../scripts/scoring-benchmark/verify');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-evaluation-lock-'));
  const file = path.join(directory, 'evaluation-source-lock.json');
  try {
    lockEvaluation(directory);
    const before = fs.readFileSync(file, 'utf8'), lock = JSON.parse(before);
    assert.equal(lock.commit, baseline.commit);
    assert.equal(Object.keys(lock.gitBlobs).length, 6);
    lockEvaluation(directory);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(directory); }
});
