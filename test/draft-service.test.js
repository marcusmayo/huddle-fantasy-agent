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
  assert.equal(card.evidence.league.teamCount, 6);
  assert.equal(card.evidence.league.scoring.offense.reception, 1);
  assert.equal(card.evidence.ranking.algorithm, 'deterministic-v1');
  assert.equal(card.evidence.ranking.playerInputs.includes('ADP'), true);
  assert.equal(card.execution, 'recommendation-only');
});

test('invalid draft slot fails closed', () => {
  assert.throws(() => service().createSession({ draftSlot: 7 }), /between 1 and 6/);
});

test('an authoritative Yahoo observation can correct a saved session draft slot', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  const updated = drafts.updateDraftSlot(session.id, 3, { source: 'yahoo-draft-result' });
  assert.equal(updated.draftSlot, 3);
  assert.equal(updated.draftSlotSource, 'yahoo-draft-result');
  assert.equal(drafts.recommendation(session.id).draftSlot, 3);
});

test('draft sessions can be completed, reopened, and permanently deleted', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 2 });
  drafts.recordPick(session.id, { eventId: 'lifecycle:1', playerId: 'demo-rb-1' });
  const completed = drafts.completeSession(session.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.completionReason, 'operator-completed');
  assert.ok(completed.completedAt);
  assert.throws(() => drafts.recordPick(session.id, { eventId: 'lifecycle:2', playerId: 'demo-rb-2' }), (error) => error.code === 'DRAFT_SESSION_COMPLETED');
  assert.equal(drafts.reopenSession(session.id).status, 'active');
  assert.equal(drafts.recordPick(session.id, { eventId: 'lifecycle:2', playerId: 'demo-rb-2' }).applied, true);
  const deleted = drafts.deleteSession(session.id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.picks, 2);
  assert.throws(() => drafts.getSession(session.id), (error) => error.code === 'SESSION_NOT_FOUND');
});

test('a draft session completes automatically at the league draft depth', () => {
  const tinyLeague = { ...structuredClone(league), teamCount: 2, roster: { QB: 1, IR: 2 } };
  const drafts = new DraftService({ league: tinyLeague, playerPool, store: new MemoryStateStore() });
  const session = drafts.createSession({ draftSlot: 1 });
  drafts.recordPick(session.id, { eventId: 'full:1', playerId: 'demo-qb-1' });
  const result = drafts.recordPick(session.id, { eventId: 'full:2', playerId: 'demo-qb-2' });
  assert.equal(result.session.totalPicks, 2);
  assert.equal(result.session.status, 'completed');
  assert.equal(result.session.completionReason, 'draft-board-complete');
});

test('an unlisted player can be recorded with operator-supplied identity', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 1 });
  const result = drafts.recordPick(session.id, {
    manualPlayer: { name: 'Late Call-Up', position: 'WR', team: 'FA' },
    isMine: true,
    source: 'manual-unresolved'
  });
  assert.equal(result.applied, true);
  assert.match(result.session.picks[0].playerId, /^manual:/);
  assert.equal(result.session.picks[0].position, 'WR');
  assert.equal(result.session.availableCount, playerPool.players.length);
});

test('reviewed availability evidence annotates but does not rerank the board', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 2, sourceMode: 'screenshot' });
  const before = drafts.recommendation(session.id);
  const target = before.board[3];
  const result = drafts.recordEvidenceReview(session.id, {
    eventId: 'vision-review:available:1',
    purpose: 'available_players',
    observations: [{
      candidateId: 'vision:available_players:1',
      playerId: target.player.id,
      playerName: target.player.name,
      confidence: 0.97
    }]
  });
  assert.equal(result.applied, true);
  assert.equal(result.session.picks.length, 0);
  assert.equal(result.review.observations[0].ownershipPercent, null);

  const after = drafts.recommendation(session.id);
  assert.deepEqual(after.board.map((item) => [item.player.id, item.score]), before.board.map((item) => [item.player.id, item.score]));
  assert.deepEqual(after.board.find((item) => item.player.id === target.player.id).evidenceTags, ['AVAILABLE']);
  assert.equal(after.evidence.screenshotReviews.count, 1);
  assert.equal(after.evidence.screenshotReviews.confirmedObservations, 1);

  const duplicate = drafts.recordEvidenceReview(session.id, {
    eventId: 'vision-review:available:1',
    purpose: 'available_players',
    observations: [{ playerId: target.player.id, playerName: target.player.name }]
  });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, 'duplicate-event');
});

