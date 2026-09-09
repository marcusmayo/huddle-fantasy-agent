'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { syncFantasyPros } = require('../src/server');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { refreshYahooDraftEvidence, coverageStatus } = require('../src/services/yahoo-draft-evidence');
const { execFileSync } = require('node:child_process');
const { mergeProviderPool } = require('../src/services/player-pool-store');
const { DraftService } = require('../src/services/draft-service');
const { JsonStateStore } = require('../src/storage/json-state-store');
const { YahooOperationsService } = require('../src/services/yahoo-operations-service');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-pool-recovery-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('huddle-pool-recovery-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

function yahooEntry() {
  return { id: 'draft', yahooLeagueKey: '470.l.153454', yahooTeamKey: '470.l.153454.t.2',
    config: { ...structuredClone(require('../config/leagues/yahoo-example.json')), platform: 'yahoo', provenance: { season: 2026 } } };
}

const yahooCandidates = [
  { player: [{ player_key: '470.p.1001' }, { name: { full: 'Player One' } }, { display_position: 'RB', editorial_team_abbr: 'TB' }, { bye_weeks: { week: '10' } }, { status: 'Q' }] },
  { player: [{ player_key: '470.p.40993' }, { name: { full: 'Bucky Irving' } }, { display_position: 'RB', editorial_team_abbr: 'TB' }, { bye_weeks: { week: '10' } }, { status: '' }] }
];

async function enrichYahoo(value, entry = yahooEntry()) {
  value.leagues = [entry];
  return refreshYahooDraftEvidence({ runtime: value, entry, now: () => new Date('2026-09-08T19:00:00Z'),
    client: { availablePlayers: async (_key, query) => query.start ? {} : { players: yahooCandidates } } });
}

function primaryPool() {
  return {
    source: 'fantasypros-api',
    season: 2026,
    complete: true,
    fetchedAt: '2026-08-02T00:00:00.000Z',
    players: [
      { id: 'fantasypros:1', name: 'Player One', position: 'RB', team: 'A', expertRank: 1, adp: 1, projectedPoints: 300, floor: 250, ceiling: 350, risk: 0.1 },
      { id: 'fantasypros:2', name: 'Player Two', position: 'RB', team: 'B', expertRank: 2, adp: 2, projectedPoints: 280, floor: 230, ceiling: 330, risk: 0.1 }
    ]
  };
}

function runtime() {
  return {
    season: 2026,
    playerPool: { source: 'fixture', complete: true, players: [] },
    playerHeadshots: { enabled: false, allowedHosts: [] },
    playerSnapshotFile: null
  };
}

test('source sync enriches FantasyPros with Tank01 and Sleeper without changing identity', async () => {
  const value = runtime();
  const result = await syncFantasyPros(value, { loadDraftPool: async () => primaryPool() }, {}, {
    tank01Client: {
      configured: true,
      loadDraftEvidence: async () => ({ players: [{ name: 'Player One', position: 'RB', rank: 2 }, { name: 'Player Two', position: 'RB', rank: 1 }] })
    },
    sleeperClient: {
      enabled: true,
      loadDraftEvidence: async () => ({ lookbackHours: 24, attribution: 'Sleeper', players: [{ name: 'Player One', position: 'RB', yahooId: '1001', direction: 'rising', adds: 5, drops: 0, net: 5 }] })
    }
  });
  assert.equal(result.players, 2);
  assert.equal(result.source, 'fantasypros+tank01+sleeper');
  assert.equal(value.playerPool.players[0].id, 'fantasypros:1');
  assert.equal(value.playerPool.players[0].sourceConsensus, 0.675);
  assert.equal(value.playerPool.players[0].sleeperTrend.direction, 'rising');
  assert.equal(value.playerPool.players[0].yahooPlayerKey, '1001');
});

test('optional source failure degrades to primary evidence instead of blocking the draft', async () => {
  const value = runtime();
  const result = await syncFantasyPros(value, { loadDraftPool: async () => primaryPool() }, {}, {
    tank01Client: { configured: true, loadDraftEvidence: async () => {
      throw Object.assign(new Error('temporary Tank01 failure'), { code: 'TANK01_TEMPORARY_FAILURE' });
    } },
    sleeperClient: { enabled: false }
  });
  assert.equal(result.source, 'fantasypros');
  assert.deepEqual(result.sourceEvidence.effectiveWeights, { fantasyPros: 1, tank01: 0 });
  assert.equal(result.sourceEvidence.errors[0].provider, 'tank01');
  assert.equal(result.sourceEvidence.errors[0].code, 'TANK01_TEMPORARY_FAILURE');
});

test('provider refresh preserves Yahoo candidates, sourced byes and coverage identically on disk and in memory', async t => {
  const value = runtime(), entry = yahooEntry(), directory = temporaryDirectory(t);
  value.playerSnapshotFile = path.join(directory, 'players.json');
  value.playerPool = primaryPool(); value.playerPool.players[0].yahooPlayerKey = '470.p.1001';
  await enrichYahoo(value, entry);
  const beforeObservedAt = value.playerPool.yahooDraftCoverage.draft.observedAt;
  const incoming = primaryPool(); incoming.fetchedAt = '2026-09-08T20:00:00Z';
  incoming.players[0].yahooPlayerKey = '1001'; incoming.players[0].projectedPoints = 333;
  await syncFantasyPros(value, { loadDraftPool: async () => incoming });
  const known = value.playerPool.players.find(p => p.id === 'fantasypros:1');
  assert.equal(known.byeWeek, 10); assert.equal(known.team, 'TB'); assert.equal(known.projectedPoints, 333);
  assert.equal(value.playerPool.players.filter(p => p.yahooPlayerKey?.endsWith('.p.40993')).length, 1);
  const restored = JSON.parse(fs.readFileSync(value.playerSnapshotFile, 'utf8'));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(value.playerPool)));
  assert.equal(restored.yahooDraftCoverage.draft.observedAt, beforeObservedAt, 'A provider refresh must not freshen Yahoo evidence');
  assert.equal(coverageStatus({ ...value, playerPool: restored }, entry, new Date('2026-09-08T20:00:00Z')).valid, true);
  // Start a genuinely new Node process using the application's configuration
  // loader and disk-backed draft service. No account secrets enter this fixture.
  const leagueFile = path.join(directory, 'league.json'), stateFile = path.join(directory, 'state.json');
  fs.writeFileSync(leagueFile, JSON.stringify(entry.config));
  const draft = new DraftService({ league: entry.config, playerPool: value.playerPool, store: new JsonStateStore(stateFile) });
  const session = draft.createSession({ sourceMode: 'yahoo', draftSlot: 1 });
  draft.recordPick(session.id, { playerId: 'yahoo:470.p.40993', eventId: 'accepted-irving' });
  const appRoot = path.resolve(__dirname, '..');
  const code = `const {loadRuntimeConfig}=require(${JSON.stringify(path.join(appRoot, 'src/config'))});
    const {buildApp}=require(${JSON.stringify(path.join(appRoot, 'src/server'))});
    const app=buildApp(loadRuntimeConfig());
    process.stdout.write(JSON.stringify({pool:app.runtime.playerPool,session:app.draftService.getSession(${JSON.stringify(session.id)}),controller:app.draftService.controllers.status(${JSON.stringify(session.id)})}));`;
  const restarted = JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { SystemRoot: process.env.SystemRoot || '', TEMP: directory, TMP: directory,
      HUDDLE_LEAGUE_CONFIG: leagueFile, HUDDLE_PLAYER_FIXTURE: path.join(appRoot, 'config/fixtures/demo-players.json'),
      HUDDLE_PLAYER_SNAPSHOT_FILE: value.playerSnapshotFile, HUDDLE_STATE_FILE: stateFile,
      HUDDLE_LEAGUE_ONBOARDING_DIR: path.join(directory, 'managed'), HUDDLE_SEASON: '2026', HUDDLE_YAHOO_OAUTH_ENABLED: 'false' } }));
  assert.deepEqual(restarted.pool, restored);
  assert.equal(restarted.session.picks[0].playerName, 'Bucky Irving'); assert.equal(restarted.session.picks[0].byeWeek, 10);
  assert.equal(restarted.session.picks[0].byeObservedAt, '2026-09-08T19:00:00.000Z');
  assert.equal(restarted.controller.active, false, 'Restart must not resurrect a computer-use lease');
});

