'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { normalizeYahooWeeklyBundle } = require('../src/providers/yahoo-weekly-normalizer');
const { buildApp } = require('../src/server');
const { DraftService } = require('../src/services/draft-service');
const { WeeklyManagementService } = require('../src/services/weekly-management-service');
const { YahooOperationsService } = require('../src/services/yahoo-operations-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');

const league = {
  id: 'live-yahoo', platform: 'yahoo', name: 'Live Yahoo League', targetTeam: 'My Team', teamCount: 2,
  draft: { type: 'live-standard-snake', secondsPerPick: 90, draftSlot: 1, autoRenew: false },
  roster: { QB: 1, BN: 1 },
  scoringType: 'head-to-head',
  scoring: {
    fractionalPoints: true, negativePoints: true,
    offense: { passingYardsPerPoint: 25, passingTouchdown: 4, interception: -2, rushingYardsPerPoint: 10, rushingTouchdown: 6, reception: 1, receivingYardsPerPoint: 10, receivingTouchdown: 6 },
    kicking: {}, defense: {}
  },
  waivers: { type: 'rolling', timeDays: 2, weeklyWindow: 'game-time-through-tuesday' },
  playoffs: { teams: 2, weeks: [17, 18], tiebreaker: 'higher-seed', reseed: false },
  provenance: { verificationStatus: 'verified', yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', season: 2026 }
};

const pool = {
  source: 'fantasypros-test', complete: true, fetchedAt: '2026-09-08T12:00:00.000Z',
  players: [
    { id: 'fp-qb', yahooPlayerKey: '999.p.1', name: 'Quarterback One', position: 'QB', team: 'AAA', projectedPoints: 300, weeklyProjectedPoints: 20, remainingProjectedPoints: 250 },
    { id: 'fp-rb', yahooPlayerKey: '999.p.2', name: 'Running Back Two', position: 'RB', team: 'BBB', projectedPoints: 220, weeklyProjectedPoints: 12, remainingProjectedPoints: 180 },
    { id: 'fp-wr', yahooPlayerKey: '999.p.3', name: 'Wide Receiver Three', position: 'WR', team: 'CCC', projectedPoints: 205, weeklyProjectedPoints: 11, remainingProjectedPoints: 170 },
    { id: 'fp-te', yahooPlayerKey: '999.p.4', name: 'Tight End Four', position: 'TE', team: 'DDD', projectedPoints: 165, weeklyProjectedPoints: 9, remainingProjectedPoints: 130 }
  ]
};

function team(key, id, name, points) {
  return { team: [
    { team_key: key, team_id: String(id) },
    { name: { full: name } },
    { team_points: { total: String(points) } }
  ] };
}

function standingsTeam(key, id, name, rank, pointsFor, pointsAgainst) {
  return { team: [
    { team_key: key, team_id: String(id) },
    { name: { full: name } },
    { waiver_priority: String(rank), faab_balance: String(100 - rank) },
    { team_standings: { rank: String(rank), points_for: String(pointsFor), points_against: String(pointsAgainst), outcome_totals: { wins: rank === 1 ? '1' : '0', losses: rank === 1 ? '0' : '1', ties: '0' } } }
  ] };
}

function player(key, name, position, slot, actual, projected) {
  return { player: [
    { player_key: key },
    { name: { full: name } },
    { display_position: position, editorial_team_abbr: 'AAA', status: 'HEALTHY' },
    { selected_position: { position: slot } },
    { player_points: { total: String(actual) } },
    { player_projected_points: { total: String(projected) } },
    { raw_sentinel: 'RAW_WEEKLY_YAHOO_MUST_NOT_PERSIST' }
  ] };
}

function yahooWeeklyBundle() {
  return {
    scoreboard: { fantasy_content: { league: [{ scoreboard: { matchups: {
      0: { matchup: { teams: { 0: team('999.l.1.t.1', 1, 'My Team', 21), 1: team('999.l.1.t.2', 2, 'Opponent', 17), count: 2 } } },
      count: 1
    } } }] } },
    standings: { fantasy_content: { league: [{ standings: { teams: {
      0: standingsTeam('999.l.1.t.1', 1, 'My Team', 1, 21, 17),
      1: standingsTeam('999.l.1.t.2', 2, 'Opponent', 2, 17, 21),
      count: 2
    } } }] } },
    roster: { fantasy_content: { team: [{ roster: { players: {
      0: player('999.p.1', 'Quarterback One', 'QB', 'QB', 21, 20),
      1: player('999.p.2', 'Running Back Two', 'RB', 'BN', 17, 12),
      count: 2
    } } }] } },
    availablePlayers: { fantasy_content: { league: [{ players: {
      0: player('999.p.3', 'Available Runner', 'RB', 'BN', 0, 14),
      count: 1
    } }] } },
    transactions: { fantasy_content: { league: [{ transactions: {
      0: { transaction: [{ transaction_key: '999.tr.1', type: 'add/drop', status: 'successful', timestamp: '1788883200' }] },
      count: 1
    } }] } }
  };
}

test('Yahoo weekly v1 normalizer creates a complete safe snapshot without raw payload retention', () => {
  const snapshot = normalizeYahooWeeklyBundle(yahooWeeklyBundle(), {
    league, leagueKey: '999.l.1', teamKey: '999.l.1.t.1', week: 1, season: 2026
  });
  assert.equal(snapshot.teams.length, 2);
  assert.equal(snapshot.teams.find((item) => item.isTarget).opponentId, '2');
  assert.equal(snapshot.roster.length, 2);
  assert.equal(snapshot.roster[0].rosterSlot, 'QB');
  assert.equal(snapshot.availablePlayers[0].available, true);
  assert.equal(snapshot.waiver.priority, 1);
  assert.equal(snapshot.normalization.adapter, 'yahoo-weekly-v1');
  assert.doesNotMatch(JSON.stringify(snapshot), /RAW_WEEKLY_YAHOO_MUST_NOT_PERSIST/);
});

test('Yahoo operations readiness and one-shot draft sync are fail-loud and idempotent', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-ops-'));
  const store = new MemoryStateStore();
  const drafts = new DraftService({ league, playerPool: structuredClone(pool), store });
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  const weekly = new WeeklyManagementService({ league, playerPool: structuredClone(pool), draftService: drafts });
  const runtime = {
    season: 2026, playerPool: structuredClone(pool), leagues: [{
      id: league.id, config: league, stateFile: path.join(tempDir, 'state.json'),
      yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', verificationStatus: 'verified'
    }],
    yahooDraftAutoSyncEnabled: true, yahooDraftPollIntervalMs: 15_000,
    yahooDraftMinimumCrosswalkCoverage: 0.8, yahooWeeklyAutoRefreshEnabled: false,
    yahooWeeklyRefreshIntervalMs: 86_400_000, yahooWeeklyPreviewTtlMs: 3_600_000,
    operationsMaximumEvidenceAgeHours: 36, leagueErrors: []
  };
  const yahooAccount = {
    status: () => ({ enabled: true, clientConfigured: true, encryptedTokenStorageConfigured: true, connected: true, mode: 'read-only' }),
    readClient: () => ({ draftResults: async () => ({ picks: [{ overallPick: 1, teamKey: '999.l.1.t.1', yahooPlayerKey: '999.p.1' }] }) })
  };
  const operations = new YahooOperationsService({
    runtime, yahooAccount, draftServices: new Map([[league.id, drafts]]), weeklyServices: new Map([[league.id, weekly]]),
    now: () => new Date('2026-09-08T12:30:00.000Z')
  });
  assert.equal(operations.readiness().readyForLiveDraft, true);
  const first = await operations.syncDraftOnce({ leagueId: league.id, sessionId: session.id });
  assert.equal(first.state, 'running');
  assert.equal(drafts.getSession(session.id).picks.length, 1);
  await operations.syncDraftOnce({ leagueId: league.id, sessionId: session.id });
  assert.equal(drafts.getSession(session.id).picks.length, 1);
  operations.stop();
});

