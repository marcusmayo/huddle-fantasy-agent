'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SleeperClient, normalizeSleeperTrends } = require('../src/providers/sleeper');
const { Tank01Client, normalizeTank01Players, positionFromPosAdp, scoringToAdpType } = require('../src/providers/tank01');
const { SOURCE_WEIGHTS, reconcilePlayerEvidence } = require('../src/services/player-evidence');

test('Tank01 normalizes draft rows and caches one ADP request', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-tank01-'));
  const requests = [];
  const client = new Tank01Client({
    apiKey: 'test-key',
    cacheDir,
    monthlyRequestBudget: 40,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({ body: [{ playerID: '1', longName: 'Draft Player', pos: 'RB', team: 'TST', overallADP: 8, fantasyPoints: 275 }] })
      };
    }
  });
  const first = await client.loadDraftEvidence({ scoring: 'HALF' });
  const second = await client.loadDraftEvidence({ scoring: 'HALF' });
  assert.equal(scoringToAdpType('HALF'), 'halfPPR');
  assert.equal(first.players[0].rank, 8);
  assert.equal(first.players[0].projectedPoints, 275);
  assert.equal(second.cacheHit, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /getNFLADP\?adpType=halfPPR/);
  assert.equal(requests[0].options.headers['x-rapidapi-key'], 'test-key');
  assert.equal(client.quotaStatus().estimatedUsed, 1);
});

test('Tank01 accepts map-shaped response bodies', () => {
  const players = normalizeTank01Players({ body: { one: { playerID: '1', longName: 'Defense Test', pos: 'DST', overallRank: 3 } } });
  assert.equal(players[0].position, 'DEF');
  assert.equal(players[0].rank, 3);
});

test('Tank01 accepts the live ADP response shape and derives position from posADP', () => {
  const players = normalizeTank01Players({
    statusCode: 200,
    body: {
      adpDate: '20260803',
      adpType: 'PPR',
      adpList: [
        { posADP: 'RB1', overallADP: '1.5', playerID: '101', longName: 'Draft Runner' },
        { posADP: 'DST 2', overallADP: 145, playerID: '102', longName: 'Draft Defense' }
      ]
    }
  });

  assert.equal(players.length, 2);
  assert.deepEqual(players[0], {
    tank01Id: '101',
    name: 'Draft Runner',
    position: 'RB',
    team: 'FA',
    rank: 1.5,
    projectedPoints: null
  });
  assert.equal(players[1].position, 'DEF');
  assert.equal(positionFromPosAdp('WR12'), 'WR');
});

test('Sleeper maps add/drop activity and caches its large player map', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-sleeper-'));
  const requests = [];
  const client = new SleeperClient({
    cacheDir,
    fetchImpl: async (url) => {
      requests.push(String(url));
      const payload = String(url).includes('/players/nfl/trending/add')
        ? [{ player_id: 's1', count: 20 }]
        : String(url).includes('/players/nfl/trending/drop')
          ? [{ player_id: 's1', count: 3 }]
          : { s1: { full_name: 'Draft Player', position: 'RB', team: 'TST', yahoo_id: 99 } };
      return { ok: true, json: async () => payload };
    }
  });
  const first = await client.loadDraftEvidence();
  const second = await client.loadDraftEvidence();
  assert.equal(first.players[0].direction, 'rising');
  assert.equal(first.players[0].net, 17);
  assert.equal(second.cacheHit, true);
  assert.equal(requests.length, 3);
});

test('Sleeper neutral trends remain a non-ranking signal', () => {
  const trends = normalizeSleeperTrends({
    playerMap: { s1: { full_name: 'Even Player', position: 'WR' } },
    adds: [{ player_id: 's1', count: 4 }],
    drops: [{ player_id: 's1', count: 4 }]
  });
  assert.equal(trends[0].direction, 'neutral');
});

test('source reconciliation applies the configured 67.5/32.5 blend and Sleeper badge data', () => {
  const primary = {
    source: 'fantasypros-api',
    players: [
      { id: 'fp:1', name: 'Player One', position: 'RB', team: 'A', expertRank: 1 },
      { id: 'fp:2', name: 'Player Two', position: 'RB', team: 'B', expertRank: 2 }
    ]
  };
  const tank01 = {
    fetchedAt: '2026-08-02T00:00:00.000Z',
    players: [
      { name: 'Player One', position: 'RB', team: 'A', rank: 2 },
      { name: 'Player Two', position: 'RB', team: 'B', rank: 1 }
    ]
  };
  const sleeper = {
    lookbackHours: 24,
    attribution: 'Sleeper',
    players: [{ name: 'Player One', position: 'RB', team: 'A', direction: 'rising', adds: 10, drops: 1, net: 9 }]
  };
  const pool = reconcilePlayerEvidence(primary, { tank01, sleeper });
  assert.deepEqual(SOURCE_WEIGHTS, { fantasyPros: 0.675, tank01: 0.325 });
  assert.equal(pool.players[0].sourceConsensus, 0.675);
  assert.equal(pool.players[1].sourceConsensus, 0.325);
  assert.equal(pool.players[0].sleeperTrend.direction, 'rising');
  assert.equal(pool.sourceEvidence.coverage.tank01Matched, 2);
  assert.equal(pool.sourceEvidence.coverage.sleeperMatched, 1);
});
