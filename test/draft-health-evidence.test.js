'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshYahooDraftEvidence } = require('../src/services/yahoo-draft-evidence');
const { mergeProviderPool } = require('../src/services/player-pool-store');
const { rankingPlayer } = require('../src/domain/decision-audit');
const { reviewDraftHealth, mergedHealthFields, validateHealthObservations } = require('../src/domain/draft-health');
const { scoreAvailablePlayers } = require('../src/domain/draft-board');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');

const now = new Date('2026-09-08T22:00:00Z');
function fixture() {
  const player = { id: 'one', yahooPlayerKey: '470.p.1', name: 'Test Receiver', position: 'WR', team: 'SEA',
    projectedPoints: 200, expertRank: 1, adp: 1, yahooEvidenceSeason: 2026, injuryStatus: 'Q',
    injurySource: 'Test team report', injuryUpdatedAt: '2026-09-08T18:00:00Z', injuryObservedAt: '2026-09-08T19:00:00Z' };
  const config = { ...structuredClone(require('../config/leagues/yahoo-example.json')), provenance: { season: 2026 } };
  return { player, runtime: { season: 2026, playerPool: { season: 2026, source: 'fixture', players: [player] } },
    entry: { id: config.id, config, yahooLeagueKey: '470.l.1', yahooTeamKey: '470.l.1.t.1' } };
}

test('an omitted Yahoo status does not erase or renew an existing dated designation', async () => {
  const f = fixture();
  const row = { player: [{ player_key: '470.p.1' }, { name: { full: 'Test Receiver' } }, { display_position: 'WR' }] };
  await refreshYahooDraftEvidence({ ...f, now: () => now,
    client: { availablePlayers: async (_key, query) => query.start ? {} : { players: [row] } } });
  const updated = f.runtime.playerPool.players[0];
  assert.equal(updated.injuryStatus, 'Q');
  assert.equal(updated.injuryObservedAt, '2026-09-08T19:00:00Z');
});

test('retrieving an older report later cannot replace a newer published injury report', () => {
  const f = fixture();
  const older = { ...f.player, injuryStatus: 'OUT', injuryUpdatedAt: '2026-09-07T15:00:00Z', injuryObservedAt: now.toISOString() };
  const merged = mergeProviderPool(f.runtime, { season: 2026, source: 'fixture', players: [older] });
  assert.equal(merged.players[0].injuryStatus, 'Q');
  assert.equal(Date.parse(merged.players[0].injuryUpdatedAt), Date.parse('2026-09-08T18:00:00Z'));
});

test('decision pool evidence preserves the source report timestamp separately from retrieval', () => {
  const f = fixture(), saved = rankingPlayer(f.player);
  assert.equal(saved.injuryUpdatedAt, f.player.injuryUpdatedAt);
  assert.equal(saved.injuryObservedAt, f.player.injuryObservedAt);
});

function report(kind, value, publishedAt = '2026-09-08T21:00:00Z', extra = {}) {
  return { kind, value, season: 2026, source: 'Test team report', publishedAt, observedAt: now.toISOString(),
    url: 'https://example.com/test-report', summary: 'Synthetic test evidence, not an actual player report.', ...extra };
}

test('practice and expected role stay distinct from designation and cannot silently clear it', () => {
  const f = fixture();
  const player = { ...f.player, ...mergedHealthFields([f.player, { draftHealth: { observations: [report('practice', 'FULL'), report('role', 'Unchanged role expected')] } }], { season: 2026, now }) };
  const reviewed = reviewDraftHealth(player, { season: 2026, now });
  assert.equal(reviewed.designation.value, 'Q'); assert.equal(reviewed.practice.value, 'FULL');
  assert.equal(reviewed.role.value, 'Unchanged role expected'); assert.equal(reviewed.penalty, .08);
  assert.equal(reviewed.practiceCurrent, true); assert.equal(reviewed.roleCurrent, true);
  assert.equal(player.projectedPoints, 200);
  const cleared = mergedHealthFields([player, { draftHealth: { observations: [report('designation', 'NONE')] } }], { season: 2026, now });
  assert.equal(reviewDraftHealth(cleared, { season: 2026, now }).penalty, 0);
  assert.equal(reviewDraftHealth(cleared, { season: 2026, now }).practice.value, 'FULL');
});

