'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DraftReadinessService, RESULT_TTL_MS } = require('../src/services/draft-readiness-service');
const { buildApp } = require('../src/server');
const { MemoryStateStore } = require('../src/storage/json-state-store');

function fixture() {
  let clock = Date.parse('2026-09-04T12:00:00Z');
  const runtime = {
    leagues: [{ id: 'one', config: { name: 'One', roster: { QB: 1 } } }],
    playerPool: { source: 'fantasypros', fetchedAt: '2026-09-04T12:00:00Z', players: [{ id: '1', yahooPlayerKey: '1.p.1', position: 'QB' }] },
    fantasyProsSyncEnabled: true, preflightYahooRehearsalEnabled: true,
    operationsMaximumEvidenceAgeHours: 36, yahooDraftAutoSyncEnabled: true
  };
  const report = {
    readyForLiveDraft: true, blockers: [], warnings: ['Review polling allowance'],
    account: { enabled: true, connected: true, clientConfigured: true, encryptedTokenStorageConfigured: true },
    leagues: [{ leagueId: 'one', name: 'One', ready: true }],
    playerEvidence: { source: 'fantasypros', ageHours: 0,
      crosswalk: { coverage: 1, requiredCoverage: 0.8, playerShortfall: 0, positionShortfalls: [] } }
  };
  const calls = [];
  const operations = {
    readiness: () => structuredClone(report),
    rehearse: async ({ leagueId }) => { calls.push(['rehearse', leagueId]); return { leagueId, ready: true, checks: [{ name: 'player-lookup', ok: true }] }; }
  };
  const refresh = { status: () => ({ configured: true }), trigger: async (input, reason) => { calls.push(['refresh', input, reason]); report.playerEvidence.ageHours = 0; } };
  const service = new DraftReadinessService({ runtime, yahooOperations: operations, fantasyProsRefresh: refresh, now: () => new Date(clock) });
  return { runtime, report, operations, refresh, service, calls, advance: (ms) => { clock += ms; } };
}

test('full in-app check is required, concurrent runs coalesce and status reads do not spend requests', async () => {
  const { service, calls } = fixture();
  assert.equal(service.status().state, 'unchecked');
  assert.throws(() => service.assertReady(), { code: 'DRAFT_PREFLIGHT_REQUIRED' });
  const first = service.start();
  const second = service.start();
  assert.equal(service.status().report.readyForLiveDraft, false);
  await Promise.all([first, second]);
  assert.equal(service.status().state, 'ready');
  assert.doesNotThrow(() => service.assertReady());
  for (let i = 0; i < 10; i++) service.status();
  await service.start({ reuse: true });
  assert.deepEqual(calls, [['rehearse', 'one']]);
  assert.equal(service.status().report.warnings.length, 1);
});

test('in-app refresh uses provider cache/budgets and reports post-rehearsal depth', async () => {
  const f = fixture();
  f.report.playerEvidence.ageHours = 40;
  f.report.playerEvidence.crosswalk.positionShortfalls = [{ position: 'DEF', shortfall: 5 }];
  f.report.blockers = ['DEF pool too shallow'];
  f.operations.rehearse = async () => {
    f.report.playerEvidence.crosswalk.positionShortfalls = [];
    f.report.blockers = [];
    f.runtime.playerPool.players.push({ id: '2', yahooPlayerKey: '1.p.2', position: 'DEF' });
    return { leagueId: 'one', ready: true, checks: [{ name: 'draft-depth', ok: true }] };
  };
  const final = await f.service.start();
  assert.equal(final.report.readyForLiveDraft, true);
  assert.deepEqual(f.calls, [['refresh', { force: false }, 'preflight']]);
  assert.equal(final.report.yahooRehearsals[0].checks[0].name, 'draft-depth');
});

test('demo and disconnected setups never consume live provider requests or report READY', async () => {
  const f = fixture();
  f.report.account.connected = false;
  f.report.leagues = [];
  f.report.blockers = ['Connect Yahoo', 'No Yahoo league is imported'];
  f.report.playerEvidence.source = 'synthetic-demo';
  const final = await f.service.start();
  assert.equal(final.state, 'blocked');
  assert.equal(final.automaticCheckEligible, false);
  assert.deepEqual(f.calls, []);
});

test('refresh failures and missing credentials stay blocked with a retryable explanation', async () => {
  const f = fixture();
  f.report.playerEvidence.ageHours = 40;
  f.refresh.status = () => ({ configured: false });
  let final = await f.service.start();
  assert.equal(final.state, 'blocked');
  assert.match(final.report.blockers.join(' '), /FANTASYPROS_KEY_MISSING/);
  f.refresh.status = () => ({ configured: true });
  f.refresh.trigger = async () => { throw Object.assign(new Error('Daily budget exhausted'), { code: 'FANTASYPROS_BUDGET_EXHAUSTED' }); };
  final = await f.service.start();
  assert.equal(final.state, 'blocked');
  assert.match(final.report.blockers.join(' '), /Daily budget exhausted/);
  f.refresh.trigger = async () => { f.report.playerEvidence.ageHours = 0; };
  assert.equal((await f.service.start()).state, 'ready');
});

