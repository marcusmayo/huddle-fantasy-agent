'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SleeperClient, normalizeSleeperPlayerCrosswalk, normalizeSleeperTrends } = require('../src/providers/sleeper');
const { Tank01Client, normalizeTank01Players, positionFromPosAdp, scoringToAdpType } = require('../src/providers/tank01');
const { SOURCE_WEIGHTS, ensureDraftProjections, evidenceIndex, matchEvidence, reconcilePlayerEvidence } = require('../src/services/player-evidence');

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
  assert.equal(first.identityPlayers[0].yahooId, '99');
  assert.equal(second.cacheHit, true);
  assert.equal(requests.length, 3);
});

test('Sleeper player map supplies active Yahoo identity crosswalks independently of trends', () => {
  const rows = normalizeSleeperPlayerCrosswalk({
    s1: { full_name: 'Mapped Player', position: 'RB', yahoo_id: 101 },
    s2: { full_name: 'No Yahoo Player', position: 'WR' },
    s3: { full_name: 'Unsupported Player', position: 'P', yahoo_id: 303 },
    s4: { full_name: 'Inactive Player', position: 'RB', yahoo_id: 404, active: false }
  });
  assert.deepEqual(rows, [{ sleeperId: 's1', yahooId: '101', fantasyDataId: null, name: 'Mapped Player', position: 'RB', team: 'FA' }]);
});

