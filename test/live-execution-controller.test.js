'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const { pickOwner } = require('../src/domain/league');
const { scoringFingerprint } = require('../src/domain/league-projections');
let createLiveDraftController;
test.before(async () => ({ createLiveDraftController } = await import('../scripts/live-draft-controller.mjs')));

function fixture({ full = false, choose, faults = {} } = {}) {
  let time = Date.parse('2026-09-09T00:00:00Z'), sequence = 0;
  const league = { ...structuredClone(require('../config/leagues/yahoo-example.json')), teamCount: 6,
    roster: full ? { QB: 2, WR: 4, RB: 3, TE: 1, 'W/T': 1, 'W/R': 1, K: 1, DEF: 2, BN: 5, IR: 2 } : { QB: 1, RB: 1 },
    provenance: { yahooLeagueKey: 'nfl.l.153454', yahooTeamKey: 'nfl.l.153454.t.2' } };
  const positions = ['QB', 'RB', 'WR', 'TE', 'RB', 'WR', 'DEF', 'K'];
  const players = Array.from({ length: full ? 240 : 40 }, (_, i) => ({ id: `p${i}`, yahooPlayerKey: `nfl.p.${1000 + i}`,
    name: `Replay Player ${i}`, position: positions[i % 8], team: 'SEA', byeWeek: 5 + i % 10,
    expertRank: i + 1, adp: i + 1, projectedPoints: 400 - i, floor: 300 - i * .5, ceiling: 450 - i,
    projectionLeagueId: league.id, projectionScoringFingerprint: scoringFingerprint(league), projectionScoringVerified: true, projectionSource: 'synthetic-replay' }));
  const args = { league, playerPool: { players, source: 'synthetic-replay', complete: true, season: 2026 }, store: new MemoryStateStore(), now: () => new Date(time) };
  let drafts = new DraftService(args);
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' }), picks = [], actions = [], auditReads = [];
  let phase = 'waiting', expires = Infinity, remainingSeconds = 75;
  const bump = (ms = 100) => { time += ms; };
  const idOf = p => p.yahooPlayerKey.split('.p.').at(-1);
  const available = () => players.filter(p => !picks.some(pick => pick.yahooPlayerId === idOf(p)));
  function accept(player, mine) {
    picks.push({ overallPick: picks.length + 1, name: player.name, position: player.position, team: player.team, yahooPlayerId: idOf(player), isMine: mine });
    expires = time + remainingSeconds * 1000;
    if (picks.length === session.totalPicks) phase = 'completed';
  }
  function opponents() {
    while (picks.length < session.totalPicks && pickOwner(picks.length + 1, 6) !== 1) accept(available()[0], false);
  }
  const observation = () => ({ observedAt: new Date(time + (faults.clockSkewMs || 0)).toISOString(), phase, overallPick: picks.length + 1, completedPicks: picks.length,
    leagueKey: league.provenance.yahooLeagueKey, teamKey: league.provenance.yahooTeamKey, draftSlot: 1,
    autodraft: false, manualModeKnown: true, onClock: phase === 'drafting' && pickOwner(picks.length + 1, 6) === 1,
    secondsLeft: phase === 'drafting' ? Math.ceil((expires - time) / 1000) : null });
  const room = {
    async observe() { bump(); if (faults.readOnce) { faults.readOnce = false; throw Error('Transient browser timeout'); } return { ...observation(), ...(faults.wrongRoom ? { teamKey: 'nfl.l.153454.t.4' } : {}) }; },
    async prepare(candidates) {
      bump(faults.slowPrepareMs || 120);
      if (faults.advanceDuringPreparation && phase === 'drafting') { faults.advanceDuringPreparation = false; accept(available()[0], true); opponents(); }
      return { observation: observation(), players: candidates.filter(p => available().some(a => idOf(a) === idOf(p))).map(p => ({ yahooPlayerId: idOf(p), name: p.name, position: p.position, available: true })) };
    },
    async submit(input) {
      bump(); actions.push(input);
      const events = drafts.decisionSummary(session.id).events;
      auditReads.push(events.some(e => e.type === 'submit-started' && e.overallPick === picks.length + 1));
      assert.equal(input.overallPick, picks.length + 1);
      assert.ok(input.deadline > time);
      const p = available().find(p => idOf(p) === input.yahooPlayerId);
      assert.ok(p);
      if (faults.noAccept) throw Error('Click response lost before acceptance');
      accept(faults.wrongAccepted ? available().find(a => a.id !== p.id) : p, true);
      opponents();
      if (faults.clickResponseLost) { faults.clickResponseLost = false; throw Error('Input response lost after Yahoo accepted'); }
    },
    async results() { bump(); return { ...observation(), picks: structuredClone(picks) }; }
  };
  const huddle = {
    async workspace() { bump(); if (faults.workspaceOnce) { faults.workspaceOnce = false; throw Error('Dashboard temporarily unavailable'); } return drafts.workspace(session.id); },
    async controller(body) { bump(); return drafts.controllers.update(session.id, body); },
    async decision(body) { bump(); return drafts.recordDecision(session.id, body); },
    async reconcile(body) { bump(); return drafts.reconcileBrowserResults(session.id, body); }
  };
  const identity = { sessionId: session.id, teamCount: 6, draftSlot: 1, totalPicks: session.totalPicks, leagueKey: league.provenance.yahooLeagueKey, teamKey: league.provenance.yahooTeamKey };
  const roles = [{ role: 'yahoo', browserId: 'edge', tabId: 'yahoo', url: 'https://football.fantasysports.yahoo.com/draftclient/f1/153454/2' },
    { role: 'huddle', browserId: 'edge', tabId: 'huddle', url: 'http://localhost:8787/draft-view.html' }];
  const display = { async confirm(expected) { bump(); return { ...expected, observedAt: new Date(time).toISOString(), allPanelsInFrame: true, stale: false, width: 960, height: 900 }; } };
  const controller = createLiveDraftController({ room, huddle, display, identity, roles, handoffAccepted: true, choose,
    now: () => time, uuid: () => `test-event-${++sequence}`, sleep: async ms => bump(ms), executor: { name: 'Replay operator', model: 'test fixture', effort: 'test fixture' } });
  return { controller, room, huddle, display, session, picks, actions, auditReads, observation, args, players, identity, roles,
    get drafts() { return drafts; }, begin(seconds = 75) { remainingSeconds = seconds; phase = 'drafting'; expires = time + seconds * 1000; },
    restart() { drafts = new DraftService(args); }, bump, accept, opponents };
}

