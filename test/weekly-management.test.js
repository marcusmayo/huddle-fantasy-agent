'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const baseLeague = require('../config/leagues/yahoo-example.json');
const playerPool = require('../config/fixtures/demo-players.json');
const { buildWeeklyReview, optimizeLineup, scorePlayerStats } = require('../src/domain/weekly-management');
const { buildApp } = require('../src/server');
const { DraftService } = require('../src/services/draft-service');
const { WeeklyManagementService } = require('../src/services/weekly-management-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');

function league(id = 'weekly-one', targetTeam = 'TARGET TEAM') {
  return {
    ...structuredClone(baseLeague),
    id,
    name: id.toUpperCase(),
    targetTeam,
    teamCount: 2,
    roster: { QB: 1, RB: 1, WR: 1, 'W/R': 1, BN: 2, IR: 1 }
  };
}

function snapshot({ targetTeam = 'TARGET TEAM', week = 4, candidateProjection = 120 } = {}) {
  return {
    season: 2026,
    week,
    source: 'test-normalized-import',
    teams: [
      { teamId: 'target', name: targetTeam, isTarget: true, score: 104, opponentId: 'other', standingRank: 1, previousStandingRank: 2, pointsFor: 405, pointsAgainst: 377 },
      { teamId: 'other', name: 'OTHER TEAM', score: 96, opponentId: 'target', standingRank: 2, previousStandingRank: 1, pointsFor: 390, pointsAgainst: 402 }
    ],
    roster: [
      { playerId: 'qb', name: 'Starter QB', position: 'QB', rosterSlot: 'QB', actualPoints: 10, remainingProjectedPoints: 180 },
      { playerId: 'rb-low', name: 'Starter RB', position: 'RB', rosterSlot: 'RB', actualPoints: 5, remainingProjectedPoints: 90 },
      { playerId: 'wr-high', name: 'Starter WR', position: 'WR', rosterSlot: 'WR', actualPoints: 15, remainingProjectedPoints: 140 },
      { playerId: 'rb-bench', name: 'Bench RB', position: 'RB', rosterSlot: 'BN', actualPoints: 20, remainingProjectedPoints: 100 },
      { playerId: 'wr-bench', name: 'Bench WR', position: 'WR', rosterSlot: 'BN', actualPoints: 3, remainingProjectedPoints: 70 }
    ],
    availablePlayers: [
      { playerId: 'waiver-wr', name: 'Waiver WR', position: 'WR', available: true, remainingProjectedPoints: candidateProjection, sleeperTrend: { direction: 'rising' } }
    ],
    transactions: [{ id: 'tx-1', type: 'waiver', teamId: 'other', playersAdded: ['Prior Add'], faab: 4, successful: true }],
    waiver: { budgetRemaining: 80, priority: 4 },
    holdThreshold: 2
  };
}

