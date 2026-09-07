'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const { pickOwner } = require('../src/domain/league');
const { resolvePlayer } = require('../src/domain/mock-room');
const os = require('node:os');
const { buildApp } = require('../src/server');

const NOW = new Date('2026-09-07T22:00:00Z');
const league = {
  id: 'practice', platform: 'manual', name: 'Practice', targetTeam: 'Your Team', teamCount: 8,
  roster: { QB: 1, WR: 2, RB: 2, TE: 1, 'R/W/T': 1, K: 1, DEF: 1, BN: 6, IR: 0 },
  scoring: { offense: { reception: 0.5, passingTouchdown: 4 } }
};
const recorded = fs.readFileSync(path.join(__dirname, 'fixtures/mock-10980489.tsv'), 'utf8').trim().split('\n').map((line) => {
  const [pick, name, position, team] = line.trim().split('\t');
  return { overallPick: +pick, name, position, team, isMine: pickOwner(+pick, 8) === 3 };
});
const candidate = (name, position = 'WR', team = 'BUF', rank = 1) => ({ name, position, team, expertRank: rank, adp: rank + 1, projectedPoints: 300 - rank });

function setup(pool = []) {
  let time = NOW;
  const store = new MemoryStateStore();
  let writes = 0;
  const save = store.save.bind(store);
  store.save = (value) => { writes += 1; save(value); };
  const service = new DraftService({ league, playerPool: { source: 'fixture', players: pool }, store, now: () => time });
  const session = service.createSession({ draftSlot: 3, sourceMode: 'mock' });
  return { service, session, store, writes: () => writes, advance: (ms) => { time = new Date(NOW.getTime() + ms); } };
}

function snapshot(count = 0, overrides = {}) {
  return {
    roomId: '10980489', draftSlot: 3, teamCount: 8, observedAt: NOW.toISOString(), autodraft: false,
    phase: count === 120 ? 'completed' : 'drafting', currentOverall: count + 1,
    rules: { receptionPoints: 0.5, passingTouchdown: 4, roster: league.roster },
    picks: recorded.slice(0, count),
    availablePlayers: count === 120 ? [] : [candidate('Practice Receiver'), candidate('Practice Runner', 'RB'), candidate('Practice Quarterback', 'QB'), candidate('Practice Tightend', 'TE'), candidate('Practice Kicker', 'K'), candidate('Practice Defense', 'DEF')],
    ...overrides
  };
}