test('a mismatched room retains the observed and expected route through controller handoff', async () => {
  const f = fixture();
  const details = { expected: { origin: 'https://football.fantasysports.yahoo.com', path: '/draftclient/f1/153454/2' },
    observed: { origin: 'https://football.fantasysports.yahoo.com', path: '/draftclient/f1/999999/2' } };
  f.room.observe = async () => { throw Object.assign(Error('Room changed'), { code: 'ROOM_MISMATCH', details }); };
  const result = await f.controller.step();
  assert.deepEqual(result.room, details);
  assert.deepEqual(f.controller.status().events.find(e => e.type === 'fault').room, details);
  assert.deepEqual(f.actions, []);
});

test('a complete DR replay runs all twenty owned turns without a recorder, including adjacent turns, through durable plans and receipts', async () => {
  const f = fixture({ full: true });
  assert.deepEqual(f.roles.map(role => role.role), ['yahoo', 'huddle']);
  assert.equal((await f.controller.step()).waiting, true);
  f.begin();
  let windows = 0;
  while (!f.controller.status().completed && !f.controller.status().fatal && windows++ < 30) await f.controller.runWindow({ durationMs: 40000 });
  const result = f.controller.status();
  assert.equal(result.fatal, null, JSON.stringify(result.events.slice(-3)));
  assert.equal(result.completed, true); assert.equal(result.fullyVerified, true);
  assert.equal(f.picks.length, 120); assert.equal(f.actions.length, 20); assert.ok(f.auditReads.every(Boolean));
  assert.deepEqual(f.actions.map(a => a.overallPick), [1, 12, 13, 24, 25, 36, 37, 48, 49, 60, 61, 72, 73, 84, 85, 96, 97, 108, 109, 120]);
  const audit = new DraftService(f.args).exportDecisionAudit(f.session.id);
  assert.equal(audit.integrityVerified, true);
  assert.equal(audit.events.filter(e => e.type === 'accepted').length, 20);
  assert.equal(audit.events.filter(e => e.type === 'submit-started').length, 20);
  assert.equal(audit.events.filter(e => e.type === 'input-acknowledged').length, 20);
  assert.equal(audit.events.filter(e => e.type === 'display-confirmed').length, 20);
  assert.ok(audit.events.filter(e => e.type === 'submit-started').every(e => e.yahooObservation.overallPick === e.overallPick));
  assert.ok(audit.events.filter(e => e.type === 'accepted').every(e => e.inputAcknowledged));
  assert.ok(audit.events.filter(e => e.type === 'plan').every(e => e.executor.mode === 'computer-use' && e.executor.controllerRunId));
  if (process.env.HUDDLE_REPLAY_REPORT) require('node:fs').writeFileSync(process.env.HUDDLE_REPLAY_REPORT, JSON.stringify({
    recordedAt: new Date().toISOString(), label: 'Application execution-controller replay with a simulated room adapter',
    fixture: { teamCount: 6, draftSlot: 1, rounds: 20, totalPicks: 120, roster: f.args.league.roster, playerValues: 'Synthetic same-input values', clock: 'Injected virtual clock; browser I/O simulated' },
    result: { reconciled: f.picks.length, submissions: f.actions.length, receipts: result.receipts, fullyVerifiedInFixture: result.fullyVerified,
      auditIntegrityAfterRestart: audit.integrityVerified, dispatchAlwaysFollowedDurableIntent: f.auditReads.every(Boolean) },
    recommendationCount: audit.recommendations.length, recommendations: audit.recommendations.map(r => ({ id: r.id, overallPick: r.overallPick,
      reconciledPicks: r.reconciledPicks, preferred: r.preferred?.player.name, alternatives: r.alternatives, poolRevision: r.poolRevision })),
    executionEvents: audit.events, limitations: ['Does not certify actual Yahoo selectors or browser latency', 'Does not certify hosting or recording continuity', 'Additional long-outage fallback and production browser acceptance remain required']
  }, null, 2));
});