test('a failed provider snapshot save preserves the last durable pool and its in-memory reference', async t => {
  const value = runtime(), directory = temporaryDirectory(t), blocker = path.join(directory, 'not-a-directory');
  fs.writeFileSync(blocker, 'existing evidence'); value.playerSnapshotFile = path.join(blocker, 'players.json');
  const reference = value.playerPool, before = structuredClone(reference);
  await assert.rejects(syncFantasyPros(value, { loadDraftPool: async () => primaryPool() }));
  assert.equal(value.playerPool, reference); assert.deepEqual(value.playerPool, before);
  assert.equal(fs.readFileSync(blocker, 'utf8'), 'existing evidence');
});

test('a cached coverage report cannot certify candidates removed or duplicated in the current player pool', async () => {
  const value = runtime(), entry = yahooEntry(); await enrichYahoo(value, entry);
  const full = structuredClone(value.playerPool);
  value.playerPool.players = value.playerPool.players.filter(p => !p.yahooPlayerKey?.endsWith('.p.40993'));
  assert.equal(coverageStatus(value, entry, new Date('2026-09-08T19:01:00Z')).valid, false);
  value.playerPool = structuredClone(full); value.playerPool.players.push(structuredClone(value.playerPool.players[0]));
  assert.equal(coverageStatus(value, entry, new Date('2026-09-08T19:01:00Z')).valid, false);
  value.playerPool = structuredClone(full); value.playerPool.players[0].position = 'QB';
  assert.equal(coverageStatus(value, entry, new Date('2026-09-08T19:01:00Z')).valid, false);
});

