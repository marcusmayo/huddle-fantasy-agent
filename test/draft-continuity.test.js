'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { fixture, tempDirectory, freePort, listen, close } = require('./fixtures/local-draft-fixture.cjs');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const { digest } = require('../src/domain/decision-audit');
const { pickOwner } = require('../src/domain/league');
const { exportLocalTransfer, validateLocalBundle, localState, importLocalCompletion } = require('../src/services/draft-continuity');
const { buildLocalDraftServer } = require('../scripts/local-draft-server.cjs');
const { handleDraftRoutes } = require('../src/server');
const resign = value => { const { contentHash, ...body } = value; return { ...body, contentHash: digest(body) }; };

test('preparation fences hosted execution durably, retries identically and copies no provider credentials', () => {
  const f = fixture(), id = f.session.id;
  f.args.league.oauthToken = 'DO-NOT-COPY'; f.args.playerPool.providerKey = 'DO-NOT-COPY';
  const bundle = f.prepare();
  assert.doesNotMatch(JSON.stringify(bundle), /DO-NOT-COPY/);
  assert.equal(bundle.playerPool.fetchedAt, f.args.playerPool.fetchedAt);
  assert.equal(validateLocalBundle(bundle), bundle);
  assert.deepEqual(exportLocalTransfer(f.drafts, id, f.input()).bundle, bundle);
  assert.throws(() => exportLocalTransfer(f.drafts, id, { ...f.input(), target: { ...f.target, instanceId: randomUUID() } }), { code: 'LOCAL_DRAFT_TRANSFER_CONFLICT' });
  assert.throws(() => f.drafts.controllers.update(id, f.start()), { code: 'DRAFT_CONTROL_TRANSFERRED' });
  assert.throws(() => f.drafts.recordDecision(id, { type: 'plan' }), { code: 'DRAFT_CONTROL_TRANSFERRED' });
  const restarted = new DraftService(f.args);
  assert.match(restarted.controllers.status(id).reason, /transferred/);
  restarted.deleteSession(id);
  const next = restarted.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  assert.throws(() => restarted.controllers.update(next.id, f.start()), { code: 'DRAFT_CONTROL_TRANSFERRED' });
});

test('preparation requires readiness, stopped control and a complete dated pool; failed save leaves no fence', () => {
  const f = fixture(), id = f.session.id;
  assert.throws(() => exportLocalTransfer(f.drafts, id, { ...f.input(), expectedCodeIdentity: 'different-local-version' }, { readinessPassed: true }), { code: 'LOCAL_DRAFT_VERSION_MISMATCH' });
  assert.equal(f.drafts.state.executionTransfers, undefined);
  assert.throws(() => exportLocalTransfer(f.drafts, id, f.input()), { code: 'DRAFT_PREFLIGHT_REQUIRED' });
  const lease = f.drafts.controllers.update(id, f.start());
  assert.throws(f.prepare, { code: 'LOCAL_DRAFT_PREPARE_BEFORE_START' });
  f.drafts.controllers.update(id, { action: 'stop', token: lease.token });
  const sourceAt = f.args.playerPool.fetchedAt;
  f.args.playerPool.fetchedAt = new Date(f.now() - 37 * 3600000).toISOString();
  assert.throws(f.prepare, { code: 'LOCAL_DRAFT_POOL_UNREADY' });
  f.args.playerPool.fetchedAt = sourceAt;
  const original = structuredClone(f.drafts.state), save = f.args.store.save.bind(f.args.store);
  f.args.store.save = () => { throw Error('disk failure'); };
  assert.throws(f.prepare, /disk failure/); assert.deepEqual(f.drafts.state, original);
  f.args.store.save = save;
  assert.equal(f.drafts.controllers.update(id, f.start()).active, true);
});

test('bundle validation rejects corruption, version mismatch, unsafe targets, incomplete identities and prior selection plans', () => {
  const f = fixture(), bundle = f.prepare();
  const bad = structuredClone(bundle); bad.playerPool.players[0].projectedPoints++;
  assert.throws(() => validateLocalBundle(bad), { code: 'LOCAL_DRAFT_BUNDLE_INVALID' });
  assert.throws(() => validateLocalBundle(bundle, { expectedCode: 'old-code' }), { code: 'LOCAL_DRAFT_VERSION_MISMATCH' });
  for (const origin of ['https://127.0.0.1:8791', 'http://localhost:8791', 'http://127.0.0.1:8791/path', 'http://127.0.0.1:80']) {
    assert.throws(() => validateLocalBundle(resign({ ...bundle, target: { ...bundle.target, origin } })), { code: 'LOCAL_DRAFT_TARGET_INVALID' });
  }
  assert.throws(() => validateLocalBundle(resign({ ...bundle, playerPool: { ...bundle.playerPool, complete: false } })), { code: 'LOCAL_DRAFT_POOL_UNREADY' });
  const duplicate = structuredClone(bundle); duplicate.playerPool.players[1].yahooPlayerKey = duplicate.playerPool.players[0].yahooPlayerKey;
  assert.throws(() => validateLocalBundle(resign(duplicate)), { code: 'LOCAL_DRAFT_POOL_UNREADY' });
  assert.throws(() => validateLocalBundle(bundle, { now: new Date(f.now() + 37 * 3600000) }), { code: 'LOCAL_DRAFT_POOL_UNREADY' });
  const planned = fixture();
  planned.drafts.state.draftAudit.events[planned.session.id] ||= [];
  require('../src/domain/decision-audit').appendEvent(planned.drafts.state.draftAudit.events[planned.session.id], { type: 'plan', eventId: 'prior-plan' });
  assert.throws(planned.prepare, { code: 'LOCAL_DRAFT_PENDING_DECISION' });
});