test('availability evidence conflicting with a confirmed draft pick is retained but not tagged available', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'screenshot' });
  drafts.recordPick(session.id, { eventId: 'draft:1', playerId: 'demo-rb-1' });
  const result = drafts.recordEvidenceReview(session.id, {
    purpose: 'waiver_players',
    observations: [{ playerId: 'demo-rb-1', playerName: 'Running Back Alpha', confidence: 0.9 }]
  });
  assert.equal(result.review.observations[0].status, 'conflict-drafted');
  assert.equal(drafts.recommendation(session.id).board.some((item) => item.evidenceTags.includes('WAIVER')), false);
});

test('screenshot review metadata expires at the configured 30-day ceiling', () => {
  const store = new MemoryStateStore({
    sessions: {
      old: {
        id: 'old', leagueId: league.id, draftSlot: 1, sourceMode: 'screenshot', playerSource: 'synthetic', status: 'active', picks: [], appliedEventIds: [],
        evidenceReviews: [{ id: 'review-old', eventId: 'evidence-old', purpose: 'available_players', observations: [], createdAt: '2026-06-01T00:00:00.000Z' }],
        appliedEvidenceEventIds: ['evidence-old'], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z'
      }
    }
  });
  const drafts = new DraftService({
    league,
    playerPool,
    store,
    evidenceRetentionDays: 90,
    now: () => new Date('2026-08-01T00:00:00.000Z')
  });
  assert.equal(drafts.evidenceRetentionDays, 30);
  assert.equal(drafts.getSession('old').evidenceReviews.length, 0);
  assert.deepEqual(drafts.getSession('old').appliedEvidenceEventIds, []);
});

test('operator can delete review metadata and inspect unresolved player identities', () => {
  const drafts = service();
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'screenshot' });
  drafts.recordPick(session.id, { manualPlayer: { name: 'Unlisted Prospect', position: 'WR', team: 'FA' }, source: 'manual-unresolved' });
  drafts.recordEvidenceReview(session.id, {
    purpose: 'available_players',
    observations: [{ playerName: 'Screenshot Only Player', position: 'RB', confidence: 0.8 }]
  });
  const unresolved = drafts.unresolvedPlayers();
  assert.deepEqual(unresolved.map((item) => item.kind).sort(), ['manual-pick', 'screenshot-observation']);
  const deleted = drafts.deleteEvidenceReviews(session.id);
  assert.equal(deleted.deletedReviews, 1);
  assert.equal(drafts.getSession(session.id).evidenceReviews.length, 0);
  assert.deepEqual(drafts.unresolvedPlayers().map((item) => item.kind), ['manual-pick']);
});

test('an expired OpenRouter-derived pick removes its whole draft session rather than corrupting pick order', () => {
  const store = new MemoryStateStore({
    sessions: {
      vision: {
        id: 'vision', leagueId: league.id, draftSlot: 1, sourceMode: 'screenshot', playerSource: 'synthetic', status: 'active',
        picks: [{ eventId: 'vision:1', overallPick: 1, playerId: 'demo-rb-1', playerName: 'Running Back Alpha', position: 'RB', source: 'openrouter-screenshot', observedAt: '2026-06-01T00:00:00.000Z' }],
        appliedEventIds: ['vision:1'], evidenceReviews: [], appliedEvidenceEventIds: [], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z'
      }
    }
  });
  const drafts = new DraftService({ league, playerPool, store, now: () => new Date('2026-08-01T00:00:00.000Z') });
  assert.equal(drafts.listSessions().length, 0);
  assert.deepEqual(store.load().sessions, {});
});