test('overlapping provider and Yahoo refreshes merge the latest committed pool in either completion order', { timeout: 5000 }, async () => {
  for (const finishesFirst of ['yahoo', 'provider']) {
    const value = runtime(); let release, began;
    const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { began = resolve; });
    if (finishesFirst === 'yahoo') {
      const provider = syncFantasyPros(value, { loadDraftPool: async () => { began(); await pending; return primaryPool(); } });
      await entered; await enrichYahoo(value); release(); await provider;
    } else {
      const entry = yahooEntry(); value.leagues = [entry];
      const yahoo = refreshYahooDraftEvidence({ runtime: value, entry, now: () => new Date('2026-09-08T19:00:00Z'),
        client: { availablePlayers: async (_key, query) => { if (query.start) return {}; began(); await pending; return { players: yahooCandidates }; } } });
      await entered; await syncFantasyPros(value, { loadDraftPool: async () => primaryPool() }); release(); await yahoo;
    }
    assert.ok(value.playerPool.players.find(p => p.yahooPlayerKey === '470.p.40993'));
    assert.equal(value.playerPool.players.find(p => p.id === 'fantasypros:2').projectedPoints, 280);
    assert.equal(value.playerPool.yahooDraftCoverage.draft.observedPlayers, 2);
  }
});

test('season and numeric identity conflicts cannot import old Yahoo evidence or merge same-name players', async () => {
  const value = runtime(); await enrichYahoo(value);
  const wrongSeason = { ...primaryPool(), season: 2025 };
  assert.throws(() => mergeProviderPool(value, wrongSeason), { code: 'PLAYER_POOL_SEASON_MISMATCH' });
  const changedPosition = primaryPool(); changedPosition.players[0].yahooPlayerKey = '470.p.40993'; changedPosition.players[0].position = 'QB';
  assert.throws(() => mergeProviderPool(value, changedPosition), { code: 'PLAYER_POOL_ID_CONFLICT' });
  const sameName = primaryPool(); sameName.players[0].name = 'Bucky Irving'; sameName.players[0].yahooPlayerKey = '470.p.9999';
  const distinct = mergeProviderPool(value, sameName);
  assert.equal(distinct.players.filter(p => p.name === 'Bucky Irving').length, 2);
  assert.equal(new Set(distinct.players.map(p => p.id)).size, distinct.players.length);
  value.season = 2027;
  const nextSeason = mergeProviderPool(value, { ...primaryPool(), season: 2027 });
  assert.deepEqual(nextSeason.yahooDraftCoverage, {});
  assert.ok(!nextSeason.players.some(p => p.yahooPlayerKey === '470.p.40993'));
});