test('equal dated Q evidence receives identical penalties for every player and every draft style', () => {
  const f = fixture(), players = [f.player, { ...f.player, id: 'two', yahooPlayerKey: '470.p.2', name: 'Other Test Receiver' }];
  for (const style of ['balanced', 'safe', 'upside']) {
    const rows = scoreAvailablePlayers({ players, picks: [], league: f.entry.config, draftSlot: 1, style, now, season: 2026 });
    assert.equal(rows[0].risk, rows[1].risk); assert.equal(rows[0].score, rows[1].score);
    assert.deepEqual(rows[0].healthEvidence, rows[1].healthEvidence);
  }
});

test('stale, undated, future, wrong-season and conflicting reports remain visibly unverified', () => {
  const read = observations => reviewDraftHealth({ draftHealth: { observations } }, { season: 2026, now });
  assert.equal(read([report('designation', 'Q', '2026-09-06T12:00:00Z')]).state, 'stale-or-undated');
  assert.equal(read([report('designation', 'Q', null, { observedAt: null })]).reviewRequired, true);
  assert.equal(read([report('designation', 'NONE', '2026-09-09T12:00:00Z')]).state, 'unknown');
  assert.equal(read([report('designation', 'NONE', null, { observedAt: 'not-a-date' })]).state, 'unknown');
  assert.equal(read([report('designation', 'NONE', undefined, { season: 2025 })]).state, 'unknown');
  const conflicts = [report('designation', 'NONE'), report('designation', 'Q', undefined, { source: 'Another test source' })];
  assert.equal(read(conflicts).state, 'conflicting'); assert.equal(read(conflicts).penalty, .08);
  assert.deepEqual(read(conflicts), read([...conflicts].reverse()));
  assert.equal(read([report('practice', 'FULL', null)]).practiceCurrent, false);
});

test('explicit empty Yahoo designation clears an old flag; nested ownership status cannot do so', async () => {
  for (const [status, expected] of [[{ status: '' }, ''], [{ ownership: { status: 'A' } }, 'Q']]) {
    const f = fixture();
    const row = { player: [{ player_key: '470.p.1' }, { name: { full: 'Test Receiver' } }, { display_position: 'WR' }, status] };
    await refreshYahooDraftEvidence({ ...f, now: () => now, client: { availablePlayers: async (_key, query) => query.start ? {} : { players: [row] } } });
    assert.equal(f.runtime.playerPool.players[0].injuryStatus, expected);
  }
});

test('source reviews reject unsupported identities, missing dates, future dates, wrong season and unsafe URLs', () => {
  for (const item of [report('designation', 'A'), report('role', 'Limited', null), report('practice', 'DNP', undefined, { url: 'javascript:alert(1)' }),
    report('designation', 'OUT', undefined, { season: 2025 }), report('designation', 'Q', undefined, { observedAt: '2026-09-10T00:00:00Z' }),
    report('designation', 'Q', undefined, { source: '' })]) {
    assert.throws(() => validateHealthObservations([item], { season: 2026, now }), { code: 'INVALID_HEALTH_REVIEW' });
  }
});

function serviceFixture() {
  const f = fixture(); let clock = new Date(now);
  const args = { league: f.entry.config, playerPool: f.runtime.playerPool, store: new MemoryStateStore(), now: () => clock };
  const service = new DraftService(args), session = service.createSession({ sourceMode: 'yahoo', draftSlot: 1 });
  const input = { eventId: 'review-1', yahooPlayerId: '1', position: 'WR', observations: [report('practice', 'FULL'), report('role', 'Unchanged')] };
  return { ...f, service, session, args, input, advance: ms => { clock = new Date(clock.getTime() + ms); } };
}

