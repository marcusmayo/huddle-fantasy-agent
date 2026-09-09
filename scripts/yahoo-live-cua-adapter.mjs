// Browser actions use only the documented CUA Playwright surface. Evaluation
// reads rendered DOM; it never calls page functions, fetches Yahoo, or changes UI.
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const yahooId = p => String(p?.yahooPlayerId || p?.yahooPlayerKey?.split('.p.').at(-1) || '');
const teamCode = value => String(value || '').trim().toUpperCase().replace(/^JAX$/, 'JAC').replace(/^WSH$/, 'WAS').replace(/^LAR$/, 'LA');

export function readYahooDocument() {
  const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const rect = e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height }; };
  const buttons = [...document.querySelectorAll('button')].filter(visible);
  const tab = name => buttons.find(b => b.textContent.trim() === name);
  const tables = [...document.querySelectorAll('table')].filter(visible).map(t => {
    const headers = [...t.querySelectorAll('th')].map(e => e.innerText.trim());
    const kind = headers[0] === 'Pick' && headers[1] === 'Player' ? 'results' : headers.includes('XRank') && headers.includes('Proj Pts') ? 'players' : 'other';
    return { kind, headers, rows: [...t.querySelectorAll('tbody tr')].filter(visible).map(r => ({
      cells: [...r.querySelectorAll('td')].map(c => c.innerText), yahooPlayerId: r.querySelector('.ys-player[data-id]')?.getAttribute('data-id'),
      title: r.querySelector('.ys-player [title]')?.getAttribute('title') || null,
      buttons: [...r.querySelectorAll('button')].filter(visible).map(b => ({ text: b.innerText.trim(), title: b.title, disabled: b.disabled }))
    })) };
  });
  const searches = [...document.querySelectorAll('input')].filter(e => /search.*player/i.test(e.placeholder || '')).map(e => ({
    placeholder: e.placeholder, value: e.value, ...rect(e), visible: Boolean(visible(e)), disabled: e.disabled
  }));
  const resets = buttons.filter(b => b.type === 'reset' || /^(clear|reset)( search)?$/i.test(b.getAttribute('aria-label') || b.title || b.innerText.trim()))
    .map(b => ({ type: b.type, name: b.getAttribute('aria-label') || b.title || b.innerText.trim() }));
  const positionFilters = [...document.querySelectorAll('select')].filter(visible).filter(s => [...s.options].some(o => o.text.trim() === 'All Positions'))
    .map(s => ({ value: s.value, label: s.selectedOptions[0]?.text.trim(), options: [...s.options].map(o => ({ value: o.value, label: o.text.trim() })) }));
  return { observedAt: new Date().toISOString(), origin: location.origin, path: location.pathname,
    header: document.body?.innerText.slice(0, 1500) || '', inactivityNotice: document.body?.innerText.includes('You have been put into autopick mode due to inactivity.') || false,
    autodraft: Boolean(tab('Autodraft')?.querySelector('[data-icon="checkmark-default"]')), autoKnown: Boolean(tab('Autodraft')),
    playersSelected: tab('Players')?.getAttribute('aria-selected') === 'true', resultsSelected: tab('Results')?.getAttribute('aria-selected') === 'true',
    roundsSelected: tab('Round by Round')?.getAttribute('aria-selected') === 'true', tables, searches, resets, positionFilters,
    buttons: buttons.map(b => ({ name: b.getAttribute('aria-label') || b.title || b.innerText.trim(), text: b.innerText.trim() })) };
}