function runtime(tempDir) {
  const one = league('weekly-one', 'TARGET TEAM');
  const two = league('weekly-two', 'SECOND TARGET');
  return {
    host: '127.0.0.1',
    port: 0,
    instanceName: 'weekly-fleet-test',
    auditFile: path.join(tempDir, 'audit.jsonl'),
    fantasyProsSyncEnabled: false,
    defaultLeagueId: one.id,
    league: one,
    leagues: [
      { id: one.id, config: one, stateFile: path.join(tempDir, 'one.json') },
      { id: two.id, config: two, stateFile: path.join(tempDir, 'two.json') }
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

test('league scoring converts raw weekly player stats before recommendations', () => {
  const fullPprSixPointPassing = league();
  assert.equal(scorePlayerStats({ passingYards: 200, passingTouchdowns: 2, interceptions: 1 }, fullPprSixPointPassing), 20);
  assert.equal(scorePlayerStats({ receptions: 7, receivingYards: 80, receivingTouchdowns: 1 }, fullPprSixPointPassing), 21);

  const standard = league();
  standard.scoring.offense.reception = 0;
  assert.equal(scorePlayerStats({ receptions: 7, receivingYards: 80, receivingTouchdowns: 1 }, standard), 14);
  assert.equal(scorePlayerStats({ passingYards: 219 }, standard), 10);
  standard.scoring.negativePoints = false;
  assert.equal(scorePlayerStats({ passingYards: 200, interceptions: 2 }, standard), 10);
});

test('weekly review stores scores, standings movement, optimal lineup, activity, and add/drop guidance', () => {
  const review = buildWeeklyReview({ snapshot: snapshot(), league: league(), playerPool });
  assert.equal(review.targetResult.result, 'W');
  assert.equal(review.targetResult.positionMovement, 1);
  assert.deepEqual(review.weeklyWinners, [{ teamId: 'target', name: 'TARGET TEAM', score: 104 }]);
  assert.equal(review.lineup.actualPoints, 30);
  assert.equal(review.lineup.optimalPoints, 50);
  assert.equal(review.lineup.pointsLeftOnBench, 20);
  assert.equal(review.lineup.suggestedSwitches[0].start.name, 'Bench RB');
  assert.equal(review.transactions[0].type, 'waiver');
  assert.equal(review.roster.length, 5);
  assert.equal(review.availablePlayers.length, 1);
  assert.equal(review.waiver.recommendation.action, 'ADD_DROP');
  assert.equal(review.waiver.recommendation.add.name, 'Waiver WR');
  assert.equal(review.waiver.recommendation.drop.name, 'Bench WR');
  assert.equal(review.waiver.recommendation.expectedPointsGained, 50);
  assert.equal(review.execution, 'recommendation-only');
});

test('weekly waiver engine explicitly holds when no claim clears the league threshold', () => {
  const review = buildWeeklyReview({ snapshot: snapshot({ candidateProjection: 71 }), league: league(), playerPool });
  assert.equal(review.waiver.recommendation.action, 'HOLD');
  assert.equal(review.waiver.recommendation.expectedPointsGained, 1);
  assert.equal(review.waiver.recommendation.faab.recommended, 0);
  assert.match(review.waiver.recommendation.priorityGuidance, /Preserve/);
  assert.equal(review.waiver.recommendation.claimPlan.length, 0);
  assert.equal(review.waiver.recommendation.consideredAlternatives.length, 1);
});

test('weekly waiver guidance ranks fallback claims and compacts persisted candidate history', () => {
  const currentLeague = league();
  const largeSnapshot = snapshot();
  largeSnapshot.availablePlayers = Array.from({ length: 40 }, (_, index) => ({
    playerId: `waiver-${index + 1}`,
    name: `Waiver Player ${index + 1}`,
    position: index % 2 ? 'RB' : 'WR',
    available: true,
    remainingProjectedPoints: 160 - index
  }));
  const store = new MemoryStateStore();
  const draftService = new DraftService({ league: currentLeague, playerPool, store });
  const weeklyService = new WeeklyManagementService({
    league: currentLeague,
    playerPool,
    draftService,
    persistedCandidateLimit: 10
  });
  const imported = weeklyService.importSnapshot(largeSnapshot, { eventId: 'compact:1' });
  assert.equal(imported.review.availablePlayers.length, 40);
  assert.equal(imported.review.waiver.recommendation.claimPlan.length, 5);
  assert.deepEqual(imported.review.waiver.recommendation.claimPlan.map((item) => item.priority), [1, 2, 3, 4, 5]);
  const persisted = weeklyService.getWeek(4, 2026);
  assert.equal(persisted.availablePlayers.length, 10);
  assert.deepEqual(persisted.persistence, {
    persisted: true,
    rawProviderPayloadPersisted: false,
    compacted: true,
    availablePlayersObserved: 40,
    availablePlayersPersisted: 10,
    candidateLimit: 10
  });
  assert.ok(JSON.stringify(store.load()).length < JSON.stringify({ snapshot: largeSnapshot, review: imported.review }).length);
});

test('weekly rerun refreshes explicit current projections from the shared pool', () => {
  const currentLeague = league();
  const currentPool = structuredClone(playerPool);
  currentPool.players.push({
    id: 'waiver-wr',
    name: 'Waiver WR',
    position: 'WR',
    team: 'FA',
    remainingProjectedPoints: 130,
    sourceCoverage: { fantasyPros: true, tank01: true, sleeper: true }
  });
  const store = new MemoryStateStore();
  const draftService = new DraftService({ league: currentLeague, playerPool: currentPool, store });
  const weeklyService = new WeeklyManagementService({ league: currentLeague, playerPool: currentPool, draftService });
  const first = weeklyService.importSnapshot(snapshot({ candidateProjection: 71 }), { eventId: 'projection-refresh:1' });
  assert.equal(first.review.waiver.recommendation.action, 'HOLD');
  const rerun = weeklyService.rerun(4, 2026);
  assert.equal(rerun.review.waiver.recommendation.action, 'ADD_DROP');
  assert.equal(rerun.review.waiver.recommendation.expectedPointsGained, 60);
  assert.ok(rerun.review.evidence.projectionsRefreshed >= 1);
});

test('weekly snapshot rejects non-reciprocal matchups and illegal actual lineup slots', () => {
  const brokenOpponent = snapshot();
  brokenOpponent.teams[1].opponentId = 'other';
  assert.throws(
    () => buildWeeklyReview({ snapshot: brokenOpponent, league: league(), playerPool }),
    (error) => error.code === 'INVALID_WEEKLY_SNAPSHOT' && /reference each other/.test(error.message)
  );

  const brokenLineup = snapshot();
  brokenLineup.roster[0].rosterSlot = 'RB';
  assert.throws(
    () => buildWeeklyReview({ snapshot: brokenLineup, league: league(), playerPool }),
    (error) => error.code === 'INVALID_WEEKLY_SNAPSHOT' && /not eligible/.test(error.message)
  );
});

test('lineup optimizer remains fast for a full 20-player two-quarterback roster', () => {
  const positions = ['QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'K', 'K', 'DEF', 'DEF'];
  const players = positions.map((playerPosition, index) => ({
    playerId: `scale-${index}`,
    name: `Scale ${index}`,
    position: playerPosition,
    actualPoints: 30 - index
  }));
  const startedAt = performance.now();
  const result = optimizeLineup(players, baseLeague.roster);
  const elapsed = performance.now() - startedAt;
  assert.equal(result.assignments.length, 14);
  assert.equal(result.assignments.filter((item) => item.player).length, 14);
  assert.ok(elapsed < 500, `optimizer took ${elapsed.toFixed(1)} ms`);
});

test('weekly state is persisted beside draft state without overwriting it and events are idempotent', () => {
  const store = new MemoryStateStore();
  const currentLeague = league();
  const draftService = new DraftService({ league: currentLeague, playerPool, store });
  const weeklyService = new WeeklyManagementService({ league: currentLeague, playerPool, draftService });
  const session = draftService.createSession({ draftSlot: 1 });
  const first = weeklyService.importSnapshot(snapshot(), { eventId: 'yahoo:weekly-one:2026:4' });
  const duplicate = weeklyService.importSnapshot(snapshot(), { eventId: 'yahoo:weekly-one:2026:4' });
  assert.equal(first.applied, true);
  assert.equal(duplicate.applied, false);
  assert.equal(weeklyService.listWeeks().length, 1);
  assert.equal(draftService.getSession(session.id).id, session.id);
  const persisted = store.load();
  assert.ok(persisted.sessions[session.id]);
  assert.ok(persisted.weekly.weeks['2026:4']);
});

test('weekly reviews can be deleted individually or cleared by season without crossing league state', () => {
  const store = new MemoryStateStore();
  const currentLeague = league();
  const draftService = new DraftService({ league: currentLeague, playerPool, store });
  const weeklyService = new WeeklyManagementService({ league: currentLeague, playerPool, draftService });
  weeklyService.importSnapshot(snapshot(), { eventId: 'review:2026:4' });
  weeklyService.importSnapshot({ ...snapshot({ week: 5 }), season: 2024 }, { eventId: 'review:2024:5' });
  assert.deepEqual(weeklyService.listWeeks().map((item) => [item.season, item.week]), [[2026, 4], [2024, 5]]);
  assert.equal(weeklyService.completeWeek(4, 2026).status, 'completed');
  assert.equal(weeklyService.status().completedReviews, 1);
  assert.equal(weeklyService.reopenWeek(4, 2026).status, 'open');
  assert.equal(weeklyService.status().openReviews, 2);

  assert.equal(weeklyService.deleteWeek(5, 2024).deleted, true);
  assert.deepEqual(weeklyService.listWeeks().map((item) => [item.season, item.week]), [[2026, 4]]);
  assert.equal(weeklyService.importSnapshot({ ...snapshot({ week: 5 }), season: 2024 }, { eventId: 'review:2024:5' }).applied, true);

  const cleared = weeklyService.deleteWeeks({ season: 2026 });
  assert.equal(cleared.deletedReviews, 1);
  assert.deepEqual(weeklyService.listWeeks().map((item) => [item.season, item.week]), [[2024, 5]]);
});

test('fleet weekly run isolates a failed league and preserves the successful league review', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-weekly-fleet-'));
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore() });
  const result = await app.weeklyFleetRunner.run({
    season: 2026,
    week: 4,
    leagues: [
      { leagueId: 'weekly-one', snapshot: snapshot() },
      { leagueId: 'weekly-two', snapshot: { ...snapshot({ targetTeam: 'WRONG TARGET' }), teams: snapshot().teams.map((team) => ({ ...team, isTarget: false })) } }
    ]
  });
  assert.equal(result.complete, false);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].error, 'INVALID_WEEKLY_SNAPSHOT');
  assert.equal(app.weeklyServices.get('weekly-one').listWeeks().length, 1);
  assert.equal(app.weeklyServices.get('weekly-two').listWeeks().length, 0);
});