test('input response loss reconciles the accepted ID without clicking again or claiming verified manual input', async () => {
  const f = fixture({ faults: { clickResponseLost: true } }); await f.controller.step(); f.begin();
  const result = await f.controller.step();
  assert.equal(result.matched, true); assert.equal(result.inputAcknowledged, false);
  assert.equal(result.verification, 'result-matched-input-uncertain'); assert.equal(f.actions.length, 1);
  await f.controller.step(); assert.equal(f.actions.length, 2);
  await f.controller.step(); assert.equal(f.controller.status().completed, true); assert.equal(f.controller.status().fullyVerified, false);
});

test('an uncertain click with no receipt is never resubmitted, even after the deadline', async () => {
  const f = fixture({ faults: { noAccept: true } }); await f.controller.step(); f.begin();
  await f.controller.step(); f.bump(80000);
  const result = await f.controller.step(); assert.equal(result.expired, true);
  await f.controller.step(); assert.equal(f.actions.length, 1); assert.equal(f.controller.status().receipts.length, 0);
});

test('recovery after browser and Huddle reads fail reacquires control with fresh observations', async () => {
  const faults = {}, f = fixture({ faults }); await f.controller.step();
  faults.readOnce = true; assert.equal((await f.controller.step()).fault, 'OPERATION_FAILED');
  faults.workspaceOnce = true; assert.equal((await f.controller.step()).fault, 'OPERATION_FAILED');
  f.bump(11000); f.restart();
  assert.equal((await f.controller.step()).waiting, true); f.begin();
  assert.equal((await f.controller.step()).matched, true); assert.equal(f.actions.length, 1);
});

test('wrong room, missed deadline reserve and an unreviewed changed turn prevent input', async () => {
  for (const scenario of ['wrongRoom', 'shortClock', 'advanceDuringPreparation']) {
    const faults = {}, f = fixture({ faults }); await f.controller.step();
    if (scenario !== 'shortClock') faults[scenario] = true;
    f.begin(scenario === 'shortClock' ? 3 : 75);
    const result = await f.controller.step(); assert.ok(result.fault, scenario); assert.equal(f.actions.length, 0, scenario);
  }
});