export function parseYahooObservation(raw, identity) {
  if (raw.origin !== identity.origin || raw.path !== identity.path) fail('ROOM_MISMATCH', 'The browser is no longer on the verified Yahoo room route');
  const completed = /Draft Complete/i.test(raw.header);
  const waiting = /Draft Starting Soon|Waiting room/i.test(raw.header);
  const phase = completed ? 'completed' : waiting ? 'waiting' : 'drafting';
  const overallPick = completed ? identity.totalPicks + 1 : waiting ? 1 : Number(raw.header.match(/ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1]);
  if (!Number.isInteger(overallPick) || overallPick < 1 || overallPick > identity.totalPicks + 1) fail('ROOM_TURN_UNREADABLE', 'Yahoo current pick is not readable');
  const matches = [...raw.header.matchAll(/(?:^|\n)\s*(\d{1,2}):(\d{2})\s*(?=\n|$)/g)];
  const secondsLeft = matches.length === 1 ? Number(matches[0][1]) * 60 + Number(matches[0][2]) : null;
  if (phase === 'drafting' && secondsLeft === null) fail('ROOM_CLOCK_UNREADABLE', 'Yahoo clock is missing or ambiguous');
  return { observedAt: raw.observedAt, phase, overallPick, completedPicks: overallPick - 1, secondsLeft,
    onClock: phase === 'drafting' && /YOUR TURN\s*•\s*ROUND/i.test(raw.header),
    manualModeKnown: raw.autoKnown && !raw.inactivityNotice, autodraft: raw.autodraft,
    leagueKey: identity.leagueKey, teamKey: identity.teamKey, draftSlot: identity.draftSlot };
}

export function parseYahooRow(row, kind) {
  const parts = String(row.cells[1] || '').split('\n').map(s => s.trim()).filter(Boolean);
  const positionAt = parts.findIndex(s => /^(QB|RB|WR|TE|K|DEF)$/.test(s));
  if (!/^[1-9]\d*$/.test(row.yahooPlayerId || '') || positionAt < 1) fail('PLAYER_IDENTITY_UNREADABLE', 'The visible row lacks a unique Yahoo ID, name or position');
  const player = { yahooPlayerId: row.yahooPlayerId, name: row.title || parts[0], observedName: parts[0], position: parts[positionAt],
    team: teamCode(parts[positionAt + 1]), injuryStatus: parts.slice(1, positionAt).join(' ') };
  if (kind === 'results') return { ...player, overallPick: Number(row.cells[0]), isMine: row.cells[2]?.trim() === 'Your Team' };
  return { ...player, available: true, draftEnabled: row.buttons.filter(b => b.text === 'Draft' && !b.disabled).length === 1 };
}

