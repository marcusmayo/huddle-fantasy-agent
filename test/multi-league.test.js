'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const baseLeague = require('../config/leagues/yahoo-example.json');
const playerPool = require('../config/fixtures/demo-players.json');
const { loadLeagueRegistry } = require('../src/config');
const { buildApp } = require('../src/server');
const { MemoryStateStore } = require('../src/storage/json-state-store');

function secondLeague() {
  return {
    ...structuredClone(baseLeague),
    id: 'secondary-22',
    name: 'SECOND TEST LEAGUE',
    targetTeam: 'SECOND TEAM',
    teamCount: 10
  };
}

function runtime(tempDir) {
  const secondary = secondLeague();
  return {
    host: '127.0.0.1',
    port: 0,
    instanceName: 'huddle-test-fleet',
    auditFile: path.join(tempDir, 'audit.jsonl'),
    fantasyProsSyncEnabled: true,
    fantasyProsCacheDir: path.join(tempDir, 'cache'),
    season: 2026,
    league: baseLeague,
    stateFile: path.join(tempDir, 'default.json'),
    defaultLeagueId: 'example-primary',
    leagues: [
      { id: 'example-primary', config: baseLeague, stateFile: path.join(tempDir, 'one.json') },
      { id: secondary.id, config: secondary, stateFile: path.join(tempDir, 'two.json') }
    ],
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

async function wsCommand(base, prompt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:'));
    const received = [];
    ws.on('open', () => ws.send(JSON.stringify({ prompt })));
    ws.on('message', (data) => {
      const frame = JSON.parse(data);
      received.push(frame);
      if (frame.type === 'done') { ws.close(); resolve(received); }
    });
    ws.on('error', reject);
  });
}

test('league registry resolves configs and rejects mismatched ids', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-registry-'));
  const one = structuredClone(baseLeague);
  const two = secondLeague();
  fs.writeFileSync(path.join(tempDir, 'one.json'), JSON.stringify(one));
  fs.writeFileSync(path.join(tempDir, 'two.json'), JSON.stringify(two));
  fs.writeFileSync(path.join(tempDir, 'registry.json'), JSON.stringify({
    schemaVersion: 1,
    defaultLeagueId: one.id,
    leagues: [
      { id: one.id, config: './one.json', stateFile: './state-one.json' },
      { id: two.id, config: './two.json', stateFile: './state-two.json' }
    ]
  }));
  const registry = loadLeagueRegistry(path.join(tempDir, 'registry.json'));
  assert.equal(registry.leagues.length, 2);
  assert.equal(registry.leagues[1].config.targetTeam, 'SECOND TEAM');
  assert.equal(registry.defaultLeagueId, 'example-primary');

  const bad = JSON.parse(fs.readFileSync(path.join(tempDir, 'registry.json')));
  bad.leagues[1].id = 'wrong';
  fs.writeFileSync(path.join(tempDir, 'bad.json'), JSON.stringify(bad));
  assert.throws(() => loadLeagueRegistry(path.join(tempDir, 'bad.json')), /does not match config id/);
});

test('multi-league APIs keep sessions isolated and expose an Aegis manifest', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-api-'));
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const fleet = await fetchJson(`${base}/api/leagues`);
    assert.equal(fleet.status, 200);
    assert.equal(fleet.body.leagues.length, 2);
    assert.equal(fleet.body.defaultLeagueId, 'example-primary');

    const created = await fetchJson(`${base}/api/leagues/secondary-22/draft/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftSlot: 8, sourceMode: 'manual' })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.leagueId, 'secondary-22');

    const primarySessions = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions`);
    const secondarySessions = await fetchJson(`${base}/api/leagues/secondary-22/draft/sessions`);
    assert.equal(primarySessions.body.sessions.length, 0);
    assert.equal(secondarySessions.body.sessions.length, 1);

    const manifest = await fetchJson(`${base}/api/fleet/manifest`);
    assert.equal(manifest.body.profile, 'huddle');
    assert.equal(manifest.body.deploymentMode, 'portfolio');
    assert.equal(manifest.body.controlMode, 'read-only');
    assert.equal(manifest.body.leagues.length, 2);

    const color = await fetchJson(`${base}/color`);
    assert.equal(color.body.profile, 'huddle');
    assert.equal(color.body.mutable, false);
  } finally {
    await close(app);
  }
});