test('an audible is visible in the saved plan before the exact alternate is submitted', async () => {
  const f = fixture({ choose: ({ workspace }) => ({ player: workspace.card.alternatives.safe.player, classification: 'audible', reason: 'Replay exercises a deliberate legal alternative and records its reason before dispatch.' }) });
  await f.controller.step(); f.begin(); assert.equal((await f.controller.step()).matched, true);
  const decision = f.drafts.decisionSummary(f.session.id).lastAccepted;
  assert.equal(decision.classification, 'audible'); assert.match(decision.reason, /deliberate legal alternative/);
  assert.notEqual(decision.playerName, decision.recommendedPlayer);
});

test('accepted result conflicts stop automatic control and preserve truthful attribution', async () => {
  const f = fixture({ faults: { wrongAccepted: true } }); await f.controller.step(); f.begin();
  const result = await f.controller.step(); assert.equal(result.matched, false);
  assert.equal(result.classification, 'unattributed'); assert.ok(f.controller.status().fatal);
  await f.controller.step(); assert.equal(f.actions.length, 1);
});

test('browser result imports reject incomplete prefixes, duplicate identities and wrong ownership before any mutation', () => {
  const f = fixture(); f.begin(); f.accept(f.players[0], true); f.opponents();
  const snapshot = { ...f.observation(), picks: structuredClone(f.picks) };
  const invalid = structuredClone(snapshot); invalid.picks[1].yahooPlayerId = invalid.picks[0].yahooPlayerId;
  assert.throws(() => f.drafts.reconcileBrowserResults(f.session.id, invalid), { code: 'BROWSER_RESULTS_INVALID' });
  assert.equal(f.drafts.getSession(f.session.id).picks.length, 0);
  const wrongOwner = structuredClone(snapshot); wrongOwner.picks[1].isMine = true;
  assert.throws(() => f.drafts.reconcileBrowserResults(f.session.id, wrongOwner), { code: 'BROWSER_RESULTS_INVALID' });
  assert.equal(f.drafts.reconcileBrowserResults(f.session.id, snapshot).imported, 11);
  assert.equal(f.drafts.reconcileBrowserResults(f.session.id, snapshot).imported, 0);
  assert.throws(() => f.drafts.reconcileBrowserResults(f.session.id, { ...snapshot, picks: [] }), { code: 'BROWSER_RESULTS_INCOMPLETE' });
});

test('a read that outlives its timeout cannot overlap a new browser action', async () => {
  const f = fixture();
  let release, calls = 0;
  const original = f.room.observe;
  f.room.observe = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  assert.equal((await f.controller.step()).fault, 'OPERATION_TIMEOUT');
  assert.equal((await f.controller.step()).unsettled, true); assert.equal(calls, 1); assert.equal(f.actions.length, 0);
  release(f.observation()); await new Promise(resolve => setImmediate(resolve));
  f.room.observe = original;
  assert.equal((await f.controller.step()).waiting, true);
});

test('a late click response never causes a second dispatch and is retained as uncertain evidence', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const original = f.room.submit; let release;
  f.room.submit = async input => { await original(input); return new Promise(resolve => { release = resolve; }); };
  assert.equal((await f.controller.step()).pending, true);
  assert.equal((await f.controller.step()).unsettled, true); assert.equal(f.actions.length, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  const receipt = await f.controller.step(); assert.equal(receipt.matched, true); assert.equal(receipt.inputAcknowledged, false);
  assert.equal(f.actions.length, 1);
});

test('the observed three-millisecond browser clock lead does not stall a draft; large skew remains invalid', async () => {
  const f = fixture({ faults: { clockSkewMs: 3 } }); await f.controller.step(); f.begin();
  assert.equal((await f.controller.step()).matched, true);
  assert.equal((await f.controller.step()).matched, true);
  assert.equal((await f.controller.step()).completed, true);
  const bad = fixture({ faults: { clockSkewMs: 2000 } });
  assert.equal((await bad.controller.step()).fault, 'ROOM_STALE'); assert.equal(bad.actions.length, 0);
});