test('Yahoo weekly operations return an expiring transient review and never save it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-weekly-ops-'));
  const store = new MemoryStateStore();
  const drafts = new DraftService({ league, playerPool: structuredClone(pool), store });
  const weekly = new WeeklyManagementService({ league, playerPool: structuredClone(pool), draftService: drafts });
  const before = JSON.stringify(store.load());
  const raw = yahooWeeklyBundle();
  const client = {
    scoreboard: async () => raw.scoreboard,
    standings: async () => raw.standings,
    transactions: async () => raw.transactions,
    roster: async () => raw.roster,
    availablePlayers: async () => raw.availablePlayers
  };
  const runtime = {
    season: 2026, playerPool: structuredClone(pool), leagues: [{
      id: league.id, config: league, stateFile: path.join(tempDir, 'state.json'),
      yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', verificationStatus: 'verified'
    }],
    yahooDraftAutoSyncEnabled: true, yahooDraftPollIntervalMs: 15_000,
    yahooDraftMinimumCrosswalkCoverage: 0.8, yahooWeeklyAutoRefreshEnabled: true,
    yahooWeeklyRefreshIntervalMs: 86_400_000, yahooWeeklyPreviewTtlMs: 3_600_000,
    operationsMaximumEvidenceAgeHours: 36, leagueErrors: []
  };
  const yahooAccount = {
    status: () => ({ enabled: true, clientConfigured: true, encryptedTokenStorageConfigured: true, connected: true, mode: 'read-only' }),
    readClient: () => client,
    discoverLeagues: async () => ({ leagues: [{ leagueKey: '999.l.1', currentWeek: 1, season: 2026 }] })
  };
  const operations = new YahooOperationsService({
    runtime, yahooAccount, draftServices: new Map([[league.id, drafts]]), weeklyServices: new Map([[league.id, weekly]]),
    now: () => new Date('2026-09-15T12:00:00.000Z')
  });
  const status = await operations.previewWeekly({ leagueId: league.id, week: 1, season: 2026 });
  assert.equal(status.state, 'ready');
  assert.equal(status.review.persistence.persisted, false);
  assert.equal(status.review.waiver.recommendation.action, 'HOLD');
  assert.equal(JSON.stringify(store.load()), before);
  assert.doesNotMatch(JSON.stringify(store.load()), /RAW_WEEKLY_YAHOO_MUST_NOT_PERSIST/);
  assert.equal(operations.readiness().readyForWeeklyManagement, true);
  const fleet = await operations.refreshWeeklyFleet({ trigger: 'test' });
  assert.equal(fleet.complete, true);
  assert.equal(fleet.trigger, 'test');
  assert.equal(operations.weeklyFleetStatus().latestRun.succeeded, 1);
  assert.equal(JSON.stringify(store.load()), before);
});