test('a failed Yahoo league check does not skip healthy leagues or become a warning', async () => {
  const f = fixture();
  f.report.leagues.push({ leagueId: 'two', name: 'Two', ready: true });
  f.operations.rehearse = async ({ leagueId }) => {
    f.calls.push(leagueId);
    if (leagueId === 'one') throw new Error('Yahoo timed out');
    return { leagueId, ready: true, checks: [] };
  };
  const final = await f.service.start();
  assert.equal(final.state, 'blocked');
  assert.deepEqual(f.calls, ['one', 'two']);
  assert.equal(final.report.yahooRehearsals.length, 2);
  assert.match(final.report.blockers.join(' '), /Yahoo timed out/);
});

test('expired results, pool changes, account changes and server restarts require another check', async () => {
  const f = fixture();
  await f.service.start();
  f.advance(RESULT_TTL_MS + 1);
  assert.equal(f.service.status().state, 'unchecked');
  await f.service.start();
  f.runtime.playerPool.players.push({ id: 'new' });
  assert.equal(f.service.status().state, 'unchecked');
  await f.service.start();
  f.service.invalidate();
  assert.equal(f.service.status().state, 'unchecked');
  await f.service.start();
  f.report.account.connected = false;
  assert.equal(f.service.status().report.readyForLiveDraft, false);
  assert.equal(fixture().service.status().state, 'unchecked');
});

test('league changes during an in-flight check cannot authorize an unchecked configuration', async () => {
  const f = fixture();
  f.operations.rehearse = async () => {
    f.runtime.leagues[0].config.roster.QB = 2;
    return { leagueId: 'one', ready: true, checks: [] };
  };
  assert.equal((await f.service.start()).state, 'unchecked');
  assert.throws(() => f.service.assertReady(), { code: 'DRAFT_PREFLIGHT_REQUIRED' });
});

test('disabled rehearsal and undated evidence fail closed', async () => {
  const f = fixture();
  f.runtime.preflightYahooRehearsalEnabled = false;
  assert.equal((await f.service.start()).state, 'blocked');
  f.runtime.preflightYahooRehearsalEnabled = true;
  f.report.playerEvidence.ageHours = null;
  f.refresh.trigger = async () => {};
  const final = await f.service.start();
  assert.equal(final.state, 'blocked');
  assert.match(final.report.blockers.join(' '), /no refresh timestamp/);
});

test('HTTP preflight is asynchronous, shared with the draft gate, and leaves manual drafting available', async () => {
  const f = fixture();
  const league = structuredClone(require('../config/leagues/yahoo-example.json'));
  league.platform = 'yahoo';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-preflight-'));
  const runtime = { ...f.runtime, port: 0, host: '127.0.0.1', defaultLeagueId: league.id, league,
    leagues: [{ id: league.id, config: league, yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', verificationStatus: 'verified', stateFile: path.join(dir, 'state.json') }],
    playerPool: structuredClone(require('../config/fixtures/demo-players.json'))
  };
  const app = buildApp(runtime, { storeFactory: () => new MemoryStateStore(), yahooOperations: {
    ...f.operations, startDraftSync: () => ({ state: 'running' })
  } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (url, value = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const sessions = `/api/leagues/${league.id}/draft/sessions`;
  try {
    assert.equal((await (await fetch(base + '/api/operations/preflight')).json()).state, 'unchecked');
    assert.equal((await post(sessions, { draftSlot: 1, sourceMode: 'yahoo' })).status, 409);
    assert.equal((await post(sessions, { draftSlot: 1, sourceMode: 'manual' })).status, 201);
    const response = await post('/api/operations/preflight');
    assert.equal(response.status, 202);
    await app.draftReadiness.inFlight;
    assert.equal((await (await fetch(base + '/api/operations/preflight')).json()).state, 'ready');
    assert.equal((await post(sessions, { draftSlot: 1, sourceMode: 'yahoo' })).status, 201);
    app.draftReadiness.invalidate();
    assert.equal((await post('/api/draft/sessions', { draftSlot: 1, sourceMode: 'yahoo' })).status, 409);
  } finally {
    await new Promise((resolve) => app.commandRelay.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dashboard exposes an accessible in-app check, auto-start, progress and separate warnings', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  for (const id of ['draft-readiness', 'check-draft-readiness', 'draft-readiness-state', 'draft-readiness-time', 'draft-readiness-blockers', 'draft-readiness-warnings']) assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.indexOf('id="draft-readiness"') < html.indexOf('id="setup"'));
  assert.match(client, /automaticCheckEligible/);
  assert.match(client, /api\('\/api\/operations\/preflight'/);
  assert.match(client, /state\.readinessError/);
  assert.doesNotMatch(html, /Run Yahoo read rehearsal/);
});
