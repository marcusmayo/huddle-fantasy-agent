'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requestJSON } = require('../public/request');

test('a hung response or JSON body releases the request deadline and a later read succeeds', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    await assert.rejects(requestJSON('/board', { timeoutMs: 15 }, fetchImpl), { code: 'REQUEST_TIMEOUT' });
  }
  assert.deepEqual(await requestJSON('/board', {}, async () => ({ ok: true, json: async () => ({ picks: 120 }) })), { picks: 120 });
});

test('timed-out mutations are never retried and tell the operator to verify the result', async () => {
  let requests = 0;
  await assert.rejects(requestJSON('/picks', { method: 'POST', timeoutMs: 15 }, () => { requests++; return new Promise(() => {}); }), /Check the saved result before retrying/);
  assert.equal(requests, 1);
});

test('abort cancels a pending read and service errors retain their identity', async () => {
  const controller = new AbortController();
  const task = requestJSON('/board', { signal: controller.signal }, () => new Promise(() => {}));
  controller.abort();
  await assert.rejects(task, { code: 'REQUEST_ABORTED' });
  await assert.rejects(requestJSON('/board', {}, async () => ({ ok: false, status: 503, json: async () => ({ code: 'OFFLINE', message: 'Server offline' }) })), { code: 'OFFLINE', status: 503 });
});