test('demo profiles are excluded from Yahoo draft and scheduled weekly operations', async () => {
  const demo = { ...structuredClone(league), platform: 'demo', id: 'demo-only', name: 'Demo Only' };
  let discoveries = 0;
  const operations = new YahooOperationsService({
    runtime: {
      season: 2026,
      playerPool: structuredClone(pool),
      leagues: [{ id: demo.id, config: demo, stateFile: '/tmp/demo-only.json', yahooLeagueKey: null, yahooTeamKey: null, verificationStatus: 'unverified' }],
      yahooDraftAutoSyncEnabled: true,
      yahooDraftPollIntervalMs: 15_000,
      yahooDraftMinimumCrosswalkCoverage: 0.8,
      yahooWeeklyAutoRefreshEnabled: true,
      yahooWeeklyRefreshIntervalMs: 86_400_000,
      yahooWeeklyPreviewTtlMs: 3_600_000,
      operationsMaximumEvidenceAgeHours: 36,
      leagueErrors: []
    },
    yahooAccount: {
      status: () => ({ enabled: true, clientConfigured: true, encryptedTokenStorageConfigured: true, connected: true }),
      discoverLeagues: async () => { discoveries += 1; throw new Error('demo must not call Yahoo'); }
    },
    draftServices: new Map(),
    weeklyServices: new Map(),
    now: () => new Date('2026-09-08T12:30:00.000Z')
  });
  const readiness = operations.readiness();
  assert.deepEqual(readiness.leagues, []);
  assert.equal(readiness.blockers.includes('No Yahoo league is imported'), true);
  assert.equal(readiness.blockers.some((blocker) => blocker.includes('Synthetic demo player evidence')), false);
  const run = await operations.refreshWeeklyFleet({ trigger: 'test' });
  assert.deepEqual(run.results, []);
  assert.equal(run.complete, true);
  assert.equal(discoveries, 0);
});