test('one corrupt league state is quarantined without preventing healthy league startup', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-quarantine-'));
  const input = runtime(tempDir);
  fs.writeFileSync(input.leagues[1].stateFile, '{not valid json');
  const app = buildApp(input);
  const base = await listen(app);
  try {
    const manifest = await fetchJson(`${base}/api/fleet/manifest`);
    const healthy = manifest.body.leagues.find((item) => item.id === 'example-primary');
    const quarantined = manifest.body.leagues.find((item) => item.id === 'secondary-22');
    assert.equal(healthy.availability, 'available');
    assert.equal(quarantined.availability, 'quarantined');
    assert.equal(quarantined.stateError.code, 'LEAGUE_STATE_UNAVAILABLE');

    const healthySessions = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions`);
    assert.equal(healthySessions.status, 200);
    const unavailable = await fetchJson(`${base}/api/leagues/secondary-22/draft/sessions`);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error, 'LEAGUE_STATE_UNAVAILABLE');

    const readiness = await fetchJson(`${base}/health/readiness`);
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.status, 'degraded');
    assert.equal(readiness.body.leagueState.available, 1);
    assert.equal(readiness.body.leagueState.quarantined, 1);
  } finally {
    await close(app);
  }
});

test('Aegis WebSocket relay accepts allowlisted read commands only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-ws-'));
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const frames = await wsCommand(base, 'status');
    const token = frames.find((frame) => frame.type === 'token');
    assert.equal(JSON.parse(token.text).instance, 'huddle-test-fleet');

    const created = app.draftServices.get('example-primary').createSession({ draftSlot: 3 });
    const sessions = await wsCommand(base, 'sessions example-primary');
    assert.equal(JSON.parse(sessions.find((frame) => frame.type === 'token').text).sessions[0].id, created.id);
    const board = await wsCommand(base, `board example-primary ${created.id}`);
    const boardValue = JSON.parse(board.find((frame) => frame.type === 'token').text);
    assert.equal(boardValue.leagueId, 'example-primary');
    assert.equal(boardValue.board.length, 12);
    assert.equal(boardValue.execution, 'recommendation-only');

    const weekly = await wsCommand(base, 'weekly example-primary');
    const weeklyValue = JSON.parse(weekly.find((frame) => frame.type === 'token').text);
    assert.equal(weeklyValue.leagueId, 'example-primary');
    assert.equal(weeklyValue.review, null);
    assert.equal(weeklyValue.status.storedWeeks, 0);

    const denied = await wsCommand(base, 'drop player-1');
    assert.match(denied.find((frame) => frame.type === 'error').text, /COMMAND_NOT_ALLOWED/);
    const audit = fs.readFileSync(path.join(tempDir, 'audit.jsonl'), 'utf8');
    assert.doesNotMatch(audit, /drop player-1/);
  } finally {
    await close(app);
  }
});

test('screenshot analysis is league-scoped and returns review candidates only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-vision-api-'));
  let received;
  const visionClient = {
    configured: true,
    model: 'anthropic/claude-sonnet-4.6',
    async analyzeDraftScreenshot(input) {
      received = input;
      return {
        provider: 'openrouter',
        model: this.model,
        purpose: input.purpose || 'draft_picks',
        screenshotType: 'draft_log',
        compatible: true,
        usableForPicks: true,
        applyMode: 'pick-events',
        candidates: [{ candidateId: 'vision:1:1', overallPick: 1, playerId: 'demo-rb-1', playerName: 'Running Back Alpha', actionable: true }],
        imagePersisted: false
      };
    }
  };
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore(), visionClient });
  const base = await listen(app);
  try {
    const created = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftSlot: 3, sourceMode: 'screenshot' })
    });
    const analyzed = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions/${created.body.id}/analyze-screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: 'data:image/png;base64,eA==', purpose: 'draft_picks' })
    });
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.body.provider, 'openrouter');
    assert.equal(analyzed.body.imagePersisted, false);
    assert.equal(received.league.id, 'example-primary');
    assert.equal(received.session.sourceMode, 'screenshot');
    assert.equal(received.purpose, 'draft_picks');

    const stillEmpty = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions/${created.body.id}`);
    assert.equal(stillEmpty.body.picks.length, 0);

    const evidence = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions/${created.body.id}/evidence-reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'vision-review:waiver:1',
        purpose: 'waiver_players',
        observations: [{ candidateId: 'vision:waiver:1', playerId: 'demo-qb-1', playerName: 'Quarterback Alpha', confidence: 0.93 }]
      })
    });
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.applied, true);
    assert.equal(evidence.body.session.picks.length, 0);
    assert.equal(evidence.body.session.evidenceReviews.length, 1);

    const card = await fetchJson(`${base}/api/leagues/example-primary/draft/sessions/${created.body.id}/recommendation`);
    assert.equal(card.body.evidence.screenshotReviews.count, 1);
    assert.deepEqual(card.body.board.find((item) => item.player.id === 'demo-qb-1').evidenceTags, ['WAIVER']);
  } finally {
    await close(app);
  }
});
