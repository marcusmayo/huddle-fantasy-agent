'use strict';

// Load this function definition into the persistent CUA REPL, then pass already
// verified Yahoo and Huddle tab handles. All browser actions use documented CUA
// APIs; page evaluation only reads rendered DOM. This file never joins a room.
function createYahooMockLoop({ yahoo, huddle, roomId, draftSlot, rules }) {
  const state = { yahoo, huddle, roomId, draftSlot, rules, stage: 'prepared', log: [], events: [], pending: null, lastSnapshot: null, completedPicks: null };
  const defenses = { Cardinals:'ARI', Falcons:'ATL', Ravens:'BAL', Bills:'BUF', Panthers:'CAR', Bears:'CHI', Bengals:'CIN', Browns:'CLE', Cowboys:'DAL', Broncos:'DEN', Lions:'DET', Packers:'GB', Texans:'HOU', Colts:'IND', Jaguars:'JAC', Chiefs:'KC', Raiders:'LV', Chargers:'LAC', Rams:'LAR', Dolphins:'MIA', Vikings:'MIN', Patriots:'NE', Saints:'NO', Giants:'NYG', Jets:'NYJ', Eagles:'PHI', Steelers:'PIT', '49ers':'SF', Seahawks:'SEA', Buccaneers:'TB', Titans:'TEN', Commanders:'WAS' };
  const teamKey = value => String(value).toUpperCase().replace(/^JAX$/, 'JAC');
  const ownPick = header => Number(header.match(/YOUR TURN\s*•\s*ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1] || 0);
  const stage = name => { state.stage = name; state.events.push({ stage: name, at: Date.now() }); };
  const player = row => {
    const parts = row.cells[1].split('\n').map(s => s.trim()).filter(Boolean);
    const i = parts.findIndex(s => /^(QB|RB|WR|TE|K|DEF)$/.test(s));
    if (i < 1 || !/^[1-9]\d{0,9}$/.test(row.yahooPlayerId || '')) throw Error('Player row lacks a verified identity');
    return { name: parts[0], position: parts[i], team: teamKey(parts[i] === 'DEF' ? defenses[parts[0]] || parts[i + 1] : parts[i + 1]), injuryStatus: parts.slice(1, i).join(' '), yahooPlayerId: row.yahooPlayerId };
  };
  const button = name => state.yahoo.playwright.locator('button').filter({ hasText: new RegExp(`^${name}$`) });

  state.inspect = async function () {
    return state.yahoo.playwright.evaluate(() => {
      const visible = element => element.getClientRects().length > 0;
      const buttons = [...document.querySelectorAll('button')].filter(visible);
      const tab = name => buttons.find(b => b.textContent.trim() === name);
      const tables = [...document.querySelectorAll('table')].filter(visible);
      const table = tables.find(t => [...t.querySelectorAll('th')].some(h => h.innerText.trim() === 'Player'));
      return {
        header: document.body.innerText.slice(0, 260),
        autodraft: Boolean(tab('Autodraft')?.querySelector('[data-icon="checkmark-default"]')),
        autoKnown: Boolean(tab('Autodraft')),
        playersSelected: tab('Players')?.getAttribute('aria-selected') === 'true',
        resultsSelected: tab('Results')?.getAttribute('aria-selected') === 'true',
        roundsSelected: tab('Round by Round')?.getAttribute('aria-selected') === 'true',
        headers: table ? [...table.querySelectorAll('th')].slice(0, 6).map(h => h.innerText.trim()) : [],
        rows: table ? [...table.querySelectorAll('tbody tr')].map(r => ({ cells: [...r.querySelectorAll('td')].map(c => c.innerText), yahooPlayerId: r.querySelector('.ys-player')?.getAttribute('data-id') })).filter(r => r.cells.length) : []
      };
    }, undefined, { timeoutMs: 6000 });
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
        try { await button(view).click({ timeoutMs: 8000 }); }
        catch (error) { state.events.push({ stage: 'navigation-response-error', view, error: String(error), at: Date.now() }); }
      } else if (view === 'Results' && selected && !data.roundsSelected && subtabSwitches < 2) {
        subtabSwitches += 1;
        try { await button('Round by Round').click({ timeoutMs: 8000 }); }
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
    const picks = data.rows.filter(r => r.cells.length === 3 && /^\d+$/.test(r.cells[0]))
      .map(r => ({ overallPick: Number(r.cells[0]), ...player(r), isMine: r.cells[2].trim() === 'Your Team' }))
      .sort((a, b) => a.overallPick - b.overallPick);
    if (picks.some((p, i) => p.overallPick !== i + 1)) throw Error('Yahoo results contain a pick gap');
    state.resultPicks = picks;
    if (picks.length === 120) state.completedPicks = picks;
    return { data, picks };
  };

  state.capture = async function () {
    const results = await state.results();
    const picks = results.picks;
    const data = picks.length === 120 ? results.data : await state.grid('Players');
    const phase = picks.length === 120 ? 'completed' : /Draft Starting Soon|Waiting room/i.test(data.header) ? 'waiting' : 'drafting';
    const current = Number(data.header.match(/ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1] || 0);
    if (phase === 'drafting' && current !== picks.length + 1) return { retry: true, header: data.header, count: picks.length };
    if (phase !== 'completed' && !data.autoKnown) throw Error('Yahoo Autodraft state is not visible');
    const snapshot = { roomId: state.roomId, draftSlot: state.draftSlot, teamCount: 8, rules: state.rules, phase, autodraft: data.autodraft, observedAt: new Date().toISOString(), currentOverall: picks.length + 1, picks,
      availablePlayers: phase === 'completed' ? [] : data.rows.filter(r => r.cells.length > 5).map(r => ({ ...player(r), expertRank: Number(r.cells[2]), adp: Number(r.cells[3]), projectedPoints: Number(r.cells[5].replaceAll(',', '')) })) };
    state.lastSnapshot = snapshot;
    return { snapshot, header: data.header };
  };

  state.sync = async function (snapshot, { requireRecommendation = true } = {}) {
    stage('import-huddle');
    await state.huddle.playwright.locator('#mock-snapshot-input').fill(JSON.stringify(snapshot), { timeoutMs: 8000 });
    await state.huddle.playwright.locator('#mock-snapshot-submit').click({ timeoutMs: 8000 });
    const deadline = Date.now() + 8000;
    let card;
    do {
      card = await state.huddle.playwright.evaluate(() => ({
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
        roster: document.querySelector('#mock-roster-coverage')?.textContent
      }), undefined, { timeoutMs: 6000 });
      if (!card.pending && /^Import stopped:/.test(card.error || '')) throw Error(card.error);
      if (!card.pending && card.inputEmpty && card.pick === snapshot.currentOverall) {
        state.card = card;
        if (requireRecommendation && snapshot.phase === 'drafting' && !snapshot.autodraft && !card.ready) throw Error(`Huddle not ready: ${card.status}`);
        return card;
      }
      await state.huddle.playwright.waitForTimeout(120);
    } while (Date.now() < deadline);
    throw Error(`Huddle import did not complete: ${JSON.stringify(card)}`);
  };

  state.cycle = async function () {
    const started = Date.now();
    const initial = await state.inspect();
    const pick = ownPick(initial.header);
    if (!pick) return { waiting: true, header: initial.header };
    if (!initial.autoKnown || initial.autodraft) return { blocked: 'Autodraft must be visibly OFF', header: initial.header };
    const secondsAtStart = Number(initial.header.match(/(?:^|\n)(?:00:)?(\d{1,2})(?:\n|$)/)?.[1] || 0);
    if (!secondsAtStart) return { blocked: 'The pick countdown is not readable', header: initial.header };
    const captured = await state.capture();
    if (captured.retry) return captured;
    const snapshot = captured.snapshot;
    if (snapshot.currentOverall !== pick || snapshot.autodraft) return { retry: true, header: captured.header };
    const card = await state.sync(snapshot);
    if (!/^[1-9]\d{0,9}$/.test(card.yahooPlayerId || '')) throw Error('Huddle preferred player lacks a Yahoo ID');
    const fresh = await state.inspect();
    const rows = fresh.rows.filter(r => r.yahooPlayerId === card.yahooPlayerId && r.cells.length > 5);
    const position = card.meta.split('·')[0].trim();
    if (ownPick(fresh.header) !== pick || fresh.autodraft || !fresh.playersSelected || rows.length !== 1) return { blocked: 'Live turn or available player changed', header: fresh.header };
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
    const entry = { pick, name: card.name, ...identity, elapsedMs: Date.now() - started, secondsAtStart, submittedAt: state.pending.submittedAt, accepted: true, rosterBeforePick: card.roster };
    state.log.push(entry);
    state.pending = null;
    // Persist the accepted pick immediately. No candidate availability is
    // inferred from the Results view; the next capture supplies a fresh pool.
    const current = Number(accepted.data.header.match(/ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1] || 0);
    if (accepted.picks.length === 120 || current === accepted.picks.length + 1) {
      const receipt = { ...snapshot, phase: accepted.picks.length === 120 ? 'completed' : 'drafting',
        picks: accepted.picks, currentOverall: accepted.picks.length + 1, availablePlayers: [],
        autodraft: accepted.data.autodraft, observedAt: new Date().toISOString() };
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
      if (/Draft Complete/.test(data.header) || data.autodraft) break;
      if (Date.now() < deadline) await state.yahoo.playwright.waitForTimeout(600);
    } while (Date.now() < deadline);
    return { manualVerified: state.log.length, waiting: true, autodraft: data.autodraft, header: data.header };
  };

  state.complete = async function () {
    const captured = await state.capture();
    if (!captured.snapshot || captured.snapshot.picks.length !== 120) throw Error('The complete 120-pick board is not available');
    const card = await state.sync(captured.snapshot);
    return { reconciled: 120, owned: captured.snapshot.picks.filter(p => p.isMine).length, manuallyVerified: state.log.length, roster: card.roster, picks: captured.snapshot.picks, timings: state.log };
  };
  return state;
}

if (typeof module !== 'undefined') module.exports = { createYahooMockLoop };