test('a sourced health review survives refresh/restart and remains in the selected player and decision evidence', () => {
  const f = serviceFixture(), before = f.service.recommendation(f.session.id);
  assert.equal(f.service.recordHealthReview(f.session.id, f.input).applied, true);
  assert.equal(f.service.recordHealthReview(f.session.id, f.input).applied, false);
  const card = f.service.recommendation(f.session.id);
  assert.notEqual(card.recommendationId, before.recommendationId);
  assert.equal(card.preferred.healthEvidence.practice.value, 'FULL'); assert.equal(card.preferred.healthEvidence.designation.value, 'Q');
  f.runtime.playerPool.players[0] = { ...f.player, projectedPoints: 180 };
  const restarted = new DraftService(f.args);
  assert.equal(restarted.recommendation(f.session.id).preferred.healthEvidence.practice.value, 'FULL');
  restarted.recordPick(f.session.id, { playerId: 'one', eventId: 'pick-1', isMine: true, source: 'yahoo' });
  assert.ok(restarted.getSession(f.session.id).picks[0].draftHealth.observations.some(item => item.kind === 'role'));
  const audit = restarted.exportDecisionAudit(f.session.id);
  assert.equal(audit.integrityVerified, true); assert.equal(audit.events.filter(event => event.type === 'health-review').length, 1);
  assert.equal(audit.recommendations.find(snapshot => snapshot.id === card.recommendationId).preferred.healthEvidence.practice.value, 'FULL');
});

test('failed review persistence rolls back evidence, and changed identity or reused conflicting event IDs are rejected', () => {
  const f = serviceFixture(), initial = f.service.recommendation(f.session.id).recommendationId;
  assert.throws(() => f.service.recordHealthReview(f.session.id, { ...f.input, yahooPlayerId: '2' }), { code: 'HEALTH_PLAYER_IDENTITY_REQUIRED' });
  assert.throws(() => f.service.recordHealthReview(f.session.id, { ...f.input, position: 'RB' }), { code: 'HEALTH_PLAYER_IDENTITY_REQUIRED' });
  const save = f.args.store.save.bind(f.args.store); f.args.store.save = () => { throw Error('disk unavailable'); };
  assert.throws(() => f.service.recordHealthReview(f.session.id, f.input), /disk unavailable/);
  f.args.store.save = save;
  assert.equal(f.service.recommendation(f.session.id).recommendationId, initial);
  assert.equal(f.service.decisionSummary(f.session.id).events.length, 0);
  f.service.recordHealthReview(f.session.id, f.input);
  assert.throws(() => f.service.recordHealthReview(f.session.id, { ...f.input, observations: [report('designation', 'OUT')] }), { code: 'HEALTH_REVIEW_CONFLICT' });
  f.service.state.draftAudit.events[f.session.id][0].review.observations[0].value = 'Tampered';
  assert.equal(f.service.decisionSummary(f.session.id).integrityVerified, false);
});

test('health expiry creates a new recommendation revision without duplicating unchanged reads', () => {
  const f = serviceFixture(); f.service.recordHealthReview(f.session.id, f.input);
  const current = f.service.recommendation(f.session.id);
  f.advance(1000);
  assert.equal(f.service.recommendation(f.session.id).recommendationId, current.recommendationId);
  f.advance(37 * 3600000);
  const expired = f.service.recommendation(f.session.id);
  assert.notEqual(expired.recommendationId, current.recommendationId);
  assert.equal(expired.preferred.healthEvidence.reviewRequired, true);
  assert.equal(expired.preferred.healthEvidence.practiceCurrent, false);
  const saved = f.service.exportDecisionAudit(f.session.id).recommendations;
  assert.equal(saved.find(row => row.id === current.recommendationId).preferred.healthEvidence.practiceCurrent, true);
});