test('a clipped or mismatched Huddle decision cannot authorize submission', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const confirm = f.display.confirm;
  f.display.confirm = async expected => ({ ...await confirm(expected), allPanelsInFrame: false });
  assert.equal((await f.controller.step()).fault, 'DECISION_DISPLAY_UNVERIFIED'); assert.equal(f.actions.length, 0);
  f.display.confirm = async expected => ({ ...await confirm(expected), preferred: 'A different recommendation' });
  assert.equal((await f.controller.step()).fault, 'DECISION_DISPLAY_UNVERIFIED'); assert.equal(f.actions.length, 0);
});

test('a bounded window yields before a new selection when it cannot retain its verification reserve', async () => {
  const f=fixture(); await f.controller.step(); f.begin();
  await f.controller.runWindow({durationMs:3000});
  assert.equal(f.actions.length,0);assert.equal(f.controller.status().pending,null);
  assert.equal((await f.controller.step()).matched,true);
});

test('abort during preparation prevents any later Yahoo input and revokes active control', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const abort = new AbortController(), prepare = f.room.prepare;
  f.room.prepare = async (...args) => { const prepared = await prepare(...args); abort.abort(); return prepared; };
  await f.controller.runWindow({ durationMs: 40000, signal: abort.signal });
  assert.equal(f.actions.length, 0);
  assert.equal(f.drafts.controllers.status(f.session.id).active, false);
});

test('a rejected overlapping window cannot replace the first window deadline', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const read = f.room.observe; let blocked = true;
  f.room.observe = async () => {
    if (blocked) { blocked = false; await new Promise(resolve => { release = resolve; entered(); }); }
    return read();
  };
  const first = f.controller.runWindow({ durationMs: 3000 });
  await waiting;
  await assert.rejects(f.controller.runWindow({ durationMs: 40000 }), { code: 'CONTROLLER_BUSY' });
  release(); await first;
  assert.equal(f.actions.length, 0, 'The original short window must still yield before drafting');
  assert.equal((await f.controller.step()).matched, true);
});

test('an ended browser execution context stops control rather than retrying in a later turn', async () => {
  const f = fixture(); await f.controller.step(); f.begin(); const read = f.room.observe;
  f.room.observe = async () => { throw Error('node_repl exec context not found'); };
  const result = await f.controller.step();
  assert.equal(result.fault, 'BROWSER_CONTEXT_ENDED');
  assert.equal(f.drafts.controllers.status(f.session.id).active, false);
  f.room.observe = read; await f.controller.step(); assert.equal(f.actions.length, 0);
});

function takeover(f) {
  return createLiveDraftController({ room: f.room, huddle: f.huddle, display: f.display, identity: f.identity,
    roles: f.roles, handoffAccepted: true, now: () => Date.parse(f.observation().observedAt), sleep: async ms => f.bump(ms) });
}

test('pre-input cancellation is durable, authenticated, idempotent and permits a fresh reviewed handoff', async () => {
  for (const boundary of ['plan', 'submit-started']) {
    const f = fixture(); await f.controller.step(); f.begin();
    const decision = f.huddle.decision;
    f.huddle.decision = async body => {
      const saved = await decision(body);
      if (body.type === boundary) {
        const plan = f.drafts.decisionSummary(f.session.id).latestPlan;
        assert.throws(() => f.drafts.recordDecision(f.session.id, { type: 'input-not-dispatched', eventId: 'wrong-owner',
          planId: plan.hash, controllerToken: 'another-controller' }), { code: 'CONTROLLER_RUN_MISMATCH' });
        f.controller.requestStop('Operator took control before browser input');
      }
      return saved;
    };
    await f.controller.step();
    const status = f.controller.status(), events = f.drafts.decisionSummary(f.session.id).events;
    assert.equal(status.stopConfirmed, true, boundary); assert.equal(status.stopEvidenceSaved, true, boundary);
    assert.equal(status.pending, null); assert.equal(f.actions.length, 0);
    const cancelled = events.filter(e => e.type === 'input-not-dispatched');
    assert.equal(cancelled.length, 1); assert.equal(events.some(e => e.type === 'submit-uncertain'), false);
    assert.throws(() => f.drafts.recordDecision(f.session.id, { type: 'submit-started', eventId: 'cancelled-retry',
      planId: cancelled[0].planId }), { code: 'DECISION_PLAN_ABANDONED' });
    if (boundary === 'submit-started') assert.throws(() => f.drafts.recordDecision(f.session.id, {
      type: 'input-acknowledged', eventId: 'late-input', planId: cancelled[0].planId }), { code: 'DECISION_INPUT_CANCELLED' });
    await f.controller.stop(); await f.controller.step();
    assert.equal(f.drafts.decisionSummary(f.session.id).events.filter(e => e.type === 'input-not-dispatched').length, 1);
    assert.equal(f.actions.length, 0, 'The stopped controller cannot resume');
    f.huddle.decision = decision;
    const fresh = takeover(f); assert.equal((await fresh.step()).matched, true);
    assert.equal(f.actions.length, 1); assert.notEqual(fresh.status().activeRunId, status.activeRunId);
    assert.equal(new DraftService(f.args).exportDecisionAudit(f.session.id).integrityVerified, true);
  }
});

