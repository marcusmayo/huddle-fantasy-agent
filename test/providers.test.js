'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTruncated, normalizeRankedPlayer, stripPlayerImageFields } = require('../src/providers/fantasypros');
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
