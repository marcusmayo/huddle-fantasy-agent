'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { YahooDraftPoller, extractYahooPlayer } = require('../src/providers/yahoo');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const { buildRecommendationCard } = require('../src/domain/draft-board');
const { byeCoverageReport } = require('../src/domain/roster-value');
const { normalizeTeam } = require('../src/domain/player-snapshot');
const { leagueProjection, scoringFingerprint } = require('../src/domain/league-projections');
const originalLeague = require('../config/leagues/yahoo-example.json');
const league = { ...originalLeague, teamCount: 6, roster: { QB: 2, WR: 4, RB: 3, TE: 1, 'W/T': 1, 'W/R': 1, K: 1, DEF: 2, BN: 5, IR: 2 } };

test('matching abbreviated names cannot discard different Yahoo player IDs', () => {
  const players = [{ id: 'a', name: 'J. Williams', position: 'WR', team: 'DET', yahooPlayerKey: 'nfl.p.1' },
    { id: 'b', name: 'J. Williams', position: 'RB', team: 'DAL', yahooPlayerKey: 'nfl.p.2' },
    { id: 'alias-a', name: 'Full Name Williams', position: 'WR', team: 'DET', yahooPlayerKey: 'nfl.p.1' }];
  const drafts = new DraftService({ league, playerPool: { players, source: 'test' }, store: new MemoryStateStore() });
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  assert.equal(drafts.recordPick(session.id, { playerId: 'a' }).applied, true);
  assert.equal(drafts.recordPick(session.id, { playerId: 'b' }).applied, true);
  assert.equal(drafts.recordPick(session.id, { playerId: 'alias-a' }).applied, false);
  assert.equal(drafts.getSession(session.id).picks.length, 2);
});

test('a completed 120-pick DR room has no phantom pick, on-clock signal or recommendations', () => {
  const picks = Array.from({ length: 120 }, (_, index) => ({ overallPick: index + 1, playerId: `p${index}`, position: 'WR', isMine: index % 6 === 0 }));
  const card = buildRecommendationCard({ players: [], picks, league, draftSlot: 1 });
  assert.equal(card.completed, true);
  assert.equal(card.currentOverall, null);
  assert.equal(card.nextUserPick, null);
  assert.equal(card.onClock, false);
  assert.equal(card.preferred, null);
  assert.deepEqual(card.board, []);
});

test('Once, Start, repeated Start and Stop/Start during a read never create overlapping reads or orphan timers', async () => {
  let release;
  let reads = 0;
  const session = { status: 'active', picks: [], draftSlot: 1 };
  const poller = new YahooDraftPoller({ client: { draftResults: () => { reads++; return new Promise(resolve => { release = resolve; }); } },
    leagueKey: '1.l.1', sessionId: 'session', playerPool: { players: [] },
    draftService: { league, getSession: () => session }, targetTeamKey: '1.l.1.t.1' });
  const once = poller.syncOnce();
  poller.start(); poller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  poller.stop(); poller.start();
  assert.equal(reads, 1);
  release({ picks: [] }); await once;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(poller.running, true);
  assert.ok(poller.timer);
  poller.stop();
  assert.equal(poller.timer, null);
  assert.equal(poller.running, false);
});

test('out-of-pool accepted player keeps value, bye and scoring provenance through restart', () => {
  const store = new MemoryStateStore();
  const drafts = new DraftService({ league, playerPool: { players: [], source: 'test' }, store });
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  drafts.recordPick(session.id, { isMine: true, externalPlayer: {
    yahooPlayerKey: '470.p.40993', name: 'Bucky Irving', position: 'RB', team: 'TB', byeWeek: 10,
    projectedPoints: 204, projectionLeagueId: league.id, projectionScoringVerified: true,
    projectionScoringFingerprint: scoringFingerprint(league), projectionSource: 'verified-fixture', injuryStatus: '', raw_private_payload: 'DO NOT RETAIN'
  } });
  const restored = new DraftService({ league, playerPool: { players: [], source: 'test' }, store });
  const pick = restored.getSession(session.id).picks[0];
  assert.equal(pick.projectedPoints, 204); assert.equal(pick.byeWeek, 10);
  assert.equal(pick.projectionScoringVerified, true);
  assert.equal(restored.recommendation(session.id).rosterCoverage.unknownValues, 0);
  assert.doesNotMatch(JSON.stringify(store.load()), /DO NOT RETAIN/);
});

test('Yahoo bye extraction ignores a stats week, and team aliases normalize consistently', () => {
  const player = extractYahooPlayer({ player_key: '470.p.1', name: { full: 'Known Player' }, display_position: 'RB', editorial_team_abbr: 'Pit', player_stats: { week: '2' }, bye_weeks: { week: '9' }, status: 'Q' });
  assert.equal(player.byeWeek, 9); assert.equal(player.team, 'PIT'); assert.equal(player.injuryStatus, 'Q');
  assert.equal(normalizeTeam('Pit'), normalizeTeam('PIT'));
  assert.equal(normalizeTeam('JAX'), normalizeTeam('JAC'));
  assert.equal(normalizeTeam('FA'), null);
});

test('unknown coverage is not a clean bye result and legal backups can still lose projected points', () => {
  const format = { roster: { QB: 1, BN: 1 } };
  const first = { id: 'first', position: 'QB', projectedPoints: 340, byeWeek: 7 };
  const reserve = { id: 'reserve', position: 'QB', projectedPoints: 170, byeWeek: 11 };
  const report = byeCoverageReport([first, reserve], format);
  assert.equal(report.gaps.length, 0);
  assert.deepEqual(report.weeklyLosses, [{ week: 7, estimatedPointsLost: 10 }]);
  const incomplete = byeCoverageReport([{ ...first, byeWeek: null }, reserve], format);
  assert.equal(incomplete.coverageVerified, false); assert.equal(incomplete.weeklyLosses, null);
});

test('same league ID cannot certify an old scoring basis after rules change', () => {
  const player = { projectedPoints: 387, projectionLeagueId: league.id, projectionScoringVerified: true, projectionScoringFingerprint: scoringFingerprint(league) };
  assert.equal(leagueProjection(player, league).projectionScoringVerified, true);
  const changed = { ...league, scoring: { ...league.scoring, offense: { ...league.scoring.offense, passingTouchdown: 99 } } };
  assert.equal(leagueProjection(player, changed).projectionScoringVerified, false);
  assert.equal(leagueProjection({ ...player, projectionScoringFingerprint: undefined }, league).projectionScoringVerified, false);
});