test('stopping after issued input preserves acknowledgment or uncertainty and requires reconciliation before takeover', async () => {
  for (const acknowledged of [true, false]) {
    const f = fixture(); await f.controller.step(); f.begin();
    const submit = f.room.submit;
    f.room.submit = async input => {
      await submit(input); f.controller.requestStop('Operator stopped after browser input');
      if (!acknowledged) throw Error('Input response was lost');
    };
    await f.controller.step();
    const events = f.drafts.decisionSummary(f.session.id).events, lease = f.drafts.controllers.leases.get(f.session.id);
    const plan = events.findLast(e => e.type === 'plan');
    assert.equal(f.actions.length, 1); assert.equal(f.controller.status().stopConfirmed, true);
    assert.equal(events.some(e => e.type === 'input-not-dispatched'), false);
    assert.equal(events.some(e => e.type === (acknowledged ? 'input-acknowledged' : 'submit-uncertain')), true);
    assert.throws(() => f.drafts.controllers.update(f.session.id, { action: 'start' }), { code: 'CONTROLLER_PENDING_SUBMISSION' });
    assert.throws(() => f.drafts.recordDecision(f.session.id, { type: 'input-not-dispatched', eventId: 'false-cancel',
      planId: plan.hash, controllerToken: lease.token }), { code: 'DECISION_INPUT_ALREADY_DISPATCHED' });
    await f.controller.stop(); assert.equal(f.actions.length, 1);
    await f.huddle.reconcile(await f.room.results());
    const accepted = f.drafts.decisionSummary(f.session.id).lastAccepted;
    assert.equal(accepted.inputAcknowledged, acknowledged);
    assert.throws(() => f.drafts.recordDecision(f.session.id, { type: 'input-not-dispatched', eventId: 'cancel-accepted',
      planId: plan.hash, controllerToken: lease.token }), { code: 'DECISION_ALREADY_ACCEPTED' });
    f.room.submit = submit;
    assert.equal((await takeover(f).step()).matched, true); assert.equal(f.actions.length, 2);
  }
});

test('stopping an unsettled input waits for settlement and never relabels a late response as no input', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const submit = f.room.submit; let release;
  f.room.submit = async input => { await new Promise(resolve => { release = resolve; }); return submit(input); };
  assert.equal((await f.controller.step()).pending, true);
  const stopping = await f.controller.stop('Interrupted while input outcome was pending');
  assert.equal(stopping.unsettled, true); assert.equal(stopping.stopConfirmed, false);
  assert.equal(f.drafts.decisionSummary(f.session.id).events.some(e => e.type === 'input-not-dispatched'), false);
  release(); await new Promise(resolve => setImmediate(resolve));
  const stopped = await f.controller.stop();
  assert.equal(stopped.stopConfirmed, true); assert.equal(stopped.pending.inputAcknowledged, false);
  assert.equal(f.actions.length, 1);
  assert.equal(f.drafts.decisionSummary(f.session.id).events.some(e => e.type === 'submit-uncertain'), true);
  await f.controller.step(); assert.equal(f.actions.length, 1);
});

