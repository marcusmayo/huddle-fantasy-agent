'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FantasyProsRefreshController } = require('../src/services/fantasypros-refresh');

test('automatic FantasyPros refresh is rate-aware and never schedules faster than six hours', async () => {
  let scheduledMs;
  let syncs = 0;
  const controller = new FantasyProsRefreshController({
    enabled: true,
    configured: true,
    intervalMs: 1000,
    sync: async () => { syncs += 1; return { players: 100 }; },
    quotaStatus: () => ({ budget: 24, estimatedUsed: syncs * 12, estimatedRemaining: 24 - syncs * 12, fullSyncCost: 12 }),
    setIntervalImpl: (_callback, milliseconds) => {
      scheduledMs = milliseconds;
      return { unref() {} };
    },
    clearIntervalImpl: () => {}
  });
  controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduledMs, 6 * 60 * 60 * 1000);
  assert.equal(syncs, 1);
  assert.equal(controller.status().lastSuccessAt !== null, true);
  controller.stop();
});

test('disabled auto-refresh does not call the provider', async () => {
  let syncs = 0;
  const controller = new FantasyProsRefreshController({
    enabled: true,
    configured: false,
    intervalMs: 24 * 60 * 60 * 1000,
    sync: async () => { syncs += 1; },
    quotaStatus: () => ({ budget: 24, estimatedUsed: 0, estimatedRemaining: 24, fullSyncCost: 12 })
  });
  controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(syncs, 0);
});