test('current Yahoo IDs remain stable while new projections and explicitly newer injury evidence can update', async () => {
  const value = runtime(); await enrichYahoo(value);
  const incoming = primaryPool(); incoming.players[0].yahooPlayerKey = '470.p.1001';
  incoming.players[0].injuryStatus = null; incoming.players[0].injurySource = 'newer-dated-report'; incoming.players[0].injuryObservedAt = '2026-09-08T20:00:00Z';
  const next = mergeProviderPool(value, incoming), player = next.players.find(p => p.yahooPlayerKey === '470.p.1001');
  assert.equal(player.id, 'yahoo:470.p.1001'); assert.equal(player.injuryStatus, null); assert.equal(player.injurySource, 'newer-dated-report');
  const carried = next.players.find(p => p.yahooPlayerKey === '470.p.40993');
  assert.equal(carried.projectionImputed, true); assert.notEqual(carried.projectionScoringVerified, true);
  assert.equal(carried.yahooEvidenceObservedAt, '2026-09-08T19:00:00.000Z');
});

test('depth supplementation merges a concurrent provider refresh and saves before making it visible', { timeout: 5000 }, async t => {
  const value = runtime(), directory = temporaryDirectory(t), entry = yahooEntry();
  entry.config.teamCount = 2; entry.config.roster = { DEF: 1 }; entry.verificationStatus = 'verified'; value.leagues = [entry];
  value.playerPool = { ...primaryPool(), players: [{ id: 'def-1', yahooPlayerKey: '470.p.900', name: 'Ravens', position: 'DEF', team: 'BAL', projectedPoints: 100 }] };
  value.playerSnapshotFile = path.join(directory, 'players.json');
  const operations = new YahooOperationsService({ runtime: value, draftServices: new Map(), weeklyServices: new Map(), now: () => new Date('2026-09-08T19:00:00Z') });
  const defense = { player: [{ player_key: '470.p.901' }, { name: { full: 'Vikings' } }, { display_position: 'DEF', editorial_team_abbr: 'MIN' }, { bye_weeks: { week: '6' } }, { player_projected_points: { total: '500' } }] };
  let release, began; const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { began = resolve; });
  const depth = operations.supplementDraftDepth(entry, { availablePlayers: async () => { began(); await pending; return { players: [defense] }; } });
  await entered;
  const incoming = { ...primaryPool(), players: [...value.playerPool.players, ...primaryPool().players] };
  await syncFantasyPros(value, { loadDraftPool: async () => incoming }); release(); await depth;
  assert.ok(value.playerPool.players.find(p => p.id === 'fantasypros:2'));
  const added = value.playerPool.players.find(p => p.yahooPlayerKey === '470.p.901');
  assert.equal(added.byeWeek, 6); assert.equal(added.yahooObservedProjection.value, 500);
  assert.equal(added.yahooObservedProjection.period, 'unverified'); assert.equal(added.projectionImputed, true);
  assert.notEqual(added.projectedPoints, 500, 'An unscoped Yahoo total must not become a season projection');
  assert.deepEqual(JSON.parse(fs.readFileSync(value.playerSnapshotFile, 'utf8')), JSON.parse(JSON.stringify(value.playerPool)));
  value.playerPool.players = value.playerPool.players.filter(p => p.yahooPlayerKey !== '470.p.901');
  const blocker = path.join(directory, 'blocked'); fs.writeFileSync(blocker, 'preserve'); value.playerSnapshotFile = path.join(blocker, 'players.json');
  const before = structuredClone(value.playerPool);
  await assert.rejects(operations.supplementDraftDepth(entry, { availablePlayers: async () => ({ players: [defense] }) }));
  assert.deepEqual(value.playerPool, before);
  value.playerSnapshotFile = path.join(directory, 'players.json');
  await assert.rejects(operations.supplementDraftDepth(entry, { availablePlayers: async () => {
    entry.yahooLeagueKey = '470.l.2'; return { players: [defense] };
  } }), { code: 'YAHOO_DRAFT_DEPTH_SCOPE_CHANGED' });
  assert.deepEqual(value.playerPool, before);
});