test('HTTP snapshot and workspace return a consistent board and reject conflicts without partial writes', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-mock-http-'));
  const app = buildApp({
    host: '127.0.0.1', port: 0, instanceName: 'mock-http-test',
    auditFile: path.join(tempDir, 'audit.jsonl'), fantasyProsSyncEnabled: false,
    fantasyProsCacheDir: path.join(tempDir, 'cache'), league,
    stateFile: path.join(tempDir, 'state.json'), defaultLeagueId: league.id,
    leagues: [{ id: league.id, config: league, stateFile: path.join(tempDir, 'state.json') }],
    playerPool: { source: 'fixture', players: [] }
  }, { storeFactory: () => new MemoryStateStore() });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/api/leagues/practice/draft/sessions`;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const created = await post(base, { draftSlot: 3, sourceMode: 'mock' });
    assert.equal(created.status, 201);
    const session = await created.json();
    const room = snapshot(14, { observedAt: new Date().toISOString() });
    const imported = await post(`${base}/${session.id}/mock-snapshot`, room);
    assert.equal(imported.status, 200);
    const saved = await imported.json();
    assert.equal(saved.session.currentOverall, 15);
    assert.equal(saved.imported, 14);
    assert.ok(saved.card.preferred);
    assert.equal(saved.card.mockReadiness.ready, true);
    assert.ok(saved.card.explanation);
    const workspace = await (await fetch(`${base}/${session.id}/workspace`)).json();
    assert.equal(workspace.session.picks.length, 14);
    assert.equal(workspace.card.preferred.player.id, saved.card.preferred.player.id);
    room.picks = structuredClone(room.picks);
    room.picks[13].name = 'Conflicting Player';
    room.observedAt = new Date().toISOString();
    const rejected = await post(`${base}/${session.id}/mock-snapshot`, room);
    assert.notEqual(rejected.status, 200);
    assert.equal((await rejected.json()).error, 'MOCK_PICK_CONFLICT');
    const after = await (await fetch(`${base}/${session.id}/workspace`)).json();
    assert.deepEqual(after.session.picks, saved.session.picks);
  } finally {
    await new Promise(resolve => app.commandRelay.close(resolve));
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a burst of 14 picks commits once, derives snake ownership, and is idempotent', () => {
  const x = setup();
  const before = x.writes();
  const result = x.service.importMockSnapshot(x.session.id, snapshot(14));
  assert.equal(result.imported, 14);
  assert.equal(x.writes() - before, 1);
  assert.equal(result.session.currentOverall, 15);
  assert.deepEqual(result.session.picks.filter((p) => p.isMine).map((p) => p.overallPick), [3, 14]);
  assert.equal(result.card.mockReadiness.ready, true);
  assert.ok(result.card.preferred);
  assert.equal(x.service.importMockSnapshot(x.session.id, snapshot(14)).imported, 0);
  assert.equal(x.service.getSession(x.session.id).picks.length, 14);
});

test('all 120 observed picks replay exactly with 15 target picks and automatic completion', () => {
  const x = setup();
  const started = performance.now();
  for (let count = 0; count <= 112; count += 14) x.service.importMockSnapshot(x.session.id, snapshot(count));
  const result = x.service.importMockSnapshot(x.session.id, snapshot(120));
  assert.equal(result.session.status, 'completed');
  assert.equal(result.session.picks.length, 120);
  assert.equal(result.session.picks.filter((p) => p.isMine).length, 15);
  assert.deepEqual(result.session.picks.map((p) => p.observedName), recorded.map((p) => p.name));
  assert.equal(result.card.preferred, null);
  assert.ok(performance.now() - started < 3000, 'batch replay must finish well inside one draft turn');
});

test('conflicting prefix and late invalid rows roll back every change', () => {
  const x = setup();
  x.service.importMockSnapshot(x.session.id, snapshot(7));
  const before = x.service.getSession(x.session.id);
  const writes = x.writes();
  const conflicting = snapshot(14);
  conflicting.picks = structuredClone(conflicting.picks);
  conflicting.picks[2].name = 'Different Receiver';
  assert.throws(() => x.service.importMockSnapshot(x.session.id, conflicting), { code: 'MOCK_PICK_CONFLICT' });
  const gap = snapshot(14);
  gap.picks = structuredClone(gap.picks);
  gap.picks[13].overallPick = 16;
  assert.throws(() => x.service.importMockSnapshot(x.session.id, gap), { code: 'OUT_OF_ORDER_PICK' });
  assert.deepEqual(x.service.getSession(x.session.id), before);
  assert.equal(x.writes(), writes);
});

test('room, seat, clock, ownership and scoring mismatches fail before saving', () => {
  const x = setup();
  x.service.importMockSnapshot(x.session.id, snapshot(7));
  for (const [changes, code] of [
    [{ roomId: '99999' }, 'MOCK_ROOM_MISMATCH'],
    [{ draftSlot: 4 }, 'MOCK_SEAT_MISMATCH'],
    [{ teamCount: 12 }, 'MOCK_TEAM_COUNT_MISMATCH'],
    [{ currentOverall: 9 }, 'MOCK_PICK_GAP'],
    [{ observedAt: '2026-09-07T21:00:00Z' }, 'STALE_MOCK_SNAPSHOT'],
    [{ autodraft: undefined }, 'AUTODRAFT_STATE_REQUIRED'],
    [{ rules: { ...snapshot().rules, receptionPoints: 1 } }, 'MOCK_SCORING_MISMATCH'],
    [{ rules: { ...snapshot().rules, roster: { ...league.roster, 'R/W/T': 0, 'W/R': 1 } } }, 'MOCK_ROSTER_MISMATCH']
  ]) assert.throws(() => x.service.importMockSnapshot(x.session.id, snapshot(7, changes)), { code });
  const wrongOwner = snapshot(8);
  wrongOwner.picks = structuredClone(wrongOwner.picks);
  wrongOwner.picks[7].isMine = true;
  assert.throws(() => x.service.importMockSnapshot(x.session.id, wrongOwner), { code: 'MOCK_OWNERSHIP_MISMATCH' });
  assert.equal(x.service.getSession(x.session.id).picks.length, 7);
});

test('first snapshot can correct a requested seat without a confirmation or new session', () => {
  const x = setup();
  const result = x.service.importMockSnapshot(x.session.id, snapshot(0, { draftSlot: 4 }));
  assert.equal(result.session.draftSlot, 4);
  assert.equal(result.session.id, x.session.id);
});

test('autodraft and stale evidence suppress actionable recommendations', () => {
  const x = setup();
  let result = x.service.importMockSnapshot(x.session.id, snapshot(2, { autodraft: true }));
  assert.equal(result.session.picks.length, 2);
  assert.equal(result.card.preferred, null);
  assert.match(result.card.mockReadiness.reasons.join(' '), /Autodraft is on/);
  result = x.service.importMockSnapshot(x.session.id, snapshot(2));
  assert.equal(result.card.onClock, true);
  assert.ok(result.card.preferred);
  x.advance(30_001);
  assert.equal(x.service.recommendation(x.session.id).preferred, null);
});

test('abbreviated names resolve by position without confusing RB J. Love and QB Jordan Love', () => {
  const pool = [{ id: 'qb-love', name: 'Jordan Love', position: 'QB', team: 'GB' }, { id: 'rb-love', name: 'Jeremiyah Love', position: 'RB', team: 'ARI' }];
  assert.equal(resolvePlayer({ name: 'J. Love', position: 'RB', team: 'ARI' }, pool).id, 'rb-love');
  assert.equal(resolvePlayer({ name: 'J. Love', position: 'QB', team: 'GB' }, pool).id, 'qb-love');
  const ambiguous = resolvePlayer({ name: 'J. Smith', position: 'WR', team: 'BUF' }, [
    { id: 'one', name: 'John Smith', position: 'WR', team: 'BUF' }, { id: 'two', name: 'Jim Smith', position: 'WR', team: 'BUF' }
  ]);
  assert.match(ambiguous.id, /^mock-observed:/);
});

test('missing Yahoo players are eligible only in the practice snapshot, without global pool mutation', () => {
  const pool = [{ id: 'qb-love', name: 'Jordan Love', position: 'QB', team: 'GB' }];
  const x = setup(pool);
  const before = structuredClone(pool);
  const result = x.service.importMockSnapshot(x.session.id, snapshot(0, { availablePlayers: [candidate('J. Love', 'RB', 'ARI')] }));
  assert.equal(result.card.preferred.player.position, 'RB');
  assert.equal(result.card.preferred.player.projectionSource, 'yahoo-browser-projected');
  assert.deepEqual(pool, before);
  const other = x.service.createSession({ sourceMode: 'manual', draftSlot: 1 });
  assert.deepEqual(x.service.sessionPlayers(other.id), pool);
  assert.throws(() => x.service.importMockSnapshot(other.id, snapshot()), { code: 'MOCK_SESSION_REQUIRED' });
  const real = new DraftService({ league: { ...league, platform: 'yahoo' }, playerPool: { players: [] }, store: new MemoryStateStore() });
  assert.throws(() => real.createSession({ draftSlot: 3, sourceMode: 'mock' }), { code: 'MOCK_SESSION_REQUIRED' });
});

test('drafted and available conflicts, duplicates, and invalid projections are rejected atomically', () => {
  const x = setup();
  assert.throws(() => x.service.importMockSnapshot(x.session.id, snapshot(1, { availablePlayers: [candidate('J. Gibbs', 'RB', 'DET')] })), { code: 'MOCK_AVAILABILITY_CONFLICT' });
  assert.throws(() => x.service.importMockSnapshot(x.session.id, snapshot(0, { availablePlayers: [candidate('Same Player'), candidate('Same Player')] })), { code: 'DUPLICATE_MOCK_CANDIDATE' });
  assert.throws(() => x.service.importMockSnapshot(x.session.id, snapshot(0, { availablePlayers: [{ ...candidate('Bad Stats'), projectedPoints: null }] })), { code: 'INVALID_MOCK_PROJECTION' });
  assert.equal(x.service.getSession(x.session.id).picks.length, 0);
});

test('late-round recommendations preserve required starting slots', () => {
  const x = setup();
  const result = x.service.importMockSnapshot(x.session.id, snapshot(109, { availablePlayers: [candidate('Extra Receiver', 'WR', 'BUF'), candidate('Late Kicker', 'K', 'SF'), candidate('Late Defense', 'DEF', 'PIT')] }));
  assert.ok(['K', 'DEF'].includes(result.card.preferred.player.position));
  assert.equal(result.card.board.find((row) => row.player.position === 'WR').rosterFeasible, false);
});

test('14-pick burst with 360 observed candidates stays below the server latency budget', (t) => {
  const candidates = Array.from({ length: 360 }, (_, i) => ({ ...candidate(`Candidate ${i + 1}`, ['WR', 'RB', 'QB', 'TE'][i % 4], 'BUF', i + 1), projectedPoints: Math.max(1, 400 - i) }));
  const pool = candidates.map((p, i) => ({ ...p, id: `pool-${i}`, floor: p.projectedPoints * 0.84, ceiling: p.projectedPoints * 1.16 }));
  const x = setup(pool);
  const started = performance.now();
  const result = x.service.importMockSnapshot(x.session.id, snapshot(14, { availablePlayers: candidates }));
  const elapsed = performance.now() - started;
  t.diagnostic(`14 picks and 360 candidates reconciled and ranked in ${elapsed.toFixed(1)}ms`);
  assert.equal(result.card.board.length, 360);
  assert.ok(elapsed < 1500);
});
