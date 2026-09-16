'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTeams, extractTransactions, normalizeYahooPlayer } = require('../src/providers/yahoo-weekly-normalizer');
const { buildWeeklyReview, waiverRecommendation } = require('../src/domain/weekly-management');
const { WeeklyEvidenceService, tankPlayers, fantasyProsPlayers } = require('../src/services/weekly-evidence-service');
const league = { ...require('../config/leagues/yahoo-example.json'), id: 'test', targetTeam: 'A', teamCount: 2, roster: { DEF: 1, BN: 1 } };
const team = (id, total, coverage_type = 'week') => ({ team: { team_key: `470.l.1.t.${id}`, team_id: String(id), name: id === 1 ? 'A' : 'B', team_points: { total, coverage_type, week: 2 } } });

test('standings season totals cannot overwrite week 2 scores; pregame is not a tie or a weekly win', () => {
  const teams = extractTeams({ scoreboard: { matchup: { status: 'preevent', teams: [team(1, 0), team(2, 0)] } }, standings: { teams: [team(1, 245, 'season'), team(2, 234, 'season')] } }, { league, teamKey: '470.l.1.t.1', week: 2 });
  assert.deepEqual(teams.map(t => t.score), [0, 0]);
  const review = buildWeeklyReview({ league, snapshot: { week: 2, season: 2026, teams, roster: [], availablePlayers: [] } });
  assert.equal(review.targetResult.result, null);
  assert.deepEqual(review.weeklyWinners, []);
});

test('wrong-period player points are rejected and unknown ownership is not free agency', () => {
  const player = normalizeYahooPlayer({ player_key: '470.p.1', name: { full: 'A' }, display_position: 'RB', player_points: { coverage_type: 'week', week: 1, total: 50 } }, { available: true, week: 2 });
  assert.equal(player.actualPoints, null);
  assert.equal(player.availabilityStatus, 'unknown');
  assert.equal(extractTransactions({ transaction: { transaction_key: 'claim', status: 'pending' } })[0].successful, null);
});

test('missing weekly data is not HOLD and legal starting defense replacements prefer free agency', () => {
  const current = { playerId: 'min', name: 'Vikings', position: 'DEF', rosterSlot: 'DEF', adjustedWeeklyPoints: 7, projectedPoints: 7, sourceCoverage: {} };
  const free = { playerId: 'gb', name: 'Packers', position: 'DEF', available: true, availabilityStatus: 'freeagents', adjustedWeeklyPoints: 10, projectedPoints: 10, sourceCoverage: {} };
  const waiver = { ...free, playerId: 'other', name: 'Other', availabilityStatus: 'waivers' };
  const result = waiverRecommendation({ league, roster: [current], availablePlayers: [waiver, free] });
  assert.equal(result.action, 'ADD_DROP'); assert.equal(result.add.name, 'Packers'); assert.equal(result.drop.name, 'Vikings');
  assert.equal(result.expectedPointsGained, 3); assert.equal(result.acquisition, 'FREE_AGENT'); assert.equal(result.faab.recommended, 0);
  const missing = waiverRecommendation({ league, roster: [{ ...current, adjustedWeeklyPoints: null, projectedPoints: null }], availablePlayers: [free] });
  assert.equal(missing.action, 'INSUFFICIENT_DATA');
});

test('live weekly source fields reconcile identity, scoring, schedule, and kicker uncertainty', async () => {
  const date = new Date('2026-09-16T23:00:00Z');
  const service = new WeeklyEvidenceService({ now: () => date });
  const tank = tankPlayers({ playerProjections: { 1: { longName: 'Josh Allen', pos: 'QB', team: 'BUF', Passing: { passYds: 200, passTD: 2, int: 1 } }, 2: { longName: 'Jason Myers', pos: 'PK', team: 'SEA', Kicking: { fgMade: 2, xpMade: 2 } } } });
  const fp = fantasyProsPlayers({ players: [{ name: 'Josh Allen', position_id: 'QB', team_id: 'BUF', stats: { pass_yds: 200, pass_tds: 2, pass_ints: 1 } }] });
  service.load = async () => ({ sources: [{ source: 'tank01', observedAt: date.toISOString(), players: tank }, { source: 'fantasyPros', observedAt: date.toISOString(), players: fp }], schedules: [{ home: 'BUF', away: 'DET', kickoff: date.getTime() + 86400000, status: '0' }], warnings: [] });
  const result = await service.enrich({ season: 2026, week: 2, roster: [{ name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' }, { name: 'Jason Myers', position: 'K', nflTeam: 'SEA' }], availablePlayers: [] }, league);
  assert.equal(result.roster[0].projectedPoints, 20); // league uses 20 pass yards/point and 6-point passing TDs
  assert.equal(result.roster[0].weeklyContext.opponent, 'DET');
  assert.equal(result.roster[0].gameStarted, false);
  assert.equal(result.roster[1].projectedPoints, 8);
  assert.equal(result.roster[1].projectionUpperPoints, 12);
  assert.match(result.roster[1].projectionLimitations[0], /distance/);
});

test('weekly feeds reject wrong seasons and disclose capped FantasyPros coverage', async () => {
  const service = new WeeklyEvidenceService({ fantasyProsClient: { configured: true, request: async () => ({ payload: { season: '2026', week: '2', public_api_limited: true, players: [] } }) } });
  service.tankRequest = async endpoint => endpoint === 'getNFLProjections' ? { body: { season: 2025, week: 2 }, observedAt: new Date().toISOString() } : { body: [] };
  const loaded = await service.loadSources(2026, 2);
  assert.ok(loaded.warnings.some(value => /period did not match/.test(value)));
  assert.equal(loaded.warnings.filter(value => /limited player set/.test(value)).length, 6);
  assert.ok(!loaded.sources.some(value => value.source === 'tank01'));
});