test('pre-aborted execution performs no browser operations', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  let reads = 0; f.room.observe = async () => { reads++; throw Error('Unexpected read'); };
  const result = await f.controller.runWindow({ signal: abort.signal });
  assert.equal(reads, 0); assert.equal(result.stage, 'stopped'); assert.equal(result.stopConfirmed, true);
  assert.equal(result.continuationRequired, false);
  for (const durationMs of [NaN,Infinity,'40000',99,45001]) {
    await assert.rejects(f.controller.runWindow({ durationMs }), { code: 'WINDOW_LIMIT' });
  }
});

test('failed cancellation persistence cannot silently release a pending submission; cleanup can be retried', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const decision = f.huddle.decision;
  f.huddle.decision = async body => {
    if (body.type === 'input-not-dispatched') throw Error('Evidence service unavailable');
    const saved = await decision(body);
    if (body.type === 'submit-started') f.controller.requestStop('Stop before input');
    return saved;
  };
  await f.controller.step();
  assert.equal(f.controller.status().stopEvidenceSaved, false); assert.equal(f.actions.length, 0);
  assert.equal(f.controller.status().stopConfirmed, true);
  assert.throws(() => f.drafts.controllers.update(f.session.id, { action: 'start' }), { code: 'CONTROLLER_PENDING_SUBMISSION' });
  f.huddle.decision = decision;
  assert.equal((await f.controller.stop()).stopEvidenceSaved, true);
  assert.equal((await takeover(f).step()).matched, true);
});

test('a cancelled plan cannot receive credit for an independently accepted player', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const confirm = f.display.confirm;
  f.display.confirm = async expected => { f.controller.requestStop('User taking this pick'); return confirm(expected); };
  await f.controller.step();
  const plan = f.drafts.decisionSummary(f.session.id).latestPlan;
  f.accept(f.players.find(p => p.id === plan.playerId), true); f.opponents();
  await f.huddle.reconcile(await f.room.results());
  const accepted = f.drafts.decisionSummary(f.session.id).lastAccepted;
  assert.equal(accepted.classification, 'unattributed'); assert.equal(accepted.planId, null);
  assert.equal(accepted.inputAcknowledged, false); assert.equal(f.actions.length, 0);
});

test('expiry permits a no-input receipt from its original run but never permits old-run submission', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const confirm = f.display.confirm;
  f.display.confirm = async expected => {
    const result = await confirm(expected); f.bump(11000); f.controller.requestStop('Operator interrupted during display'); return result;
  };
  await f.controller.step();
  assert.equal(f.controller.status().stopEvidenceSaved, true); assert.equal(f.actions.length, 0);
  const lease = f.drafts.controllers.leases.get(f.session.id);
  assert.throws(() => f.drafts.controllers.assertLease(f.session.id, lease.token), { code: 'CONTROLLER_LEASE_REQUIRED' });
  const plan = f.drafts.decisionSummary(f.session.id).latestPlan;
  f.restart();
  assert.throws(() => f.drafts.recordDecision(f.session.id, { type: 'input-not-dispatched', eventId: 'old-instance-cancel',
    planId: plan.hash, controllerToken: lease.token }), { code: 'CONTROLLER_RUN_MISMATCH' });
  f.display.confirm = confirm;
  assert.equal((await takeover(f).step()).matched, true);
});

test('a lost cancellation response retries the same durable event without duplicate evidence', async () => {
  const f = fixture(); await f.controller.step(); f.begin();
  const decision = f.huddle.decision; let loseResponse = true;
  f.huddle.decision = async body => {
    const saved = await decision(body);
    if (body.type === 'submit-started') f.controller.requestStop('Stop before browser input');
    if (body.type === 'input-not-dispatched' && loseResponse) { loseResponse = false; throw Error('Saved response lost'); }
    return saved;
  };
  await f.controller.step(); assert.equal(f.controller.status().stopEvidenceSaved, false);
  await f.controller.stop(); assert.equal(f.controller.status().stopEvidenceSaved, true);
  assert.equal(f.drafts.decisionSummary(f.session.id).events.filter(e => e.type === 'input-not-dispatched').length, 1);
  assert.equal(f.actions.length, 0);
});