test('the app health-review endpoint saves a dated review for the exact session', async () => {
  const { buildApp } = require('../src/server');
  const f = fixture();
  const app = buildApp({ host: '127.0.0.1', port: 0, season: 2026, league: f.entry.config, playerPool: f.runtime.playerPool,
    fantasyProsSyncEnabled: false, yahooOAuthEnabled: false, yahooDraftAutoSyncEnabled: false }, { storeFactory: () => new MemoryStateStore() });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const session = app.draftService.createSession({ sourceMode: 'yahoo', draftSlot: 1 });
    const url = `http://127.0.0.1:${app.server.address().port}/api/leagues/${f.entry.config.id}/draft/sessions/${session.id}/health-reviews`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      eventId: 'http-review', yahooPlayerId: '1', position: 'WR', observations: [report('practice', 'FULL')] }) });
    assert.equal(response.status, 201); assert.equal((await response.json()).applied, true);
    assert.equal(app.draftService.recommendation(session.id).preferred.healthEvidence.practice.value, 'FULL');
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});

test('provider reconciliation uses dated injury evidence but refuses a conflicting numeric player identity', () => {
  const { reconcilePlayerEvidence } = require('../src/services/player-evidence');
  const f = fixture();
  const newer = { ...f.player, injuryStatus: 'OUT', injuryUpdatedAt: '2026-09-08T21:00:00Z', injuryObservedAt: now.toISOString() };
  const inputs = { season: 2026, players: [f.player] };
  const matched = reconcilePlayerEvidence(inputs, { tank01: { players: [newer] } });
  assert.equal(matched.players[0].injuryStatus, 'OUT');
  const conflicting = reconcilePlayerEvidence(inputs, { tank01: { players: [{ ...newer, yahooPlayerKey: '470.p.99' }] } });
  assert.equal(conflicting.players[0].injuryStatus, 'Q');
});

test('FantasyPros cache reuse preserves the original designation-observation time', async () => {
  const { FantasyProsClient } = require('../src/providers/fantasypros');
  const client = new FantasyProsClient({ apiKey: 'synthetic-key' });
  client.quotaStatus = () => ({ estimatedRemaining: 50 });
  client.request = async (endpoint, params) => ({ cachedAt: endpoint.endsWith('/players') ? '2026-09-08T14:00:00Z' : '2026-09-08T20:00:00Z', cacheHit: true,
    payload: { players: endpoint.endsWith('/players') ? [{ player_id: '1', injury_status: 'Q' }]
      : endpoint.endsWith('/consensus-rankings') && params.position === 'WR' ? [{ player_id: '1', player_name: 'Test Receiver', player_position_id: 'WR', rank_ecr: 1 }] : [] } });
  const pool = await client.loadDraftPool({ season: 2026 });
  assert.equal(pool.players[0].injuryStatus, 'Q');
  assert.equal(pool.players[0].injuryObservedAt, '2026-09-08T14:00:00Z');
  assert.equal(pool.players[0].injurySource, 'fantasypros-player-designation');
  assert.equal(pool.players[0].injuryUpdatedAt, undefined, 'A cache timestamp is not a report publication date');
});

test('a missing retrieval date stays unverified until observed, and a future duplicate cannot hide a valid report', () => {
  const first = { draftHealth: { observations: [report('designation', 'Q', undefined, { observedAt: null })] } };
  assert.equal(reviewDraftHealth(first, { season: 2026, now }).reviewRequired, true);
  const observed = { draftHealth: { observations: [report('designation', 'Q')] } };
  const future = { draftHealth: { observations: [report('designation', 'Q', undefined, { observedAt: '2027-01-01T00:00:00Z' })] } };
  for (const inputs of [[first, observed, future], [future, first, observed]]) {
    const merged = mergedHealthFields(inputs, { season: 2026, now });
    const reviewed = reviewDraftHealth(merged, { season: 2026, now });
    assert.equal(reviewed.state, 'current'); assert.equal(reviewed.designation.observedAt, now.toISOString());
    assert.equal(reviewed.designation.publishedAt, '2026-09-08T21:00:00.000Z');
  }
});