test('league-scoped weekly HTTP API imports, reruns, and reports fleet capability', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-weekly-api-'));
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const importedResponse = await fetch(`${base}/api/leagues/weekly-one/weekly/weeks/4/import?season=2026`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot: snapshot(), eventId: 'api-test:1' })
    });
    const imported = await importedResponse.json();
    assert.equal(importedResponse.status, 200);
    assert.equal(imported.review.leagueId, 'weekly-one');

    const weeks = await (await fetch(`${base}/api/leagues/weekly-one/weekly/weeks`)).json();
    assert.equal(weeks.weeks[0].week, 4);
    assert.equal(weeks.weeks[0].waiverAction, 'ADD_DROP');

    const rerun = await (await fetch(`${base}/api/leagues/weekly-one/weekly/weeks/4/run?season=2026`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(rerun.review.waiver.recommendation.action, 'ADD_DROP');

    const completed = await (await fetch(`${base}/api/leagues/weekly-one/weekly/weeks/4/complete?season=2026`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(completed.review.status, 'completed');
    const reopened = await (await fetch(`${base}/api/leagues/weekly-one/weekly/weeks/4/reopen?season=2026`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(reopened.review.status, 'open');

    const deleted = await (await fetch(`${base}/api/leagues/weekly-one/weekly/weeks/4?season=2026`, { method: 'DELETE' })).json();
    assert.equal(deleted.deleted, true);
    const afterDelete = await (await fetch(`${base}/api/leagues/weekly-one/weekly/weeks`)).json();
    assert.equal(afterDelete.weeks.length, 0);

    const manifest = await (await fetch(`${base}/api/fleet/manifest`)).json();
    assert.ok(manifest.capabilities.includes('isolated-weekly-management'));
    assert.equal(manifest.leagues.find((item) => item.id === 'weekly-one').weekly.storedWeeks, 0);
  } finally {
    await close(app);
  }
});

test('league-scoped draft HTTP API completes, reopens, and deletes a session', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-draft-lifecycle-api-'));
  const app = buildApp(runtime(tempDir), { storeFactory: () => new MemoryStateStore() });
  const base = await listen(app);
  try {
    const createdResponse = await fetch(`${base}/api/leagues/weekly-one/draft/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draftSlot: 1, sourceMode: 'manual' })
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);

    const completed = await (await fetch(`${base}/api/leagues/weekly-one/draft/sessions/${created.id}/complete`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(completed.session.status, 'completed');

    const reopened = await (await fetch(`${base}/api/leagues/weekly-one/draft/sessions/${created.id}/reopen`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })).json();
    assert.equal(reopened.session.status, 'active');

    const deleted = await (await fetch(`${base}/api/leagues/weekly-one/draft/sessions/${created.id}`, { method: 'DELETE' })).json();
    assert.equal(deleted.deleted, true);
    const sessions = await (await fetch(`${base}/api/leagues/weekly-one/draft/sessions`)).json();
    assert.equal(sessions.sessions.length, 0);
  } finally {
    await close(app);
  }
});

test('weekly management controls are present in the Huddle dashboard', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /id="weekly-mode"/);
  assert.match(html, /id="weekly-import"/);
  assert.match(html, /id="weekly-yahoo-refresh"/);
  assert.match(html, /id="weekly-delete-review"/);
  assert.match(html, /id="weekly-complete-review"/);
  assert.match(html, /id="weekly-clear-season"/);
  assert.match(html, /id="draft-session-history"/);
  assert.match(html, /id="yahoo-draft-sync"/);
  assert.match(html, /HOLD/);
  assert.match(html, /Actual vs optimal/);
  assert.match(html, /Fantasy data provided by/);
  assert.match(html, /https:\/\/football\.fantasysports\.yahoo\.com\//);
  const client = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
  assert.match(client, /classList\.toggle\('hidden', state\.mode === 'weekly'\)/);
  assert.match(client, /data-league-delete/);
  assert.match(client, /draggable="true"/);
  assert.match(client, /refreshWeeklyFromYahoo/);
  assert.match(client, /controlYahooDraftSync/);
});

test('dashboard exposes an intentional empty-fleet onboarding state', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
  const client = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /id="fleet-empty"/);
  assert.match(html, /id="empty-connect-yahoo"/);
  assert.match(html, /id="empty-add-league"/);
  assert.match(html, /id="yahoo-league-results"/);
  assert.match(client, /function showEmptyFleet\(\)/);
  assert.match(client, /function discoverYahooLeagues\(\)/);
  assert.match(client, /\/api\/yahoo\/leagues\/import/);
  assert.match(client, /else showEmptyFleet\(\)/);
});

test('the bundled weekly snapshot satisfies the default league contract', () => {
  const example = require('../config/fixtures/weekly-snapshot.example.json');
  const review = buildWeeklyReview({ snapshot: example, league: baseLeague, playerPool });
  assert.equal(review.teams.length, baseLeague.teamCount);
  assert.equal(review.targetTeam, baseLeague.targetTeam);
});