test('operational readiness identifies synthetic evidence as a live-draft blocker', () => {
  const syntheticPool = structuredClone(pool);
  syntheticPool.source = 'synthetic-demo-data';
  const operations = new YahooOperationsService({
    runtime: {
      season: 2026,
      playerPool: syntheticPool,
      leagues: [{
        id: league.id, config: league, stateFile: '/tmp/live-yahoo.json',
        yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', verificationStatus: 'verified'
      }],
      yahooDraftAutoSyncEnabled: true,
      yahooDraftPollIntervalMs: 15_000,
      yahooDraftMinimumCrosswalkCoverage: 0.8,
      yahooWeeklyAutoRefreshEnabled: false,
      yahooWeeklyRefreshIntervalMs: 86_400_000,
      yahooWeeklyPreviewTtlMs: 3_600_000,
      operationsMaximumEvidenceAgeHours: 36,
      leagueErrors: []
    },
    yahooAccount: {
      status: () => ({ enabled: true, clientConfigured: true, encryptedTokenStorageConfigured: true, connected: true })
    },
    draftServices: new Map([[league.id, { listSessions: () => [] }]]),
    weeklyServices: new Map(),
    now: () => new Date('2026-09-08T12:30:00.000Z')
  });
  const readiness = operations.readiness();
  assert.equal(readiness.readyForLiveDraft, false);
  assert.match(readiness.blockers.join(' '), /Synthetic demo player evidence.*FANTASYPROS_API_KEY/);
});

test('operational readiness blocks a mapped player pool that cannot cover the complete draft', () => {
  const shallowPool = structuredClone(pool);
  shallowPool.players = shallowPool.players.slice(0, 3);
  const operations = new YahooOperationsService({
    runtime: {
      season: 2026,
      playerPool: shallowPool,
      leagues: [{
        id: league.id, config: league, stateFile: '/tmp/live-yahoo.json',
        yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', verificationStatus: 'verified'
      }],
      yahooDraftAutoSyncEnabled: true,
      yahooDraftPollIntervalMs: 15_000,
      yahooDraftMinimumCrosswalkCoverage: 0.8,
      yahooWeeklyAutoRefreshEnabled: false,
      yahooWeeklyRefreshIntervalMs: 86_400_000,
      yahooWeeklyPreviewTtlMs: 3_600_000,
      operationsMaximumEvidenceAgeHours: 36,
      leagueErrors: []
    },
    yahooAccount: {
      status: () => ({ enabled: true, clientConfigured: true, encryptedTokenStorageConfigured: true, connected: true })
    },
    draftServices: new Map([[league.id, { listSessions: () => [] }]]),
    weeklyServices: new Map(),
    now: () => new Date('2026-09-08T12:30:00.000Z')
  });

  const readiness = operations.readiness();
  assert.equal(readiness.playerEvidence.crosswalk.coverage, 1);
  assert.equal(readiness.playerEvidence.crosswalk.requiredPlayers, 4);
  assert.equal(readiness.playerEvidence.crosswalk.playerShortfall, 1);
  assert.equal(readiness.readyForLiveDraft, false);
  assert.match(readiness.blockers.join(' '), /pool has 3 players.*requires at least 4/);
});

