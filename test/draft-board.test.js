'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const league = require('../config/leagues/yahoo-example.json');
const pool = require('../config/fixtures/demo-players.json');
const {
  assessRosterConstraint,
  availabilityAtPick,
  buildRecommendationCard,
  defaultPositionMaximums,
  scoreAvailablePlayers
} = require('../src/domain/draft-board');

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

test('card returns the full ranked pool for client-side position filtering', () => {
  const card = buildRecommendationCard({ players: pool.players, picks: [], league, draftSlot: 3 });
  assert.equal(card.board.length, pool.players.length);
  assert.equal(card.board.some((item) => item.player.position === 'K'), true);
  assert.equal(card.board.some((item) => item.player.position === 'DEF'), true);
});

test('Sleeper trend is limited to a small ranking tie-break', () => {
  const players = [
    { id: 'a', name: 'Rising Player', position: 'WR', team: 'A', projectedPoints: 250, floor: 210, ceiling: 290, expertRank: 10, adp: 10, risk: 0.1, sourceConsensus: 0.5, sleeperTrend: { direction: 'rising' } },
    { id: 'b', name: 'Falling Player', position: 'WR', team: 'B', projectedPoints: 250, floor: 210, ceiling: 290, expertRank: 10, adp: 10, risk: 0.1, sourceConsensus: 0.5, sleeperTrend: { direction: 'falling' } }
  ];
  const board = scoreAvailablePlayers({ players, picks: [], league, draftSlot: 3, style: 'balanced' });
  assert.equal(board[0].player.id, 'a');
  assert.equal(board[0].trendAdjustment, 1);
  assert.equal(board[1].trendAdjustment, -1);
});

test('recommendations stop adding scarce positions after the completion-safe maximum', () => {
  const smallLeague = {
    ...structuredClone(league),
    teamCount: 4,
    roster: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, BN: 2 }
  };
  const maximums = defaultPositionMaximums(smallLeague);
  assert.equal(maximums.QB, 2);
  assert.equal(maximums.K, 1);
  assert.equal(maximums.DEF, 1);
  const result = assessRosterConstraint({ position: 'QB' }, { QB: 2 }, smallLeague);
  assert.equal(result.feasible, false);
  assert.match(result.reasons.join(' '), /QB roster maximum/);
});

test('final recommendations reserve enough picks to complete every required starter slot', () => {
  const smallLeague = {
    ...structuredClone(league),
    teamCount: 4,
    roster: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, BN: 2 }
  };
  const mine = { QB: 1, RB: 2, WR: 2, TE: 1 };
  const skillPlayer = assessRosterConstraint({ position: 'WR' }, mine, smallLeague);
  const kicker = assessRosterConstraint({ position: 'K' }, mine, smallLeague);
  const defense = assessRosterConstraint({ position: 'DEF' }, mine, smallLeague);
  assert.equal(skillPlayer.feasible, false);
  assert.match(skillPlayer.reasons.join(' '), /required starter slots/);
  assert.equal(kicker.feasible, true);
  assert.equal(defense.feasible, true);
});
