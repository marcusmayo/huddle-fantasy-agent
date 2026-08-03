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
