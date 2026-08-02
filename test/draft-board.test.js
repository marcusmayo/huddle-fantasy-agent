'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const league = require('../config/leagues/yahoo-example.json');
const pool = require('../config/fixtures/demo-players.json');
const { availabilityAtPick, buildRecommendationCard, scoreAvailablePlayers } = require('../src/domain/draft-board');

test('drafted players are excluded from every recommendation', () => {
  const picks = [{ playerId: 'demo-rb-1', isMine: false }];
  const card = buildRecommendationCard({ players: pool.players, picks, league, draftSlot: 3 });
  assert.ok(card.board.length > 0);
  assert.equal(card.board.some((item) => item.player.id === 'demo-rb-1'), false);
  assert.notEqual(card.preferred.player.id, 'demo-rb-1');
  assert.notEqual(card.alternatives.safe.player.id, 'demo-rb-1');
  assert.notEqual(card.alternatives.upside.player.id, 'demo-rb-1');
});

test('recommendation output is deterministic for the same state', () => {
  const input = { players: pool.players, picks: [], league, draftSlot: 3 };
  const first = scoreAvailablePlayers({ ...input, style: 'balanced' });
  const second = scoreAvailablePlayers({ ...input, style: 'balanced' });
  assert.deepEqual(first, second);
});

test('early kicker and defense selections receive a phase penalty', () => {
  const board = scoreAvailablePlayers({ players: pool.players, picks: [], league, draftSlot: 3, style: 'balanced' });
  const skillBest = board.find((item) => ['QB', 'RB', 'WR', 'TE'].includes(item.player.position));
  const specialBest = board.find((item) => ['K', 'DEF'].includes(item.player.position));
  assert.ok(skillBest.score > specialBest.score);
});

test('next-turn availability rises when ADP is after the next pick', () => {
  assert.ok(availabilityAtPick(40, 10) > 0.95);
  assert.ok(availabilityAtPick(5, 20) < 0.1);
});

test('card identifies when the target team is on the clock', () => {
  const card = buildRecommendationCard({ players: pool.players, picks: [{ playerId: 'demo-rb-1', isMine: false }, { playerId: 'demo-wr-1', isMine: false }], league, draftSlot: 3 });
  assert.equal(card.currentOverall, 3);
  assert.equal(card.onClock, true);
  assert.equal(card.nextUserPick, 10);
});