test('numeric Yahoo identities are equivalent to season-qualified Yahoo player keys', () => {
  const numeric = evidenceIndex([{ name: 'Mapped Player', position: 'RB', yahooPlayerKey: '40059' }]);
  assert.equal(matchEvidence({ name: 'Different Label', position: 'RB', yahooPlayerKey: '461.p.40059' }, numeric)?.name, 'Mapped Player');
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

test('ranked players without a projection receive a disclosed deterministic estimate', () => {
  const completed = ensureDraftProjections([
    { id: 'rb-1', name: 'Projected Back', position: 'RB', expertRank: 1, projectedPoints: 250, floor: 210, ceiling: 290 },
    { id: 'rb-2', name: 'Ranked Back', position: 'RB', expertRank: 12, projectedPoints: null }
  ]);
  assert.equal(completed.players[0].projectionImputed, false);
  assert.equal(completed.players[1].projectionImputed, true);
  assert.equal(completed.players[1].projectionSource, 'rank-interpolation');
  assert.equal(completed.players[1].projectedPoints > 0, true);
  assert.deepEqual(completed.coverage, { provided: 1, imputed: 1, total: 2, providedRatio: 0.5 });
});

test('Tank01 and Sleeper extend a limited primary pool with Yahoo-mapped late-round players', () => {
  const pool = reconcilePlayerEvidence({
    source: 'fantasypros-api',
    players: [{ id: 'fp:1', name: 'Primary Runner', position: 'RB', expertRank: 1, projectedPoints: 250 }]
  }, {
    tank01: { players: [
      { tank01Id: 't1', name: 'Primary Runner', position: 'RB', rank: 1, projectedPoints: 250 },
      { tank01Id: 't2', name: 'Late Receiver', position: 'WR', rank: 130, projectedPoints: null }
    ] },
    sleeper: {
      players: [],
      identityPlayers: [{ yahooId: '9002', name: 'Late Receiver', position: 'WR', team: 'TST' }]
    }
  });

  assert.equal(pool.players.length, 2);
  assert.equal(pool.players[1].id, 'tank01:t2');
  assert.equal(pool.players[1].yahooPlayerKey, '9002');
  assert.equal(pool.players[1].evidenceRole, 'secondary-fallback');
  assert.equal(pool.players[1].projectionImputed, true);
  assert.equal(pool.sourceEvidence.coverage.secondaryFallbackPlayers, 1);
});

test('Sleeper identity depth completes a two-defense league pool without adding unranked skill players', () => {
  const teams = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];
  const primaryDefenses = teams.slice(0, 10).map((team, index) => ({
    id: `fantasypros:def-${team.toLowerCase()}`,
    yahooPlayerKey: String(50_000 + index),
    name: `${team} Defense`,
    position: 'DEF',
    team,
    expertRank: index + 1,
    projectedPoints: null
  }));
  const identityPlayers = teams.map((team, index) => ({
    sleeperId: team.toLowerCase(),
    yahooId: String(50_000 + index),
    name: `${team} Defense`,
    position: 'DEF',
    team
  }));
  identityPlayers.push({ sleeperId: 'unranked-rb', yahooId: '60000', name: 'Unranked Runner', position: 'RB', team: 'BUF' });

  const pool = reconcilePlayerEvidence({
    source: 'fantasypros-api',
    complete: false,
    players: primaryDefenses
  }, {
    sleeper: { players: [], identityPlayers }
  });

  const defenses = pool.players.filter((player) => player.position === 'DEF');
  assert.equal(defenses.length, 32);
  assert.equal(pool.players.some((player) => player.name === 'Unranked Runner'), false);
  assert.equal(defenses.every((player) => /^\d+$/.test(player.yahooPlayerKey)), true);
  assert.equal(defenses.every((player) => player.projectedPoints > 0), true);
  assert.equal(defenses.filter((player) => player.evidenceRole === 'sleeper-identity-depth-fallback').length, 22);
  assert.equal(pool.sourceEvidence.coverage.sleeperDefenseDepthPlayers, 22);
  assert.equal(pool.source, 'fantasypros+sleeper');
});

test('ambiguous secondary identities are excluded instead of resolving by input order', () => {
  const primary = {
    source: 'fantasypros-api',
    players: [
      { id: 'fp:1', name: 'Same Player', position: 'RB', expertRank: 1 },
      { id: 'fp:2', name: 'Other Player', position: 'RB', expertRank: 2 }
    ]
  };
  const first = reconcilePlayerEvidence(primary, {
    tank01: { players: [
      { name: 'Same Player', position: 'RB', rank: 1 },
      { name: 'Same Player', position: 'RB', rank: 99 }
    ] }
  });
  const second = reconcilePlayerEvidence(primary, {
    tank01: { players: [
      { name: 'Same Player', position: 'RB', rank: 99 },
      { name: 'Same Player', position: 'RB', rank: 1 }
    ] }
  });

  assert.equal(first.players[0].sourceRanks.tank01, null);
  assert.equal(second.players[0].sourceRanks.tank01, null);
  assert.equal(first.players[0].sourceConsensus, second.players[0].sourceConsensus);
  assert.equal(first.sourceEvidence.coverage.tank01Matched, 0);
  assert.equal(first.sourceEvidence.coverage.ambiguousTank01, 1);
  assert.equal(first.sourceEvidence.warnings[0].code, 'AMBIGUOUS_PLAYER_EVIDENCE');
  assert.deepEqual(first.sourceEvidence.warnings[0].ambiguousIdentities, ['sameplayer|RB']);
});

test('duplicate Yahoo IDs quarantine every contradictory secondary row', () => {
  const pool = reconcilePlayerEvidence({
    source: 'fantasypros-api',
    players: [
      { id: 'fp:1', yahooId: '42', name: 'First Identity', position: 'RB', expertRank: 1 },
      { id: 'fp:2', name: 'Second Identity', position: 'WR', expertRank: 1 }
    ]
  }, {
    tank01: { players: [
      { yahooId: '42', name: 'First Identity', position: 'RB', rank: 1 },
      { yahooId: '42', name: 'Second Identity', position: 'WR', rank: 1 }
    ] }
  });

  assert.equal(pool.sourceEvidence.coverage.tank01Matched, 0);
  assert.deepEqual(pool.sourceEvidence.warnings[0].ambiguousYahooIds, ['42']);
  assert.equal(pool.players[0].sourceRanks.tank01, null);
  assert.equal(pool.players[1].sourceRanks.tank01, null);
});
