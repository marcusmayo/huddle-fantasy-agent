'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { isTruncated, normalizeRankedPlayer, stripPlayerImageFields } = require('../src/providers/fantasypros');
const { FantasyProsClient } = require('../src/providers/fantasypros');
const { sanitizePlayerPool } = require('../src/media/player-headshots');
const { YahooReadOnlyClient, extractDraftResults } = require('../src/providers/yahoo');

test('FantasyPros truncated responses are surfaced', () => {
  assert.equal(isTruncated({ meta: { truncated: true } }), true);
  assert.equal(isTruncated({ players: [] }, { 'x-response-truncated': 'true' }), true);
  assert.equal(isTruncated({ players: [] }), false);
});

test('FantasyPros player identity and Yahoo cross-reference normalize', () => {
  const player = normalizeRankedPlayer({
    player_id: 42,
    player_name: 'Test Player',
    player_team_id: 'TST',
    rank_ecr: 8,
    rank_adp: 21,
    yahoo_player_key: '461.p.42',
    player_image_url: 'https://images.example/fantasypros-player.png'
  }, 'RB');
  assert.equal(player.id, 'fantasypros:42');
  assert.equal(player.yahooPlayerKey, '461.p.42');
  assert.equal(player.position, 'RB');
  assert.equal(player.player_image_url, undefined);
  assert.equal(player.media, undefined);
});

test('FantasyPros payload cache strips image fields recursively', () => {
  assert.deepEqual(stripPlayerImageFields({
    players: [{ id: 1, player_image_url: 'https://images.example/1.png', nested: { headshot: { url: 'https://images.example/2.png' } } }],
    meta: { page: 1 }
  }), { players: [{ id: 1, nested: {} }], meta: { page: 1 } });
});

test('FantasyPros documented NFL projection shape produces a complete player pool', async () => {
  const requested = [];
  const client = new FantasyProsClient({
    apiKey: 'test-key',
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-fantasypros-')),
    dailyRequestBudget: 24,
    fetchImpl: async (value) => {
      const url = new URL(value);
      requested.push(url);
      const position = url.searchParams.get('position');
      const id = `${position.toLowerCase()}-1`;
      const payload = url.pathname.endsWith('/projections')
        ? { players: [{ fpid: id, name: `${position} Test`, position_id: position, team_id: 'TST', stats: [{ points: 100, points_half: 110, points_ppr: 120 }] }] }
        : { players: [{ player_id: id, player_name: `${position} Test`, player_position_id: position, player_team_id: 'TST', rank_ecr: 1, rank_adp: 2 }] };
      return { ok: true, json: async () => payload, headers: new Headers() };
    }
  });

  const pool = await client.loadDraftPool({ season: 2026, scoring: 'PPR', force: true });
  assert.equal(pool.players.length, 6);
  assert.equal(pool.players.every((player) => player.projectedPoints === 120), true);
  assert.equal(pool.players.find((player) => player.position === 'DEF').name, 'DST Test');
  const projectionRequests = requested.filter((url) => url.pathname.endsWith('/projections'));
  assert.equal(projectionRequests.length, 6);
  assert.equal(projectionRequests.every((url) => url.searchParams.get('week') === '0'), true);
  assert.equal(projectionRequests.every((url) => !url.searchParams.has('scoring')), true);
  assert.deepEqual(client.quotaStatus(), {
    budget: 24,
    estimatedUsed: 12,
    estimatedRemaining: 12,
    fullSyncCost: 12,
    resetsOn: new Date().toISOString().slice(0, 10),
    scope: 'local-estimate'
  });
});

test('FantasyPros refresh fails before network calls when the local daily budget is exhausted', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-fantasypros-budget-'));
  let requests = 0;
  const client = new FantasyProsClient({
    apiKey: 'test-key',
    cacheDir,
    dailyRequestBudget: 12,
    fetchImpl: async (value) => {
      requests += 1;
      const url = new URL(value);
      const position = url.searchParams.get('position');
      const payload = url.pathname.endsWith('/projections')
        ? { players: [{ fpid: `${position}-1`, name: `${position} Test`, position_id: position, stats: [{ points: 100 }] }] }
        : { players: [{ player_id: `${position}-1`, player_name: `${position} Test`, player_position_id: position, rank_ecr: 1 }] };
      return { ok: true, json: async () => payload, headers: new Headers() };
    }
  });
  await client.loadDraftPool({ season: 2026, scoring: 'STD', force: true });
  assert.equal(requests, 12);
  await assert.rejects(() => client.loadDraftPool({ season: 2026, scoring: 'STD', force: true }), /daily budget/);
  assert.equal(requests, 12);
});

test('player headshots are disabled by default and require an explicit licensed host', () => {
  const base = { source: 'yahoo-api', players: [{ id: '1', name: 'Test Player', headshot: { url: 'https://licensed.example/player.png' }, imageProvider: 'licensed-test' }] };
  assert.equal(sanitizePlayerPool(base).players[0].media, undefined);
  const allowed = sanitizePlayerPool(base, { enabled: true, allowedHosts: ['licensed.example'] }).players[0];
  assert.equal(allowed.media.headshotUrl, 'https://licensed.example/player.png');
  assert.equal(allowed.media.licenseVerified, true);
  const blocked = sanitizePlayerPool({ ...base, source: 'fantasypros-api' }, { enabled: true, allowedHosts: ['licensed.example'] }).players[0];
  assert.equal(blocked.media, undefined);
  const lookalike = sanitizePlayerPool({ source: 'yahoo-api', players: [{ ...base.players[0], headshot: { url: 'https://licensed.example.attacker.test/player.png' } }] }, { enabled: true, allowedHosts: ['licensed.example'] }).players[0];
  assert.equal(lookalike.media, undefined);
});

test('Yahoo draft results extract from nested API JSON', () => {
  const payload = { fantasy_content: { league: [{ draft_results: [{ draft_result: { pick: '2', round: '1', team_key: '461.l.1.t.2', player_key: '461.p.22' } }, { draft_result: { pick: '1', round: '1', team_key: '461.l.1.t.1', player_key: '461.p.11' } }] }] } };
  assert.deepEqual(extractDraftResults(payload), [
    { overallPick: 1, round: 1, teamKey: '461.l.1.t.1', yahooPlayerKey: '461.p.11' },
    { overallPick: 2, round: 1, teamKey: '461.l.1.t.2', yahooPlayerKey: '461.p.22' }
  ]);
});

test('Yahoo provider exposes GET-only league methods', () => {
  const client = new YahooReadOnlyClient({ accessToken: 'not-a-real-token', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(typeof client.leagueSettings, 'function');
  assert.equal(typeof client.draftResults, 'function');
  assert.equal(client.addPlayer, undefined);
  assert.equal(client.submitDraftPick, undefined);
});
