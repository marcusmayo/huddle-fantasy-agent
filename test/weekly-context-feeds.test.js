'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WeeklyContextFeeds, defenseRatings, normalizeNews, newsForPlayer, parseCsv } = require('../src/services/weekly-context-feeds');
const { applyWeeklyContext } = require('../src/domain/weekly-context');
const league = { scoring: { fractionalPoints: false, offense: { passingYardsPerPoint: 20, passingTouchdown: 6, interception: -2, reception: 1, rushingYardsPerPoint: 10, receivingYardsPerPoint: 10, fumbleLost: -2 } } };
const now = new Date('2026-09-16T23:00:00Z');
const row = (season, week, opponent, position, stats = {}) => ({ season, week, opponent_team: opponent, position, season_type: 'REG', game_id: `${season}_${week}_${opponent}`, player_id: position, ...stats });

test('positional ratings score individual players, count zero positions, ignore future/postseason, blend prior and rank easiest first', () => {
  const rows = [row(2025, 1, 'BUF', 'QB', { passing_yards: 200 }), row(2025, 1, 'DET', 'QB', { passing_yards: 400 }),
    row(2026, 1, 'BUF', 'QB', { passing_yards: 400 }), row(2026, 1, 'DET', 'QB', { passing_yards: 200 }),
    row(2026, 1, 'BUF', 'WR', { receptions: 3, receiving_yards: 29 }),
    { ...row(2026, 1, 'BUF', 'WR', { receptions: 1, receiving_yards: 19 }), player_id: 'WR2' },
    row(2026, 2, 'BUF', 'QB', { passing_yards: 9000 }), { ...row(2025, 19, 'BUF', 'QB'), season_type: 'POST' }];
  rows.push(rows[0]);
  const result = defenseRatings(rows, { season: 2026, week: 2, league, observedAt: now.toISOString() });
  const qb = result.find(r => r.opponent === 'BUF' && r.position === 'QB');
  assert.equal(qb.currentGames, 1); assert.equal(qb.priorGames, 1); assert.equal(qb.pointsAllowedPerGame, 20);
  assert.equal(qb.rank, 1); assert.equal(qb.confidence, 'low'); assert.ok(qb.pointsAllowedRatio > 1 && qb.pointsAllowedRatio < 20 / 15);
  assert.equal(result.find(r => r.opponent === 'BUF' && r.position === 'WR').pointsAllowedPerGame, 7);
  assert.equal(result.find(r => r.opponent === 'DET' && r.position === 'WR').pointsAllowedPerGame, 0);
  assert.equal(result.find(r => r.opponent === 'BUF' && r.position === 'TE').pointsAllowedPerGame, 0);
});

test('news retains undated status, rejects stale/future/unsafe articles, exact unique identity and duplicate links', () => {
  const article = { title: 'Nico Collins: Limited at practice', link: 'https://example.com/news' };
  const result = normalizeNews([article, article, { ...article, link: 'javascript:alert(1)' },
    { ...article, link: 'https://example.com/stale', publishedAt: '2025-09-16' },
    { ...article, link: 'https://example.com/future', publishedAt: '2027-09-16' }], now.toISOString(), now);
  assert.equal(result.length, 1); assert.equal(result[0].publishedAt, null);
  const player = { name: 'Nico Collins' };
  assert.equal(newsForPlayer(player, result, [player]).length, 1);
  assert.equal(newsForPlayer(player, result, [player, player]).length, 0);
  assert.equal(newsForPlayer({ name: 'Collins' }, result, [{ name: 'Collins' }]).length, 0);
});

test('undated news expires after six hours, and defense evidence does not double-adjust projections', () => {
  const player = { position: 'WR', projectedPoints: 10, weeklyContext: { season: 2026, week: 2, source: 'test', observedAt: now.toISOString(), opponent: 'BUF',
    projection: { source: 'tank01', points: 10, updatedAt: now.toISOString(), includes: ['matchup'], contextNeutral: false },
    defense: { opponent: 'BUF', position: 'WR', pointsAllowedRatio: 2 },
    news: [{ source: 'Tank01', summary: 'News', publishedAt: null, observedAt: now.toISOString() }] } };
  const apply = date => applyWeeklyContext(player, { season: 2026, week: 2, now: date, leagueReceptionPoints: 1 });
  assert.equal(apply(now).adjustedWeeklyPoints, 10); assert.equal(apply(now).weeklyEvidence.news.length, 1);
  assert.equal(apply(new Date(now.getTime() + 7 * 3600000)).weeklyEvidence.news.length, 0);
});

test('CSV parser supports quoted commas/newlines and fails on missing statistics schema', () => {
  const csv = 'season,week,season_type,game_id,opponent_team,position,passing_yards,rushing_yards,receiving_yards,player_name\n2026,1,REG,g,BUF,QB,100,0,0,"Player,\nJr"\n';
  assert.equal(parseCsv(csv)[0].player_name, 'Player,\nJr');
  assert.throws(() => parseCsv('season,week\n2026,1'), /missing/);
});

test('shared caching avoids repeat calls, enforces news quota, and provider failures do not block the other feed', async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-context-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  let reserved = 0, requested = 0;
  const tank = { configured: true, baseUrl: 'https://example.com', reserveRequest() { reserved++; }, async fetch() { return { ok: true, json: async () => ({ statusCode: 200, body: [{ title: 'Player: Update', link: 'https://example.com/story' }] }) }; } };
  const feed = new WeeklyContextFeeds({ tank01Client: tank, cacheDir, now: () => now, fetchImpl: async url => {
    requested++; const year = /_(\d+)\.csv/.exec(url)[1];
    return { ok: true, text: async () => `season,week,season_type,game_id,opponent_team,position,passing_yards,rushing_yards,receiving_yards,player_id\n${year},1,REG,g,BUF,QB,200,0,0,p\n` };
  } });
  const inputs = { season: 2026, week: 2, league };
  const [a, b] = await Promise.all([feed.load(inputs), feed.load(inputs)]);
  assert.equal(reserved, 1); assert.equal(requested, 2); assert.equal(a.news.length, 1); assert.equal(b.ratings.length, 4);
  const failed = new WeeklyContextFeeds({ cacheDir: path.join(cacheDir, 'failed'), now: () => now, tank01Client: { ...tank, reserveRequest() { throw new Error('budget exhausted'); } }, fetchImpl: feed.fetch });
  const c = await failed.load(inputs); assert.equal(c.news.length, 0); assert.equal(c.ratings.length, 4); assert.match(c.warnings[0], /budget/);
});
