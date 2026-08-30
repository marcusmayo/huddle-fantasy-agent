'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const baseLeague = require('../config/leagues/yahoo-example.json');
const playerPool = require('../config/fixtures/demo-players.json');
const { buildApp } = require('../src/server');
const { MemoryStateStore } = require('../src/storage/json-state-store');

function runtime(tempDir, enabled = true) {
  return {
    host: '127.0.0.1',
    port: 0,
    instanceName: 'huddle-onboarding-test',
    auditFile: path.join(tempDir, 'audit.jsonl'),
    fantasyProsSyncEnabled: false,
    fantasyProsCacheDir: path.join(tempDir, 'fantasypros'),
    tank01CacheDir: path.join(tempDir, 'tank01'),
    sleeperCacheDir: path.join(tempDir, 'sleeper'),
    league: baseLeague,
    stateFile: path.join(tempDir, 'default.json'),
    defaultLeagueId: baseLeague.id,
    leagues: [{ id: baseLeague.id, config: baseLeague, stateFile: path.join(tempDir, 'default.json') }],
    leagueOnboardingEnabled: enabled,
    leagueOnboardingDir: path.join(tempDir, 'leagues'),
    leagueManagedRegistryPath: path.join(tempDir, 'leagues', 'registry.managed.json'),
    playerPool: structuredClone(playerPool)
  };
}

async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${app.server.address().port}`;
}

async function close(app) {
  await new Promise((resolve) => app.commandRelay.close(resolve));
  await new Promise((resolve) => app.server.close(resolve));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

const newLeague = {
  name: 'Marcus Sunday League',
  targetTeam: 'Gridiron Operators',
  teamCount: 12,
  draftSlot: 7,
  receptionPoints: 0.5,
  passingTouchdown: 6,
  roster: { QB: 1, RB: 2, WR: 3, TE: 1, 'W/R': 1, K: 1, DEF: 1, BN: 6, IR: 2 },
  yahooLeagueKey: '461.l.12345',
  yahooTeamKey: '461.l.12345.t.7'
};

test('dashboard onboarding persists and activates an isolated league without restart', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-onboard-'));
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const status = await fetchJson(`${base}/api/leagues/onboarding`);
    assert.equal(status.status, 200);
    assert.equal(status.body.enabled, true);
    assert.equal(status.body.verificationAvailable, false);

    const created = await fetchJson(`${base}/api/leagues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newLeague)
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.league.id, 'marcus-sunday-league');
    assert.equal(created.body.league.verificationStatus, 'unverified');
    assert.equal(created.body.config.scoring.offense.reception, 0.5);
    assert.equal(created.body.config.scoring.offense.passingTouchdown, 6);
    assert.equal(created.body.verification.authority, 'yahoo');

    const fleet = await fetchJson(`${base}/api/leagues`);
    assert.equal(fleet.body.leagues.length, 2);
    assert.ok(app.draftServices.has('marcus-sunday-league'));
    const registry = JSON.parse(fs.readFileSync(path.join(tempDir, 'leagues', 'registry.managed.json')));
    assert.equal(registry.leagues[0].config, 'marcus-sunday-league/config.json');
    assert.ok(fs.existsSync(path.join(tempDir, 'leagues', 'marcus-sunday-league', 'config.json')));

    const duplicate = await fetchJson(`${base}/api/leagues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newLeague)
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, 'LEAGUE_ALREADY_EXISTS');

    const removed = await fetchJson(`${base}/api/leagues/marcus-sunday-league`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removed, true);
    assert.equal(removed.body.recoverable, true);
    assert.equal(removed.body.fleet.leagues.length, 1);
    assert.equal(app.draftServices.has('marcus-sunday-league'), false);
    assert.equal(app.weeklyServices.has('marcus-sunday-league'), false);
    const afterDeleteRegistry = JSON.parse(fs.readFileSync(path.join(tempDir, 'leagues', 'registry.managed.json')));
    assert.deepEqual(afterDeleteRegistry.leagues, []);
    const archived = fs.readdirSync(path.join(tempDir, 'leagues', 'archive'));
    assert.equal(archived.length, 1);
    assert.match(archived[0], /^marcus-sunday-league-/);

    const lastLeague = await fetchJson(`${base}/api/leagues/${encodeURIComponent(baseLeague.id)}`, { method: 'DELETE' });
    assert.equal(lastLeague.status, 200);
    assert.equal(lastLeague.body.fleet.leagues.length, 0);
    assert.equal(lastLeague.body.fleet.deploymentMode, 'empty');
    assert.equal(lastLeague.body.defaultLeagueId, null);
    assert.equal(app.runtime.league, null);
    assert.equal(app.runtime.stateFile, null);

    const providerStatus = await fetchJson(`${base}/api/provider-status`);
    assert.equal(providerStatus.status, 200);
    assert.equal(providerStatus.body.leagueCount, 0);
    const legacyLeague = await fetchJson(`${base}/api/league`);
    assert.equal(legacyLeague.status, 404);

    const rebuilt = await fetchJson(`${base}/api/leagues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...newLeague, name: 'Fresh Start League' })
    });
    assert.equal(rebuilt.status, 201);
    assert.equal(app.runtime.leagues.length, 1);
    assert.equal(app.runtime.defaultLeagueId, 'fresh-start-league');
    assert.equal(app.runtime.league.id, 'fresh-start-league');
  } finally {
    await close(app);
  }
});

test('administrator-configured league can be removed without deleting its source files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-hide-configured-'));
  const input = runtime(tempDir);
  const second = { ...structuredClone(baseLeague), id: 'configured-secondary', name: 'CONFIGURED SECONDARY' };
  input.leagues.push({ id: second.id, config: second, stateFile: path.join(tempDir, 'secondary.json') });
  const app = buildApp(input, { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const removed = await fetchJson(`${base}/api/leagues/${encodeURIComponent(baseLeague.id)}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removalMode, 'configured-league-hidden');
    assert.equal(removed.body.archiveId, null);
    assert.equal(removed.body.fleet.leagues.length, 1);
    const overlay = JSON.parse(fs.readFileSync(path.join(tempDir, 'leagues', 'registry.managed.json')));
    assert.deepEqual(overlay.removedLeagueIds, [baseLeague.id]);
    assert.equal(fs.existsSync(path.join(tempDir, 'leagues', 'archive')), false);
  } finally {
    await close(app);
  }
});

test('a quarantined final league can still be removed to recover the dashboard', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-delete-quarantined-'));
  const app = buildApp(runtime(tempDir), {
    storeFactory: () => { throw new Error('corrupt state'); }
  });
  const base = await listen(app);
  try {
    assert.equal(app.runtime.leagueErrors.length, 1);
    const removed = await fetchJson(`${base}/api/leagues/${encodeURIComponent(baseLeague.id)}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.fleet.leagues.length, 0);
    assert.equal(removed.body.defaultLeagueId, null);
  } finally {
    await close(app);
  }
});

test('hosted instances can fail closed for dashboard onboarding', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-onboard-off-'));
  const app = buildApp(runtime(tempDir, false), { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const created = await fetchJson(`${base}/api/leagues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newLeague)
    });
    assert.equal(created.status, 403);
    assert.equal(created.body.error, 'LEAGUE_ONBOARDING_DISABLED');
  } finally {
    await close(app);
  }
});