export function createYahooLiveRoom({ tab, identity, simulation = false, now = Date.now, queueContainerSelector, queueItemSelector = 'li' }) {
  if (!identity?.origin || !identity?.path || !identity.leagueKey || !identity.teamKey || !identity.draftSlot || !identity.totalPicks) fail('ROOM_IDENTITY_REQUIRED', 'Supply the room identity observed during the verified entry handoff');
  const url = new URL(identity.origin);
  if (simulation ? !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) : url.origin !== 'https://football.fantasysports.yahoo.com') fail('ROOM_ORIGIN_INVALID', 'Simulation and live Yahoo origins must remain separate');
  if (!/^\/draftclient\/f1\/\d+\/\d+\/?$/.test(identity.path) || identity.path.split('/')[3] !== identity.leagueKey.split('.l.').at(-1)) fail('ROOM_IDENTITY_REQUIRED', 'The observed room path must match the league');
  const events = [];
  const budget = options => ({ until: now() + (options?.timeoutMs || 4500), signal: options?.signal });
  const left = b => { if (b.signal?.aborted || b.until - now() < 80) fail('ROOM_OPERATION_DEADLINE', 'The browser operation exhausted its time budget'); return Math.max(80, Math.floor(b.until - now())); };
  const inspect = b => tab.playwright.evaluate(readYahooDocument, undefined, { timeoutMs: left(b) });
  const namedButton = text => tab.playwright.getByRole('button', { name: text, exact: true });
  async function view(name, b) {
    let raw = await inspect(b);
    parseYahooObservation(raw, identity);
    const selected = name === 'Players' ? raw.playersSelected : raw.resultsSelected;
    if (!selected) {
      if (!raw.buttons.some(button => button.text === name)) fail('ROOM_NAVIGATION_UNAVAILABLE', `The ${name} control is not visible`);
      await namedButton(name).press('Enter', { timeoutMs: left(b) }); raw = await inspect(b);
    }
    if (name === 'Results' && !raw.roundsSelected && raw.buttons.some(button => button.text === 'Round by Round')) {
      await namedButton('Round by Round').press('Enter', { timeoutMs: left(b) }); raw = await inspect(b);
    }
    const kind = name.toLowerCase();
    if (!raw.tables.some(t => t.kind === kind)) fail('ROOM_TABLE_UNAVAILABLE', `The ${name} table has not rendered`);
    return raw;
  }
  const rows = (raw, kind) => raw.tables.filter(t => t.kind === kind).flatMap(t => t.rows).map(r => parseYahooRow(r, kind));
  async function resetSearch(raw, b) {
    if (raw.searches.length !== 1) fail('ROOM_SEARCH_AMBIGUOUS', 'Identify a unique player-search input');
    const search = raw.searches[0];
    if (search.value && (search.width < 8 || !search.visible)) {
      if (raw.resets.length !== 1) fail('ROOM_SEARCH_RESET_UNAVAILABLE', 'The collapsed search needs its visible reset control');
      const reset = raw.resets[0];
      const control = reset.type === 'reset' ? tab.playwright.locator('button[type="reset"]').filter({ visible: true }) : namedButton(reset.name);
      await control.press('Enter', { timeoutMs: left(b) }); raw = await inspect(b);
      events.push({ type: 'collapsed-search-reset', at: new Date(now()).toISOString() });
    }
    if (raw.searches[0]?.width < 8 || !raw.searches[0]?.visible || raw.searches[0]?.disabled) fail('ROOM_SEARCH_UNUSABLE', 'Player search remains collapsed after reset');
    if (raw.searches[0].value) {
      await tab.playwright.getByPlaceholder(raw.searches[0].placeholder, { exact: true }).fill('', { timeoutMs: left(b) }); raw = await inspect(b);
    }
    if (raw.positionFilters.length === 1 && raw.positionFilters[0].label !== 'All Positions') {
      const filters = tab.playwright.locator('select').filter({ has: tab.playwright.locator('option').filter({ hasText: /^All Positions$/ }) });
      await filters.selectOption({ label: 'All Positions' }, { timeoutMs: left(b) }); raw = await inspect(b);
    }
    return raw;
  }
  async function prepare(choices, options) {
    const b = budget(options); let raw = await view('Players', b); const found = [];
    for (const choice of choices) {
      const id = yahooId(choice);
      if (!/^[1-9]\d*$/.test(id)) fail('PLAYER_IDENTITY_REQUIRED', 'A numeric Yahoo ID is required for search');
      let matches = rows(raw, 'players').filter(p => p.yahooPlayerId === id);
      if (!matches.length) {
        raw = await resetSearch(raw, b);
        matches = rows(raw, 'players').filter(p => p.yahooPlayerId === id);
      }
      if (!matches.length) {
        if (raw.searches.length !== 1 || !choice.name) fail('ROOM_SEARCH_UNAVAILABLE', 'The preferred player is outside the visible rows and search is unavailable');
        await tab.playwright.getByPlaceholder(raw.searches[0].placeholder, { exact: true }).fill(choice.name, { timeoutMs: left(b) });
        raw = await inspect(b); matches = rows(raw, 'players').filter(p => p.yahooPlayerId === id);
      }
      if (matches.length !== 1 || matches[0].position !== choice.position) fail('PLAYER_IDENTITY_MISMATCH', 'Search did not return exactly the requested numeric ID and position');
      const observed = matches[0];
      if (choice.team && observed.position !== 'DEF' && teamCode(choice.team) !== observed.team) fail('PLAYER_TEAM_MISMATCH', 'The exact player ID has conflicting team evidence');
      found.push(observed);
    }
    return { observation: parseYahooObservation(raw, identity), players: found };
  }
  async function submit(input, options) {
    const b = budget(options), raw = await inspect(b), o = parseYahooObservation(raw, identity);
    if (!o.manualModeKnown || o.autodraft || !o.onClock || o.overallPick !== input.overallPick
      || o.leagueKey !== input.leagueKey || o.teamKey !== input.teamKey || now() >= input.deadline) fail('SUBMIT_TURN_CHANGED', 'The exact owned turn, manual mode or deadline changed before input');
    const matches = rows(raw, 'players').filter(p => p.yahooPlayerId === String(input.yahooPlayerId));
    if (!raw.playersSelected || matches.length !== 1 || !matches[0].draftEnabled || matches[0].position !== input.position) fail('SUBMIT_PLAYER_CHANGED', 'The exact visible Draft control is no longer available');
    const target = tab.playwright.locator('table tbody tr').filter({ visible: true })
      .filter({ has: tab.playwright.locator(`.ys-player[data-id="${input.yahooPlayerId}"]`) }).getByRole('button', { name: 'Draft', exact: true });
    // Focused keyboard activation avoids a moving row crossing the pointer.
    // The locator is resolved by identity at activation, never by row index.
    await target.press('Enter', { timeoutMs: Math.min(left(b), Math.max(80, input.deadline - now())) });
    const after = await inspect(b);
    events.push({ type: 'exact-id-input-returned', at: new Date(now()).toISOString(), yahooPlayerId: input.yahooPlayerId, overallPick: input.overallPick });
    return { observation: parseYahooObservation(after, identity) };
  }
  async function results(options) {
    const b = budget(options), raw = await view('Results', b), observation = parseYahooObservation(raw, identity);
    const picks = rows(raw, 'results').sort((a, z) => a.overallPick - z.overallPick);
    if (picks.some((p, i) => p.overallPick !== i + 1) || picks.length !== observation.completedPicks
      || new Set(picks.map(p => p.yahooPlayerId)).size !== picks.length) fail('RESULTS_PREFIX_INCOMPLETE', 'Read the full current Results table before reconciling');
    return { ...observation, picks };
  }
  async function readQueue(b) {
    if (!queueContainerSelector) fail('QUEUE_NOT_CONFIGURED', 'Identify the actual visible queue container before using queue controls');
    return tab.playwright.locator(queueContainerSelector).evaluate((container, itemSelector) => [...container.querySelectorAll(itemSelector)].map(item => {
      const player = item.querySelector('.ys-player[data-id]');
      return player ? { yahooPlayerId: player.getAttribute('data-id'), text: player.innerText } : null;
    }).filter(Boolean), queueItemSelector, { timeoutMs: left(b) });
  }
  async function enqueue(choice, options) {
    const b = budget(options), id = yahooId(choice);
    await prepare([choice], { timeoutMs: left(b), signal: b.signal });
    const before = await readQueue(b), priorIds = before.map(p => p.yahooPlayerId);
    if (priorIds.includes(id)) return { verified: true, alreadyQueued: true, yahooPlayerId: id };
    const target = tab.playwright.locator('table tbody tr').filter({ visible: true })
      .filter({ has: tab.playwright.locator(`.ys-player[data-id="${id}"]`) }).getByRole('button', { name: 'Queue', exact: true });
    let responseError;
    try { await target.press('Enter', { timeoutMs: left(b) }); } catch (e) { responseError = e; }
    const after = await readQueue(b), afterIds = after.map(p => p.yahooPlayerId), added = afterIds.filter(value => !priorIds.includes(value));
    if (added.length === 1 && added[0] === id && priorIds.every(value => afterIds.includes(value)) && afterIds.length === priorIds.length + 1) {
      events.push({ type: 'queue-verified', yahooPlayerId: id, at: new Date(now()).toISOString(), responseUncertain: Boolean(responseError) });
      return { verified: true, yahooPlayerId: id };
    }
    // Remove only additions from this mutation, using their observed identities.
    // Existing queue entries are never cleared as a recovery shortcut.
    for (const addedId of added) {
      await tab.playwright.locator(queueContainerSelector).locator(queueItemSelector)
        .filter({ has: tab.playwright.locator(`.ys-player[data-id="${addedId}"]`) }).getByRole('button', { name: 'Remove', exact: true }).press('Enter', { timeoutMs: left(b) });
      await readQueue(b);
    }
    const restored = await readQueue(b);
    const restoredIds = restored.map(p => p.yahooPlayerId);
    events.push({ type: 'queue-mismatch', intended: id, added, restored: JSON.stringify(restoredIds) === JSON.stringify(priorIds), at: new Date(now()).toISOString() });
    fail('QUEUE_VERIFICATION_FAILED', 'The actual queue did not match the requested player; no draft input was sent');
  }
  return { observe: async options => parseYahooObservation(await inspect(budget(options)), identity), prepare, submit, results,
    enqueue, queue: options => readQueue(budget(options)), inspect: options => inspect(budget(options)), events: () => structuredClone(events) };
}