test('operational HTTP routes expose readiness, draft sync control, and transient weekly refresh', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-ops-http-'));
  const calls = [];
  const yahooOperations = {
    readiness: () => ({ readyForLiveDraft: true, readyForWeeklyManagement: true }),
    startDraftSync: ({ leagueId, sessionId }) => {
      calls.push(['start', leagueId, sessionId]);
      return { leagueId, sessionId, state: 'running', observedPicks: 0 };
    },
    draftStatus: (leagueId, sessionId) => ({ leagueId, sessionId, state: 'running', observedPicks: 0 }),
    syncDraftOnce: async ({ leagueId, sessionId }) => ({ leagueId, sessionId, state: 'running', observedPicks: 1 }),
    stopDraftSync: ({ leagueId, sessionId }) => ({ leagueId, sessionId, state: 'stopped', observedPicks: 1 }),
    weeklyStatus: (leagueId, options = {}) => ({ leagueId, state: 'ready', review: options.includeReview ? { week: 1 } : null }),
    weeklyFleetStatus: () => ({ scheduled: true, latestRun: { complete: true, succeeded: 1, failed: 0 }, leagues: [] }),
    previewWeekly: async ({ leagueId, week, season }) => ({ leagueId, week: Number(week), season: Number(season), state: 'ready', review: { week: Number(week), season: Number(season) } }),
    refreshWeeklyFleet: async () => ({ complete: true, succeeded: 1, failed: 0, results: [] }),
    runScheduledWeeklyRefresh: async () => ({ complete: true, succeeded: 1, failed: 0, results: [] }),
    start() {}, stop() {}
  };
  const runtime = {
    host: '127.0.0.1', port: 0, instanceName: 'operations-http-test', fantasyProsSyncEnabled: false,
    defaultLeagueId: league.id, league, leagues: [{
      id: league.id, config: league, stateFile: path.join(tempDir, 'state.json'),
      yahooLeagueKey: '999.l.1', yahooTeamKey: '999.l.1.t.1', verificationStatus: 'verified'
    }],
    playerPool: structuredClone(pool)
  };
  const yahooAccount = {
    status: () => ({ enabled: true, clientConfigured: true, encryptedTokenStorageConfigured: true, connected: true }),
    discoverLeagues: async () => ({ leagues: [] }), disconnect: () => true
  };
  const app = buildApp(runtime, { storeFactory: () => new MemoryStateStore(), yahooAccount, yahooOperations });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const readiness = await (await fetch(`${base}/api/operations/readiness`)).json();
    assert.equal(readiness.readyForLiveDraft, true);
    const created = await (await fetch(`${base}/api/leagues/${league.id}/draft/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftSlot: 1, sourceMode: 'yahoo' })
    })).json();
    assert.equal(created.yahooSync.state, 'running');
    assert.deepEqual(calls[0], ['start', league.id, created.id]);
    const sync = await (await fetch(`${base}/api/leagues/${league.id}/draft/sessions/${created.id}/yahoo-sync`)).json();
    assert.equal(sync.state, 'running');
    const weeklyResponse = await fetch(`${base}/api/leagues/${league.id}/weekly/yahoo/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ week: 1, season: 2026 })
    });
    assert.equal(weeklyResponse.status, 200);
    assert.equal((await weeklyResponse.json()).review.week, 1);
    const weeklyFleet = await (await fetch(`${base}/api/operations/weekly/status`)).json();
    assert.equal(weeklyFleet.latestRun.complete, true);
  } finally {
    await new Promise((resolve) => app.commandRelay.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
  }
});
