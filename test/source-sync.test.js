'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { syncFantasyPros } = require('../src/server');

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
      loadDraftEvidence: async () => ({ lookbackHours: 24, attribution: 'Sleeper', players: [{ name: 'Player One', position: 'RB', direction: 'rising', adds: 5, drops: 0, net: 5 }] })
    }
  });
  assert.equal(result.source, 'fantasypros+tank01+sleeper');
  assert.equal(value.playerPool.players[0].id, 'fantasypros:1');
  assert.equal(value.playerPool.players[0].sourceConsensus, 0.675);
  assert.equal(value.playerPool.players[0].sleeperTrend.direction, 'rising');
});

test('optional source failure degrades to primary evidence instead of blocking the draft', async () => {
  const value = runtime();
  const result = await syncFantasyPros(value, { loadDraftPool: async () => primaryPool() }, {}, {
    tank01Client: { configured: true, loadDraftEvidence: async () => { throw new Error('temporary Tank01 failure'); } },
    sleeperClient: { enabled: false }
  });
  assert.equal(result.source, 'fantasypros');
  assert.deepEqual(result.sourceEvidence.effectiveWeights, { fantasyPros: 1, tank01: 0 });
  assert.equal(result.sourceEvidence.errors[0].provider, 'tank01');
});