test('a local session requires its exact execution instance and displayed origin, with no recorder role', () => {
  const f = fixture(), bundle = f.prepare(), args = { ...f.args, store: new MemoryStateStore(localState(bundle)) };
  const wrong = new DraftService(args);
  assert.throws(() => wrong.controllers.update(f.session.id, f.start()), { code: 'LOCAL_DRAFT_INSTANCE_MISMATCH' });
  const local = new DraftService({ ...args, executionInstanceId: f.target.instanceId });
  const wrongRoles = f.start(); wrongRoles.roles = wrongRoles.roles.map(r => r.role === 'huddle' ? { ...r, url: 'https://hosted.example/draft-view.html' } : r);
  assert.throws(() => local.controllers.update(f.session.id, wrongRoles), { code: 'LOCAL_DRAFT_DISPLAY_REQUIRED' });
  const started = local.controllers.update(f.session.id, f.start());
  assert.equal(started.active, true); assert.deepEqual(started.roles.map(r => r.role), ['yahoo', 'huddle']);
});

test('local HTTP serves only the prepared draft, preserves data age and refuses cross-origin mutations and state replacement', async t => {
  const directory = tempDirectory(t), f = fixture({ port: await freePort() }), bundle = f.prepare();
  let app = await listen(buildLocalDraftServer({ bundle, stateDir: directory, now: f.args.now }));
  t.after(() => close(app));
  const base = `${app.origin}/api/leagues/${f.args.league.id}/draft/sessions/${f.session.id}`;
  const response = await fetch(app.origin); assert.ok(response.url.endsWith(app.view));
  const workspace = await (await fetch(base + '/workspace')).json();
  assert.equal(workspace.context.localDraft.sourceFetchedAt, bundle.playerPool.fetchedAt);
  assert.equal(workspace.context.localDraft.hostedServiceRequired, false);
  assert.equal(workspace.context.yahooLeagueKey, f.args.league.provenance.yahooLeagueKey);
  assert.ok(workspace.card.preferred); assert.equal(workspace.decisions.integrityVerified, true);
  assert.equal((await fetch(base + '/reopen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
  assert.equal((await fetch(base + '/controller', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(app.origin + '/api/leagues/other/draft/sessions/new/workspace')).status, 404);
  await close(app);
  f.advance(40 * 3600000);
  app = buildLocalDraftServer({ bundle, stateDir: directory, now: f.args.now });
  assert.equal(app.service.playerPool.fetchedAt, bundle.playerPool.fetchedAt);
  const saved = fs.readFileSync(app.store.filePath, 'utf8');
  const other = fixture({ port: f.target.origin.split(':').at(-1) }).prepare();
  assert.throws(() => buildLocalDraftServer({ bundle: other, stateDir: directory }), { code: 'LOCAL_DRAFT_STATE_MISMATCH' });
  assert.equal(fs.readFileSync(app.store.filePath, 'utf8'), saved);
});

test('a durable submission remains blocked after a local process restart until the actual result reconciles', t => {
  const f = fixture(), bundle = f.prepare(), directory = tempDirectory(t), id = f.session.id;
  let app = buildLocalDraftServer({ bundle, stateDir: directory, now: f.args.now });
  const lease = app.service.controllers.update(id, f.start()), card = app.service.recommendation(id), player = card.preferred.player;
  const yahooPlayerId = player.yahooPlayerKey.split('.p.').at(-1);
  const observed = { ...f.observation(), phase: 'drafting', onClock: true, secondsLeft: 75, yahooPlayerId };
  const plan = app.service.recordDecision(id, { type: 'plan', eventId: 'durable-plan', overallPick: 1, classification: 'huddle', reason: '',
    recommendationId: card.recommendationId, playerId: player.id, playerName: player.name, yahooPlayerId, yahooObservation: observed,
    controllerToken: lease.token, executor: { mode: 'computer-use', controllerId: lease.controllerId, controllerRunId: lease.runId } }).event;
  app.service.recordDecision(id, { type: 'display-confirmed', eventId: 'durable-display', planId: plan.hash,
    viewObservation: { observedAt: f.observation().observedAt, planId: plan.hash, recommendationId: card.recommendationId,
      overallPick: 1, selected: player.name, preferred: player.name, allPanelsInFrame: true, stale: false, width: 640, height: 720 } });
  app.service.recordDecision(id, { type: 'submit-started', eventId: 'durable-submit', planId: plan.hash, controllerToken: lease.token, yahooObservation: observed });
  app = buildLocalDraftServer({ bundle, stateDir: directory, now: f.args.now });
  assert.equal(app.service.controllers.status(id).active, false);
  assert.throws(() => app.service.controllers.update(id, f.start()), { code: 'CONTROLLER_PENDING_SUBMISSION' });
  assert.throws(() => app.service.controllers.assertLease(id, lease.token), { code: 'CONTROLLER_LEASE_REQUIRED' });
  assert.throws(() => app.service.recordDecision(id, { type: 'input-not-dispatched', eventId: 'cannot-reclassify', planId: plan.hash, controllerToken: lease.token }), { code: 'CONTROLLER_RUN_MISMATCH' });
  app.service.reconcileBrowserResults(id, { ...f.observation(), picks: [{ overallPick: 1, name: player.name, position: player.position, team: player.team, yahooPlayerId, isMine: true }] });
  const observation = { ...f.observation(), completedPicks: 1, overallPick: 2, phase: 'drafting', onClock: false, secondsLeft: 75 };
  const prepared = f.players.filter(p => p.id !== player.id).slice(0, 2).map(p => ({ yahooPlayerId: p.yahooPlayerKey.split('.p.').at(-1), name: p.name, position: p.position, available: true }));
  assert.equal(app.service.controllers.update(id, { ...f.start(), observation, prepared, availableObservation: { ...observation, players: prepared } }).active, true);
  const audit = app.service.exportDecisionAudit(id);
  assert.equal(audit.events.filter(e => e.type === 'submit-started').length, 1);
  assert.equal(audit.events.filter(e => e.type === 'accepted').length, 1);
  assert.equal(audit.events.find(e => e.type === 'accepted').inputAcknowledged, false);
  assert.equal(audit.integrityVerified, true);
});

test('all twenty DR selections use durable local HTTP after hosted shutdown; completion attaches only after independent board reconciliation', async t => {
  const { createLiveDraftController, createHuddleDraftClient } = await import('../scripts/live-draft-controller.mjs');
  const directory = tempDirectory(t), f = fixture({ full: true, port: await freePort() });
  const id = f.session.id, sourceAt = f.args.playerPool.fetchedAt;
  let ready = true;
  const hosted = http.createServer(async (req, res) => {
    try { await handleDraftRoutes(req, res, f.drafts, ['sessions', id, 'local-transfer'], { draftReadiness: { assertReady() { if (!ready) throw Error('readiness unavailable'); } } }); }
    catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.code, message: error.message })); }
  });
  await new Promise(resolve => hosted.listen(0, '127.0.0.1', resolve));
  t.after(() => close({ server: hosted }));
  const hostOrigin = `http://127.0.0.1:${hosted.address().port}`;
  const hostClient = createHuddleDraftClient({ baseUrl: hostOrigin, leagueId: f.args.league.id, sessionId: id });
  const { bundle } = await hostClient.localTransfer(f.input());
  ready = false; assert.deepEqual((await hostClient.localTransfer(f.input())).bundle, bundle);
  await close({ server: hosted });
  await assert.rejects(() => fetch(hostOrigin));
  let app = await listen(buildLocalDraftServer({ bundle, stateDir: directory, now: f.args.now })); t.after(() => close(app));
  const huddle = createHuddleDraftClient({ baseUrl: app.origin, leagueId: f.args.league.id, sessionId: id });
  const picks = [], submissions = [], displays = [], idOf = p => p.yahooPlayerKey.split('.p.').at(-1);
  let phase = 'waiting';
  const available = () => f.players.filter(p => !picks.some(row => row.yahooPlayerId === idOf(p)));
  const observation = () => ({ ...f.observation(), phase, completedPicks: picks.length, overallPick: picks.length + 1,
    secondsLeft: phase === 'drafting' ? 75 : null, onClock: phase === 'drafting' && pickOwner(picks.length + 1, 6) === 1 });
  const accept = (player, mine) => picks.push({ overallPick: picks.length + 1, name: player.name, position: player.position, team: player.team, yahooPlayerId: idOf(player), isMine: mine });
  const room = {
    async observe() { f.advance(20); return observation(); },
    async prepare(candidates) { f.advance(20); return { observation: observation(), players: candidates.filter(p => available().some(a => idOf(a) === idOf(p)))
      .map(p => ({ yahooPlayerId: idOf(p), name: p.name, position: p.position, available: true })) }; },
    async submit(input) {
      const events = app.store.load().draftAudit.events[id];
      assert.ok(events.some(e => e.type === 'submit-started' && e.overallPick === input.overallPick));
      assert.equal(input.overallPick, picks.length + 1); submissions.push(input);
      accept(available().find(p => idOf(p) === input.yahooPlayerId), true);
      while (picks.length < 120 && pickOwner(picks.length + 1, 6) !== 1) accept(available()[0], false);
      if (picks.length === 120) phase = 'completed';
    },
    async results() { return { ...observation(), picks: structuredClone(picks) }; }
  };
  const display = { async confirm(expected) { displays.push(expected); return { ...expected, observedAt: new Date(f.now()).toISOString(), allPanelsInFrame: true, stale: false, width: 640, height: 720 }; } };
  const controller = createLiveDraftController({ room, huddle, display, roles: f.roles, handoffAccepted: true, now: f.now,
    identity: { sessionId: id, teamCount: 6, draftSlot: 1, totalPicks: 120, leagueKey: f.args.league.provenance.yahooLeagueKey, teamKey: f.args.league.provenance.yahooTeamKey } });
  assert.equal((await controller.step()).waiting, true); phase = 'drafting';
  let restartInstance;
  const recoveredReads = [];
  for (let turn = 0; turn < 20; turn++) {
    if (turn === 10) {
      const oldInstance = app.service.controllers.instanceId;
      await close(app); app = await listen(buildLocalDraftServer({ bundle, stateDir: directory, now: f.args.now }));
      assert.equal(app.service.controllers.status(id).active, false);
      assert.notEqual(app.service.controllers.instanceId, oldInstance); restartInstance = app.service.controllers.instanceId;
    }
    let result = await controller.step();
    // A reused HTTP connection may see the old worker's close before a new
    // connection is established. Exercise the controller's bounded read recovery.
    for (let attempt = 0; result.fault && turn === 10 && attempt < 2; attempt++) {
      assert.equal(result.pending, false, 'A pending input must reconcile, never retry as a fresh selection');
      recoveredReads.push({ turn: turn + 1, ...result }); result = await controller.step();
    }
    assert.equal(result.matched, true, JSON.stringify({ turn: turn + 1, ...result }));
  }
  assert.equal((await controller.step()).completed, true);
  const audit = await huddle.audit();
  assert.equal(audit.integrityVerified, true); assert.equal(audit.session.picks.length, 120);
  assert.equal(controller.status().fullyVerified, true); assert.equal(submissions.length, 20); assert.equal(displays.length, 20);
  assert.equal(audit.events.filter(e => e.type === 'accepted').length, 20);
  assert.equal(audit.events.filter(e => e.type === 'submit-started').length, 20);
  assert.equal(app.service.playerPool.fetchedAt, sourceAt);
  assert.throws(() => importLocalCompletion(f.drafts, id, { transferId: f.transferId, audit }), { code: 'LOCAL_DRAFT_RESULTS_NOT_RECONCILED' });
  f.drafts.reconcileBrowserResults(id, await room.results());
  assert.throws(() => importLocalCompletion(f.drafts, id, { transferId: f.transferId, audit: { ...audit, events: [] } }), { code: 'LOCAL_DRAFT_COMPLETION_INVALID' });
  assert.equal(importLocalCompletion(f.drafts, id, { transferId: f.transferId, audit }).applied, true);
  assert.equal(importLocalCompletion(f.drafts, id, { transferId: f.transferId, audit }).applied, false);
  const preserved = new DraftService(f.args).exportDecisionAudit(id);
  assert.equal(preserved.continuity[0].completion.audit.events.length, audit.events.length);
  assert.ok(preserved.events.filter(e => e.type === 'accepted').every(e => e.classification === 'unattributed'));
  if (process.env.HUDDLE_LOCAL_REPLAY_REPORT) fs.writeFileSync(process.env.HUDDLE_LOCAL_REPLAY_REPORT, JSON.stringify({
    observedAt: new Date().toISOString(), scope: 'Synthetic DR room/display adapters, real local HTTP, actual JsonStateStore, hosted HTTP shut down',
    sourceFetchedAt: sourceAt, target: f.target, transferId: f.transferId, codeIdentity: bundle.codeIdentity,
    result: { submissions: submissions.length, displays: displays.length, reconciled: picks.length, receipts: controller.status().receipts,
      integrityVerified: audit.integrityVerified, restartInstance, recoveredReads, completedHistoryAttached: true, recorderRequired: false },
    limitations: ['No actual Yahoo browser actions', 'Clock and display observations are synthetic', 'Local server restarts do not supply an uninterrupted CUA runner'], audit
  }, null, 2));
});
