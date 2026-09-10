'use strict';
import { readYahooDocument, parseYahooRows, parseYahooRow, parseYahooMockSnapshot, parseYahooObservation } from './yahoo-live-cua-adapter.mjs';
export const RUNNER_BUILD = '2026-09-09-frozen-parser-v1';

// Load this function definition into the persistent CUA REPL, then pass already
// verified Yahoo and Huddle tab handles. All browser actions use documented CUA
// APIs; page evaluation only reads rendered DOM. This file never joins a room.
function createYahooMockLoop({ yahoo, huddle, roomId, draftSlot, rules, teamCount = 8, sessionId, simulation = false }) {
  const rounds = Object.entries(rules.roster || {}).filter(([slot])=>!['IR','IL','NA'].includes(slot)).reduce((sum,[,count])=>sum+Number(count),0);
  if (!Number.isInteger(teamCount) || teamCount < 2 || !Number.isInteger(rounds) || rounds < 1
    || !Number.isInteger(draftSlot) || draftSlot < 1 || draftSlot > teamCount) throw Error('Verified team count, roster size and assigned seat are required');
  if (!simulation && !sessionId) throw Error('A verified Huddle sessionId is required');
  const expectedPicks = teamCount * rounds;
  const roomIdentity = Object.freeze({origin:'https://football.fantasysports.yahoo.com',path:`/draftclient/f1/${roomId}/${draftSlot}`,leagueKey:`nfl.l.${roomId}`,teamKey:`nfl.l.${roomId}.t.${draftSlot}`,draftSlot,totalPicks:expectedPicks});
  const state = { version: RUNNER_BUILD, sessionId, deliverySource: 'browser-assisted', independentDelivery: false, yahoo, huddle, roomId, draftSlot, rules, teamCount, rounds, expectedPicks, stage: 'prepared', log: [], events: [], pending: null, lastSnapshot: null, completedPicks: null };
  const teamKey = value => String(value).toUpperCase().replace(/^JAX$/, 'JAC').replace(/^LAR$/, 'LA').replace(/^WSH$/, 'WAS');
  const ownPick = header => Number(header.match(/YOUR TURN\s*\u2022\s*ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1] || 0);
  const stage = name => { state.stage = name; state.events.push({ stage: name, at: Date.now() }); };
  const player = row => parseYahooRow(row, 'players');
  const button = name => state.yahoo.playwright.locator('button').filter({ hasText: new RegExp(`^${name}$`) });

  state.inspect = async function () {
    const raw = await state.yahoo.playwright.evaluate(readYahooDocument, undefined, { timeoutMs: 6000 });
    const table = raw.tables.find(t => t.kind === (raw.playersSelected ? 'players' : 'results'));
    return {...raw, headers:table?.headers || [], rows:table?.rows || []};
  };

  state.recoverManual = async function () {
    // Yahoo's blocking inactivity notice is not exposed as role=dialog. Check
    // its observed text across the visible document, beyond the short header.
    let data = await state.inspect();
    if (data.inactivityNotice) {
      stage('dismiss-inactivity-notice');
      await state.yahoo.playwright.locator('button')
        .filter({ has: state.yahoo.playwright.locator('[data-icon="close-default"]') })
        .click({ timeoutMs: 5000 });
      data = await state.inspect();
      if (data.inactivityNotice) throw Error('Yahoo inactivity notice remains visible; manual controls are blocked');
    }
    if (!data.autoKnown) throw Error('Yahoo manual mode cannot be verified');
    if (data.autodraft) {
      stage('restore-manual-mode');
      await state.yahoo.playwright.locator('button[title="Autodraft"]').click({ timeoutMs: 5000 });
      const deadline = Date.now() + 4000;
      do {
        data = await state.inspect();
        if (data.autoKnown && !data.autodraft && !data.inactivityNotice) return data;
        await state.yahoo.playwright.waitForTimeout(120);
      } while (Date.now() < deadline);
      throw Error('Yahoo did not acknowledge manual mode; do not submit a pick');
    }
    return data;
  };

  state.grid = async function (view) {
    stage(`read-${view.toLowerCase()}`);
    const deadline = Date.now() + 11000;
    let switches = 0;
    let subtabSwitches = 0;
    let data;
    do {
      data = await state.inspect();
      const selected = view === 'Players' ? data.playersSelected : data.resultsSelected;
      const correctTable = view === 'Players'
        ? data.headers.includes('XRank') && data.headers.includes('Proj Pts')
        : data.headers[0] === 'Pick' && data.headers[1] === 'Player' && data.headers[2] === 'Team';
      if (selected && correctTable) return data;
      if (!selected && switches < 2) {
        switches += 1;
        // Keyboard activation avoids the moving Results-tab mouse target that
        // delayed acceptance checks in the September 8 draft-day rehearsal.
        try { await button(view).press('Enter', { timeoutMs: 4000 }); }
        catch (error) { state.events.push({ stage: 'navigation-response-error', view, error: String(error), at: Date.now() }); }
      } else if (view === 'Results' && selected && !data.roundsSelected && subtabSwitches < 2) {
        subtabSwitches += 1;
        try { await button('Round by Round').press('Enter', { timeoutMs: 4000 }); }
        catch (error) { state.events.push({ stage: 'subtab-response-error', error: String(error), at: Date.now() }); }
      } else await state.yahoo.playwright.waitForTimeout(150);
    } while (Date.now() < deadline);
    // A timed-out input response can still have switched the visible tab.
    // Inspect once after the last action even when the retry budget expired.
    data = await state.inspect();
    const selected = view === 'Players' ? data.playersSelected : data.resultsSelected;
    const correctTable = view === 'Players'
      ? data.headers.includes('XRank') && data.headers.includes('Proj Pts')
      : data.headers[0] === 'Pick' && data.headers[1] === 'Player' && data.headers[2] === 'Team';
    if (selected && correctTable) return data;
    throw Error(`Yahoo ${view} view did not become ready: ${JSON.stringify({ headers: data?.headers, switches, subtabSwitches })}`);
  };

  state.results = async function () {
    const data = await state.grid('Results');
    const picks = parseYahooRows(data,'results').sort((a,b)=>a.overallPick-b.overallPick);
    if (picks.some((p,i)=>p.overallPick!==i+1)) throw Error('Yahoo results contain a pick gap');
    state.resultPicks = picks;
    if (picks.length > expectedPicks) throw Error('Observed board exceeds the verified league draft size');
    if (picks.length === expectedPicks) state.completedPicks = picks;
    return { data, picks };
  };

  state.capture = async function () {
    const results = await state.grid('Results');
    const players = /Draft Complete/i.test(results.header) ? null : await state.grid('Players');
    try {
      const snapshot = parseYahooMockSnapshot({results,players,identity:roomIdentity,rules,teamCount});
      state.lastSnapshot=snapshot;
      return {snapshot,header:(players||results).header};
    } catch(error) {
      if (['ROOM_TURN_CHANGED','RESULTS_PREFIX_INCOMPLETE'].includes(error.code)) return {retry:true,code:error.code,header:(players||results).header};
      stage('blocked'); throw error;
    }
  };

  state.sync = async function (snapshot, { requireRecommendation = true } = {}) {
    stage('import-huddle');
    await state.huddle.playwright.locator('#mock-snapshot-input').fill(JSON.stringify(snapshot), { timeoutMs: 8000 });
    // Keyboard activation avoids a moving-page click that appeared successful
    // but left the filled snapshot unsubmitted in the timed browser rehearsal.
    await state.huddle.playwright.locator('#mock-snapshot-submit').press('Enter', { timeoutMs: 8000 });
    const deadline = Date.now() + 8000;
    let card;
    do {
      card = await state.huddle.playwright.evaluate(() => ({
        sessionId: document.querySelector('#mock-sync-status')?.dataset.sessionId,
        phase: document.querySelector('#mock-sync-status')?.dataset.phase,
        reconciled: Number(document.querySelector('#mock-sync-status')?.dataset.reconciled),
        pick: Number(document.querySelector('#current-pick')?.textContent),
        ready: document.querySelector('#mock-sync-status')?.getAttribute('data-ready') === 'true',
        status: document.querySelector('#mock-sync-status')?.textContent,
        error: document.querySelector('#mock-import-message')?.textContent,
        pending: Boolean(document.querySelector('#mock-snapshot-submit')?.disabled),
        inputEmpty: document.querySelector('#mock-snapshot-input')?.value === '',
        name: document.querySelector('#preferred-name')?.textContent,
        meta: document.querySelector('#preferred-meta')?.textContent,
        observedName: document.querySelector('#preferred-observed-name')?.textContent.replace(/^Yahoo name:\s*/, ''),
        yahooPlayerId: document.querySelector('#preferred-observed-name')?.getAttribute('data-yahoo-player-id'),
        roster: document.querySelector('#mock-roster-coverage')?.textContent,
        why: document.querySelector('#preferred-why')?.innerText
      }), undefined, { timeoutMs: 6000 });
      if (!card.pending && /^Import stopped:/.test(card.error || '')) throw Error(card.error);
      if (importAcknowledged(card, snapshot, sessionId, expectedPicks)) {
        state.card = card;
        if (requireRecommendation && snapshot.phase === 'drafting' && !snapshot.autodraft && !card.ready) throw Error(`Huddle not ready: ${card.status}`);
        return card;
      }
      await state.huddle.playwright.waitForTimeout(120);
    } while (Date.now() < deadline);
    throw Error(`Huddle import did not complete: ${JSON.stringify(card)}`);
  };

  state.cycle = async function () {
    if (state.pending) return {blocked:'An earlier submission is uncertain; reconcile it before another input'};
    const started = Date.now();
    const initial = await state.inspect();
    const pick = ownPick(initial.header);
    if (!pick) return { waiting: true, header: initial.header };
    if (initial.inactivityNotice || !initial.autoKnown || initial.autodraft) return { blocked: 'Autodraft must be visibly OFF with no inactivity notice', header: initial.header };
    const secondsAtStart = parseYahooObservation(initial,roomIdentity).secondsLeft;
    if (secondsAtStart < 12) return { blocked: 'Less than ten seconds plus the two-second safety allowance remains', header: initial.header };
    const captured = await state.capture();
    if (captured.retry) return captured;
    const snapshot = captured.snapshot;
    if (snapshot.currentOverall !== pick || snapshot.autodraft) return { retry: true, header: captured.header };
    const card = await state.sync(snapshot);
    (state.decisionSnapshots ||= []).push({ snapshot, header: captured.header, card, recommendedAt: new Date().toISOString() });
    if (!/^[1-9]\d{0,9}$/.test(card.yahooPlayerId || '')) throw Error('Huddle preferred player lacks a Yahoo ID');
    const fresh = await state.inspect();
    const rows = fresh.rows.filter(r => r.yahooPlayerId === card.yahooPlayerId && r.cells.length > 5);
    const position = card.meta.split('·')[0].trim();
    if (ownPick(fresh.header) !== pick || fresh.inactivityNotice || fresh.autodraft || !fresh.playersSelected || rows.length !== 1) return { blocked: 'Live turn or available player changed', header: fresh.header };
    const observedTurn = parseYahooObservation(fresh,roomIdentity);
    if (!observedTurn.manualModeKnown || observedTurn.secondsLeft*1000-Math.max(0,Date.now()-Date.parse(fresh.observedAt))-2000 < 10000) return {blocked:'Selection window is too short or manual mode is unverified'};
    const identity = player(rows[0]);
    if (identity.name !== card.observedName || identity.position !== position || identity.team !== teamKey(card.meta.split('·')[1].trim())) throw Error('Preferred player identity disagrees with the visible Yahoo row');
    state.pending = { pick, ...identity, started, submittedAt: null };
    stage('submit-draft');
    try {
      await state.yahoo.playwright.locator('table tbody tr')
        .filter({ has: state.yahoo.playwright.locator(`.ys-player[data-id="${identity.yahooPlayerId}"]`) })
        .locator('button').filter({ hasText: /^Draft$/ }).click({ timeoutMs: 8000 });
      state.pending.submittedAt = new Date().toISOString();
    } catch (error) { state.pending.responseError = String(error); }
    stage('verify-acceptance');
    const accepted = await state.results();
    const actual = accepted.picks.find(p => p.overallPick === pick);
    if (!actual?.isMine || actual.yahooPlayerId !== identity.yahooPlayerId) throw Error(`Draft acceptance not verified: ${JSON.stringify({ pending: state.pending, actual })}`);
    const observedBeforeExpiry = Date.now() - started < Math.max(0, secondsAtStart - 1) * 1000;
    if (state.pending.responseError && !observedBeforeExpiry) throw Error('Player was accepted, but the input response and clock do not prove a manual selection');
    const entry = { pick, name: card.name, ...identity, projectedPoints: snapshot.availablePlayers.find(p => p.yahooPlayerId === identity.yahooPlayerId)?.projectedPoints, byeWeek: snapshot.availablePlayers.find(p => p.yahooPlayerId === identity.yahooPlayerId)?.byeWeek, why: card.why, elapsedMs: Date.now() - started, secondsAtStart, submittedAt: state.pending.submittedAt, accepted: true, rosterBeforePick: card.roster };
    state.log.push(entry);
    state.pending = null;
    // Persist the accepted pick immediately. No candidate availability is
    // inferred from the Results view; the next capture supplies a fresh pool.
    const current = Number(accepted.data.header.match(/ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1] || 0);
    if (accepted.picks.length === expectedPicks || current === accepted.picks.length + 1) {
      const receipt = { ...snapshot, phase: accepted.picks.length === expectedPicks ? 'completed' : 'drafting',
        picks: accepted.picks, currentOverall: accepted.picks.length + 1, availablePlayers: [],
        autodraft: accepted.data.autodraft, observedAt: accepted.data.observedAt };
      try {
        const receiptCard = await state.sync(receipt, { requireRecommendation: false });
        entry.reconciledAfterPick = receipt.picks.length;
        entry.rosterAfterPick = receiptCard.roster;
      } catch (error) { entry.reconciliationError = String(error); }
    }
    entry.cycleWithReceiptMs = Date.now() - started;
    stage('accepted');
    return entry;
  };

  state.batch = async function ({ waitMs = 10000 } = {}) {
    const deadline = Date.now() + waitMs;
    let data;
    do {
      data = await state.inspect();
      if (ownPick(data.header)) {
        const result = await state.cycle();
        return { manualVerified: state.log.length, result, stage: state.stage };
      }
      if (!/Draft Complete/i.test(data.header) && (data.autodraft || data.inactivityNotice || !data.autoKnown)) {
        stage('blocked');
        return {manualVerified:state.log.length,result:{blocked:'Yahoo manual mode requires attention',autodraft:data.autodraft},header:data.header};
      }
      if (/Draft Complete/i.test(data.header)) break;
      if (Date.now() < deadline) await state.yahoo.playwright.waitForTimeout(600);
    } while (Date.now() < deadline);
    return { manualVerified: state.log.length, waiting: true, autodraft: data.autodraft, header: data.header };
  };

  state.complete = async function () {
    const captured = await state.capture();
    if (!captured.snapshot || captured.snapshot.picks.length !== expectedPicks) throw Error(`The complete ${expectedPicks}-pick board is not available`);
    const card = await state.sync(captured.snapshot);
    const owned = captured.snapshot.picks.filter(p => p.isMine);
    const verified = new Set(state.log.filter(p => p.accepted).map(p => `${p.pick}:${p.yahooPlayerId}`));
    const unverified = owned.filter(p => !verified.has(`${p.overallPick}:${p.yahooPlayerId}`));
    return { reconciled: expectedPicks, owned: owned.length, manuallyVerified: state.log.length,
      fullyManual: owned.length === rounds && unverified.length === 0,
      unverifiedPicks: unverified.map(p => p.overallPick),
      roster: card.roster, picks: captured.snapshot.picks, timings: state.log };
  };
  // Bound each call to one selection by default. Immediately invoke the next
  // call on adjacent snake turns; retain the full audit until the clock ends.
  state.window = async function ({ maxPicks = 1, waitMs = 1000 } = {}) {
    const results = [];
    for (let i = 0; i < maxPicks; i++) {
      const value = await state.batch({ waitMs });
      results.push(value.result?.accepted ? { pick: value.result.pick, name: value.result.name,
        ms: value.result.elapsedMs, accepted: true } : value);
      if (!value.result?.accepted) break;
    }
    return { manualVerified: state.log.length, results };
  };
  // Call immediately after closing the verified room-settings panel. Never
  // return a recommendation to the chat for a second action while on clock.
  state.startVerified = async function () {
    stage('start-verified');
    const current = await state.recoverManual();
    state.events.push({stage:'startup-mode-verified',header:current.header,at:Date.now()});
    // Use the same case-insensitive turn parser and selection path on every
    // turn. A separate opening import can consume the first clock without
    // submitting anything. Do not attach media capture to sync or cycle.
    return state.window({ maxPicks: 1, waitMs: 10000 });
  };
  if (!simulation) {
    for (const key of Object.keys(state).filter(key=>typeof state[key]==='function').concat(['version','sessionId','roomId','draftSlot','rules','teamCount','expectedPicks'])) Object.defineProperty(state,key,{writable:false,configurable:false});
    Object.freeze(rules);
  }
  return state;
}

export { createYahooMockLoop };

export function importAcknowledged(card,snapshot,sessionId,expectedPicks) {
  if (card.pending || !card.inputEmpty || card.sessionId!==sessionId) return false;
  if (snapshot.phase==='completed') return card.phase==='completed' && card.reconciled===expectedPicks && snapshot.picks.length===expectedPicks;
  return card.phase!=='completed' && card.pick===snapshot.currentOverall && card.reconciled===snapshot.picks.length;
}
