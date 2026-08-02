'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const league = require('../config/leagues/yahoo-example.json');
const playerPool = require('../config/fixtures/demo-players.json');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');

function service() {
  return new DraftService({ league, playerPool, store: new MemoryStateStore() });
}

test('pick event application is idempotent', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 3 });
  const input = { eventId: 'yahoo:1', playerId: 'demo-rb-1', isMine: false };
  assert.equal(drafts.recordPick(session.id, input).applied, true);
  const duplicate = drafts.recordPick(session.id, input);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, 'duplicate-event');
  assert.equal(duplicate.session.picks.length, 1);
});

test('same player cannot be drafted twice under different events', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 3 });
  drafts.recordPick(session.id, { eventId: 'one', playerId: 'demo-rb-1' });
  const duplicate = drafts.recordPick(session.id, { eventId: 'two', playerId: 'demo-rb-1' });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, 'player-already-drafted');
});

test('recommendation discloses data coverage and read-only execution', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 2 });
  const card = drafts.recommendation(session.id);
  assert.equal(card.evidence.complete, true);
  assert.equal(card.execution, 'recommendation-only');
});

test('invalid draft slot fails closed', () => {
  assert.throws(() => service().createSession({ draftSlot: 7 }), /between 1 and 6/);
});
