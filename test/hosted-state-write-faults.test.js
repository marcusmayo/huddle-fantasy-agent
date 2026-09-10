'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStateStore } = require('../src/storage/json-state-store');

for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync']) {
  test(`failed ${operation} preserves the previously committed draft`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-write-fault-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new JsonStateStore(path.join(dir, 'state.json'));
    const committed = { sessions: { exact: { picks: [{ overallPick: 1, playerId: 'p1' }] } } };
    store.save(committed);
    const original = fs[operation];
    fs[operation] = () => { throw new Error('injected storage fault'); };
    try {
      assert.throws(() => store.save({ sessions: {} }), /injected storage fault/);
    } finally {
      fs[operation] = original;
    }
    assert.deepEqual(store.load(), committed);
    assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  });
}

test('malformed committed state is rejected rather than silently replaced', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-corrupt-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new JsonStateStore(file).load(), SyntaxError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
