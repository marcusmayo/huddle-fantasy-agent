// The execution state machine is independent of a particular browser runtime.
// A room adapter must use the supported computer-use API, read rendered Yahoo
// state, and target exact numeric IDs. Huddle remains a recommendation service.
// Keep this browser-runner module native ESM for the CUA module loader. These
// bounds match domain/observation-time.js and are exercised together in replay.
const CLOCK_SKEW_ALLOWANCE_MS = 1000;
const isFreshObservation = (value, now) => { const age = Number(now) - Date.parse(value); return Number.isFinite(age) && age >= -1000 && age <= 5000; };
const error = (code, message) => Object.assign(new Error(message), { code });
const yahooId = p => String(p?.yahooPlayerId || p?.yahooPlayerKey?.split('.p.').at(-1) || '');
const owner = (pick, teams) => Math.floor((pick - 1) / teams) % 2 ? teams - (pick - 1) % teams : (pick - 1) % teams + 1;
const defaults = { observe: 1500, workspace: 2000, prepare: 2500, controller: 1200, decision: 1600, display: 2000, submit: 2000, results: 3500, reconcile: 2000 };

export function createLiveDraftController({ room, huddle, display, identity, roles, handoffAccepted, executor = {},
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  uuid = () => globalThis.crypto.randomUUID(), choose, onEvent = () => {} }) {
  if (handoffAccepted !== true) throw error('HANDOFF_REQUIRED', 'Execution requires an accepted handoff before entering the countdown');
  if (typeof display?.confirm !== 'function') throw error('DISPLAY_REQUIRED', 'Verify the displayed Huddle decision before draft submission');
  if (!identity?.leagueKey || !identity?.teamKey || !identity?.sessionId || !Number.isInteger(identity.teamCount)
    || !Number.isInteger(identity.draftSlot) || identity.draftSlot < 1 || identity.draftSlot > identity.teamCount
    || !Number.isInteger(identity.totalPicks) || identity.totalPicks % identity.teamCount) throw error('IDENTITY_REQUIRED', 'Verify league, team, seat and complete draft size');
  const state = { stage: 'prepared', completed: false, pending: null, lease: null, prepared: [], receipts: [], timings: {}, events: [],
    busy: false, inflight: null, fatal: null, windowDeadline: Infinity, windowOwner: null, controllerId: uuid(),
    plan: null, haltReason: null, stopConfirmed: false, stopEvidenceSaved: false, stopEventId: null, stopping: false };
  const emit = (type, details = {}) => {
    const event = { type, at: new Date(now()).toISOString(), ...details };
    state.events.push(event); onEvent(event); return event;
  };
  const estimate = name => Math.max(defaults[name] || 1000, ...(state.timings[name] || []).slice(-30)) * 1.2;
  const reserve = () => estimate('submit') + estimate('results') + estimate('reconcile') + 1500;
  const remaining = o => o.phase === 'waiting' ? Infinity : Number(o.secondsLeft) * 1000 - Math.max(0, now() - Date.parse(o.observedAt)) - CLOCK_SKEW_ALLOWANCE_MS;
  function observeValid(o, { completed = false } = {}) {
    const age = now() - Date.parse(o?.observedAt);
    if (!isFreshObservation(o?.observedAt, now())) throw error('ROOM_STALE', 'Yahoo observation is stale');
    if (o.leagueKey !== identity.leagueKey || o.teamKey !== identity.teamKey || o.draftSlot !== identity.draftSlot) throw error('ROOM_MISMATCH', 'Yahoo room identity changed');
    if (!Number.isInteger(o.completedPicks) || o.completedPicks < 0 || o.completedPicks > identity.totalPicks) throw error('BOARD_INVALID', 'Invalid completed-pick count');
    if (o.phase === 'completed' && completed && o.completedPicks === identity.totalPicks) return o;
    if (!['waiting', 'drafting'].includes(o.phase) || o.overallPick !== o.completedPicks + 1 || o.autodraft !== false || o.manualModeKnown !== true) throw error('MANUAL_MODE_UNVERIFIED', 'Verify the room, completed board and Autodraft OFF');
    if (o.phase === 'drafting' && (o.onClock !== (owner(o.overallPick, identity.teamCount) === identity.draftSlot) || !(remaining(o) > 0))) throw error('TURN_UNVERIFIED', 'The observed turn or clock does not match the draft');
    return o;
  }
  function requestStop(reason = 'Execution stopped by the operator') {
    if (!state.haltReason) {
      state.haltReason = String(reason).slice(0, 500); state.stage = 'stopping';
      emit('stop-requested', { reason: state.haltReason, inputDispatched: Boolean(state.pending?.inputDispatched) });
    }
    return status();
  }
  async function call(name, fn, cap = 4500, cleanup = false) {
    if (state.haltReason && !cleanup) throw error('CONTROLLER_STOPPED', state.haltReason);
    if (state.inflight) throw error('OPERATION_UNSETTLED', 'A previous browser or service operation has not settled');
    const budget = cleanup ? cap : Math.min(cap, state.windowDeadline - now() - 100);
    if (budget < 100) throw error('WINDOW_BOUNDARY', 'Continue the same controller in the next bounded window');
    const started = now(), abort = new AbortController();
    const operation = { name, started };
    state.inflight = operation;
    let timer;
    const work = Promise.resolve().then(() => {
      if (state.haltReason && !cleanup) throw error('CONTROLLER_STOPPED', state.haltReason);
      // Let the adapter's own deadline return before this outer watchdog fires.
      // Browser transport/settlement time is part of the active invocation.
      return fn({ timeoutMs: Math.max(80,budget-Math.min(500,budget*.2)), signal: abort.signal });
    }).finally(() => {
      if (state.inflight === operation) state.inflight = null;
      (state.timings[name] ||= []).push(now() - started);
    });
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(error('OPERATION_TIMEOUT', `${name} exceeded its deadline`)); }, budget);
      })]);
    } catch (e) {
      if (['observe', 'prepare', 'display', 'submit', 'results'].includes(name)
        && /node_repl exec context not found|turn ended|user stopped computer use/i.test(e.message || '')) {
        throw error('BROWSER_CONTEXT_ENDED', 'Browser execution context ended; a fresh verified handoff is required');
      }
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function settleStop() {
    if (!state.haltReason || state.busy || state.inflight || state.stopping) return;
    state.stopping = true;
    try {
      if (state.plan && !state.stopEvidenceSaved) {
        state.stopEventId ||= uuid();
        const dispatched = state.pending?.inputDispatched === true;
        try {
          await call('decision', options => huddle.decision({ type: dispatched
            ? state.pending.inputAcknowledged ? 'input-acknowledged' : 'submit-uncertain' : 'input-not-dispatched',
            eventId: state.stopEventId, planId: state.plan.hash, controllerToken: state.lease?.token,
            details: dispatched ? 'Stopped after issuing browser input; verify the accepted Yahoo result before any takeover.'
              : `Controller stopped before invoking browser input: ${state.haltReason}` }, options), 1500, true);
          state.stopEvidenceSaved = true;
          if (!dispatched) state.pending = null;
        } catch (e) { emit('stop-evidence-unconfirmed', { code: e.code || 'SAVE_FAILED' }); }
      }
      if (!state.stopConfirmed && !state.inflight) {
        try {
          if (state.lease) await call('controller', options => huddle.controller({ action: 'stop', token: state.lease.token }, options), 1500, true);
          state.stopConfirmed = true;
        } catch (e) {
          if (e.code === 'DRAFT_SESSION_COMPLETED') state.stopConfirmed = true;
          else emit('stop-unconfirmed', { code: e.code || 'STOP_FAILED' });
        }
      }
      state.stage = state.inflight ? 'stopping' : 'stopped';
    } finally { state.stopping = false; }
  }
  async function stop(reason) { requestStop(reason); await settleStop(); return status(); }
  async function readRoom() { return observeValid(await call('observe', options => room.observe(options)), { completed: true }); }
  async function workspace() {
    const w = await call('workspace', options => huddle.workspace(options));
    if (w.session.id !== identity.sessionId || w.session.draftSlot !== identity.draftSlot || w.session.totalPicks !== identity.totalPicks
      || w.session.sourceMode !== 'yahoo' || !w.decisions?.integrityVerified) throw error('HUDDLE_CONTEXT_INVALID', 'Huddle session identity or audit integrity changed');
    return w;
  }
  async function reconcile() {
    const results = await call('results', options => room.results(options));
    await call('reconcile', options => huddle.reconcile(results, options));
    return results;
  }
  async function heartbeat(observation, stage) {
    const lease = await call('controller', options => huddle.controller({ action: 'heartbeat', token: state.lease.token, observation, stage }, options));
    state.lease = { ...lease, token: state.lease.token };
  }
  function candidates(w) {
    const seen = new Set();
    return [w.card.preferred, w.card.alternatives?.safe, w.card.alternatives?.upside, ...(w.card.board || [])]
      .filter(c => c && c.rosterFeasible !== false && /^[1-9]\d*$/.test(yahooId(c.player)))
      .map(c => c.player).filter(p => { const id = yahooId(p); if (seen.has(id)) return false; seen.add(id); return true; }).slice(0, 3);
  }
  async function activate(w, o) {
    const prepared = await call('prepare', options => room.prepare(candidates(w), options));
    observeValid(prepared.observation);
    if (prepared.observation.completedPicks !== w.session.picks.length) throw error('BOARD_CHANGED', 'Reconcile picks that arrived while preparing control');
    const availableObservation = { observedAt: prepared.observation.observedAt, overallPick: prepared.observation.overallPick,
      leagueKey: prepared.observation.leagueKey, teamKey: prepared.observation.teamKey, players: prepared.players };
    const lease = await call('controller', options => huddle.controller({ action: 'start', controllerId: state.controllerId,
      handoffAccepted: true, roles, prepared: prepared.players.filter(p => p.available === true), availableObservation, observation: prepared.observation }, options));
    state.lease = lease; state.prepared = prepared.players;
    emit('activated', { runId: lease.runId, overallPick: o.overallPick });
    return prepared.observation;
  }
  async function verifyPending() {
    const p = state.pending;
    const results = await reconcile();
    const actual = results.picks.find(pick => pick.overallPick === p.overallPick);
    if (!actual) {
      state.stage = now() >= p.deadline ? 'handoff' : 'verifying';
      return { pending: true, overallPick: p.overallPick, expired: now() >= p.deadline };
    }
    const matched = actual.isMine === true && String(actual.yahooPlayerId) === p.yahooPlayerId;
    const receipt = { overallPick: p.overallPick, yahooPlayerId: String(actual.yahooPlayerId), expectedYahooPlayerId: p.yahooPlayerId,
      matched, inputAcknowledged: p.inputAcknowledged, classification: matched ? p.classification : 'unattributed',
      verification: !matched ? 'different-player-accepted' : p.inputAcknowledged ? 'input-acknowledged-and-result-matched' : 'result-matched-input-uncertain',
      acceptedAt: new Date(now()).toISOString(), elapsedMs: now() - p.startedAt };
    state.receipts.push(receipt); state.pending = null; state.plan = null; emit('receipt', receipt);
    // A different accepted player ends automatic control so a changed roster
    // receives explicit review. A matching uncertain receipt is never a retry.
    if (!matched) state.fatal = error('ACCEPTANCE_MISMATCH', 'Yahoo accepted a different player; review the receipt before takeover');
    state.stage = matched ? 'watching' : 'handoff';
    return receipt;
  }
  async function iteration() {
    if (state.pending) return verifyPending();
    let o = await readRoom(), w = await workspace();
    if (w.session.picks.length !== o.completedPicks) {
      const reconciliationBudget = estimate('results') + estimate('reconcile') + estimate('workspace') + estimate('observe') + estimate('controller');
      if (state.windowDeadline - now() < reconciliationBudget) return { yielded:true };
      await reconcile(); w = await workspace(); o = await readRoom();
    }
    if (w.session.picks.length !== o.completedPicks) throw error('BOARD_CHANGED', 'The board advanced during reconciliation; read it again');
    if (o.phase === 'completed') {
      if (w.session.picks.length !== identity.totalPicks || w.session.status !== 'completed') throw error('COMPLETION_UNVERIFIED', 'The final result has not reconciled');
      state.completed = true; state.stage = 'completed'; emit('completed', { totalPicks: identity.totalPicks });
      return { completed: true };
    }
    if (!state.lease || !w.controller?.active || w.controller.runId !== state.lease.runId) {
      if (w.controller?.active && w.controller.runId !== state.lease?.runId) throw error('ANOTHER_CONTROLLER_ACTIVE', 'Another controller is active');
      o = await activate(w, o);
    } else await heartbeat(o, 'watching');
    if (o.phase === 'waiting' || !o.onClock) { state.stage = 'watching'; return { waiting: true }; }
    if (w.card.currentOverall !== o.overallPick || w.card.reconciledPicks !== o.completedPicks || !w.card.onClock) throw error('RECOMMENDATION_STALE', 'Wait for an exact-turn Huddle recommendation');
    const minimum = reserve() + estimate('prepare') + 3 * estimate('decision') + estimate('display') + estimate('controller');
    if (state.windowDeadline - now() < minimum) return { yielded: true };
    if (remaining(o) < minimum) throw error('CLOCK_RESERVE_REQUIRED', `Only ${Math.floor(remaining(o) / 1000)} seconds remain; the measured execution reserve is ${Math.ceil(minimum / 1000)} seconds`);
    const decision = choose ? choose({ workspace: w, observation: o, prepared: state.prepared, reserveMs: reserve() }) : {
      player: w.card.preferred?.player, classification: 'huddle', reason: ''
    };
    if (!decision || typeof decision.then === 'function' || !/^[1-9]\d*$/.test(yahooId(decision.player))) throw error('CHOICE_REQUIRED', 'Choose an identified player without an unbounded on-clock analysis');
    const selected = await call('prepare', options => room.prepare([decision.player], options));
    o = observeValid(selected.observation);
    const selectedId = yahooId(decision.player);
    const rows = selected.players.filter(p => String(p.yahooPlayerId) === selectedId && p.available === true && p.position === decision.player.position);
    if (!o.onClock || o.overallPick !== w.card.currentOverall || rows.length !== 1) throw error('PLAYER_OR_TURN_CHANGED', 'The exact available player or owned turn changed');
    if (remaining(o) < reserve() + 3 * estimate('decision') + estimate('display') + estimate('controller')) throw error('CLOCK_RESERVE_REQUIRED', 'Preparation consumed the deadline reserve');
    await heartbeat(o, 'planned');
    const yahooObservation = { ...o, yahooPlayerId: selectedId };
    const plan = await call('decision', options => huddle.decision({ type: 'plan', eventId: uuid(), overallPick: o.overallPick,
      classification: decision.classification, reason: decision.reason, recommendationId: w.card.recommendationId,
      playerId: decision.player.id, playerName: decision.player.name, yahooPlayerId: selectedId, yahooObservation,
      controllerToken: state.lease.token, executor: { ...executor, mode: 'computer-use', controllerId: state.lease.controllerId, controllerRunId: state.lease.runId } }, options));
    state.plan = plan.event; state.stopEventId = null; state.stopEvidenceSaved = false;
    const viewObservation = await call('display', options => display.confirm({ planId: plan.event.hash, recommendationId: w.card.recommendationId,
      overallPick: o.overallPick, preferred: w.card.preferred?.player.name, selected: decision.player.name }, options));
    await call('decision', options => huddle.decision({ type: 'display-confirmed', eventId: uuid(), planId: plan.event.hash, viewObservation }, options));
    const fresh = observeValid(await readRoom());
    if (!fresh.onClock || fresh.overallPick !== o.overallPick || remaining(fresh) < reserve() + estimate('decision')) throw error('TURN_OR_RESERVE_CHANGED', 'Recheck the turn and reserve before dispatch');
    const startedAt = now();
    state.pending = { overallPick: o.overallPick, yahooPlayerId: selectedId, classification: decision.classification,
      startedAt, deadline: now() + remaining(fresh), inputDispatched: false, inputAcknowledged: false, planId: plan.event.hash };
    // Persist intent before input. Only this run can attest to a cancellation
    // before room.submit is invoked; once invoked, uncertainty requires a result.
    try {
      await call('decision', options => huddle.decision({ type: 'submit-started', eventId: uuid(), planId: plan.event.hash,
        controllerToken: state.lease.token, yahooObservation: { ...fresh, yahooPlayerId: selectedId } }, options));
    } catch (e) {
      // A definite validation rejection occurred before any browser input.
      // A transport error has no such guarantee about the durable audit write.
      if (['WINDOW_BOUNDARY', 'DECISION_STALE_RECOMMENDATION', 'DECISION_YAHOO_OBSERVATION_REQUIRED', 'DECISION_CLOCK_EXPIRED', 'DECISION_WRONG_TURN',
        'CONTROLLER_LEASE_REQUIRED', 'CONTROLLER_RUN_MISMATCH', 'DECISION_PLAN_SUPERSEDED', 'DECISION_PLAN_ABANDONED'].includes(e.code)) state.pending = null;
      throw e;
    }
    state.stage = 'submitting'; emit('submit-started', { overallPick: o.overallPick, yahooPlayerId: selectedId });
    try {
      await call('submit', options => {
        state.pending.inputDispatched = true;
        return room.submit({ yahooPlayerId: selectedId, position: decision.player.position, overallPick: fresh.overallPick,
          leagueKey: identity.leagueKey, teamKey: identity.teamKey, deadline: state.pending.deadline - 1500 }, options);
      }, Math.min(4500, remaining(fresh) - 1500));
      state.pending.inputAcknowledged = true;
    } catch (e) {
      if (!state.pending.inputDispatched || e.code === 'BROWSER_CONTEXT_ENDED') {
        requestStop(e.message); throw e;
      }
      emit('input-uncertain', { overallPick: o.overallPick, code: e.code || 'INPUT_RESPONSE_ERROR' });
      if (!state.inflight) await call('decision', options => huddle.decision({ type: 'submit-uncertain', eventId: uuid(), planId: plan.event.hash, details: e.message }, options));
    }
    if (state.pending.inputAcknowledged) await call('decision', options => huddle.decision({ type: 'input-acknowledged', eventId: uuid(), planId: plan.event.hash,
      details: 'The exact-player browser input returned successfully; reconcile the accepted Yahoo result separately.' }, options));
    state.stage = 'verifying';
    return state.inflight ? { pending: true } : verifyPending();
  }
  async function step(windowOwner = null) {
    if (state.windowOwner && windowOwner !== state.windowOwner) throw error('CONTROLLER_BUSY', 'A running window owns this controller');
    if (state.busy) throw error('CONTROLLER_BUSY', 'The controller already has a running step');
    if (state.haltReason) { await settleStop(); return { ...status(), stopped: true, unsettled: Boolean(state.inflight) }; }
    if (state.fatal || state.completed || state.inflight) return { stage: state.stage, fatal: state.fatal?.message, unsettled: Boolean(state.inflight), completed: state.completed };
    state.busy = true;
    try { return await iteration(); }
    catch (e) {
      if (e.code === 'WINDOW_BOUNDARY') return { yielded: true };
      state.stage = state.pending ? 'uncertain' : 'recovering';
      const room = e.code === 'ROOM_MISMATCH' && e.details ? e.details : undefined;
      emit('fault', { code: e.code || 'OPERATION_FAILED', message: e.message, pending: Boolean(state.pending), ...(room ? { room } : {}) });
      if (['ROOM_MISMATCH', 'HUDDLE_CONTEXT_INVALID', 'ANOTHER_CONTROLLER_ACTIVE', 'MANUAL_MODE_UNVERIFIED', 'CLOCK_RESERVE_REQUIRED', 'ACCEPTANCE_MISMATCH', 'BROWSER_CONTEXT_ENDED'].includes(e.code)) {
        state.fatal = e; state.stage = 'handoff';
        requestStop(e.message);
      }
      return { fault: e.code || 'OPERATION_FAILED', message: e.message, pending: Boolean(state.pending), ...(room ? { room } : {}) };
    } finally {
      state.busy = false;
      if (state.fatal && !state.haltReason) requestStop(state.fatal.message);
      await settleStop();
    }
  }
  async function runWindow({ durationMs = 40000, signal } = {}) {
    if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 45000) throw error('WINDOW_LIMIT', 'Use windows between 100 ms and 45 seconds');
    if (state.windowOwner || state.busy || state.stopping) throw error('CONTROLLER_BUSY', 'The controller already has an active invocation');
    const windowOwner = {}; state.windowOwner = windowOwner;
    const onAbort = () => requestStop('Execution invocation was aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    state.windowDeadline = now() + durationMs;
    try {
      while (!state.haltReason && now() < state.windowDeadline - 100 && !state.completed && !state.fatal) {
        if (state.inflight) break;
        const result = await step(windowOwner);
        if (result.yielded) break;
        if (result.waiting || result.pending || result.fault) await sleep(Math.min(350, Math.max(0, state.windowDeadline - now() - 100)));
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      state.windowDeadline = Infinity; state.windowOwner = null;
      await settleStop();
    }
    return status();
  }
  function status() {
    return { stage: state.stage, completed: state.completed, pending: state.pending ? { ...state.pending } : null,
      fatal: state.fatal?.message || null, haltReason: state.haltReason, stopConfirmed: state.stopConfirmed,
      stopEvidenceSaved: state.stopEvidenceSaved, unsettled: Boolean(state.inflight), windowActive: Boolean(state.windowOwner),
      unsettledOperation: state.inflight ? { name:state.inflight.name,startedAt:new Date(state.inflight.started).toISOString(),inputDispatched:state.pending?.inputDispatched===true } : null,
      continuationRequired: !state.completed && !state.fatal && !state.haltReason,
      activeRunId: state.lease?.runId || null, receipts: structuredClone(state.receipts),
      fullyVerified: state.completed && state.receipts.length === identity.totalPicks / identity.teamCount
        && state.receipts.every(r => r.matched && r.inputAcknowledged), timings: structuredClone(state.timings), events: structuredClone(state.events) };
  }
  return { step, runWindow, status, requestStop, stop };
}

// Purpose-built Huddle API client; it never reads or writes Yahoo. Transport
// deadlines and single-flight execution are owned by the controller above.
export function createHuddleDraftClient({ baseUrl, leagueId, sessionId, fetchImpl = globalThis.fetch }) {
  const base = `${baseUrl.replace(/\/$/, '')}/api/leagues/${encodeURIComponent(leagueId)}/draft/sessions/${encodeURIComponent(sessionId)}`;
  async function request(path, body, options = {}) {
    const response = await fetchImpl(base + path, { method: body ? 'POST' : 'GET', signal: options.signal,
      headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw error(value.code || value.error || 'HUDDLE_REQUEST_FAILED', value.message || 'Huddle request failed');
    return value;
  }
  return { workspace: options => request('/workspace', null, options), controller: (body, options) => request('/controller', body, options),
    localTransfer: (body, options) => request('/local-transfer', body, options),
    localCompletion: (body, options) => request('/local-completion', body, options),
    audit: options => request('/decision-audit', null, options),
    healthReview: (body, options) => request('/health-reviews', body, options),
    decision: (body, options) => request('/decisions', body, options), reconcile: (body, options) => request('/browser-results', body, options) };
}
