// Browser actions use only the documented CUA Playwright surface. Evaluation
// reads rendered DOM; it never calls page functions, fetches Yahoo, or changes UI.
const fail = (code, message, details) => { throw Object.assign(new Error(message), { code, ...(details ? { details } : {}) }); };
const yahooId = p => String(p?.yahooPlayerId || p?.yahooPlayerKey?.split('.p.').at(-1) || '');
const teamCode = value => String(value || '').trim().toUpperCase().replace(/^JAX$/, 'JAC').replace(/^WSH$/, 'WAS').replace(/^LAR$/, 'LA');
const defenseTeams = { Cardinals:'ARI', Falcons:'ATL', Ravens:'BAL', Bills:'BUF', Panthers:'CAR', Bears:'CHI', Bengals:'CIN', Browns:'CLE', Cowboys:'DAL', Broncos:'DEN', Lions:'DET', Packers:'GB', Texans:'HOU', Colts:'IND', Jaguars:'JAC', Chiefs:'KC', Raiders:'LV', Chargers:'LAC', Rams:'LA', Dolphins:'MIA', Vikings:'MIN', Patriots:'NE', Saints:'NO', Giants:'NYG', Jets:'NYJ', Eagles:'PHI', Steelers:'PIT', '49ers':'SF', Seahawks:'SEA', Buccaneers:'TB', Titans:'TEN', Commanders:'WAS' };

export function readYahooDocument({ turnOnly = false } = {}) {
  const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const rect = e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height }; };
  const candidates = [...document.querySelectorAll('button')];
  const autos = candidates.filter(b => b.textContent.trim() === 'Autodraft' && visible(b));
  const auto = autos.length===1?autos[0]:null;
  const bodyText = document.body?.innerText || '';
  const observation = { observedAt: new Date().toISOString(), origin: location.origin, path: location.pathname,
    header: bodyText.slice(0,1500), inactivityNotice: bodyText.includes('You have been put into autopick mode due to inactivity.'),
    autodraft: Boolean(auto?.querySelector('[data-icon="checkmark-default"]')), autoKnown: Boolean(auto) };
  if (turnOnly) return observation;
  const buttons = candidates.filter(visible);
  const tab = name => buttons.find(b => b.textContent.trim() === name);
  const tables = [...document.querySelectorAll('table')].filter(visible).map(t => {
    // Yahoo also uses TH-only "Your Turn" separators inside TBODY. Native
    // table collections keep those out of the columns and exclude nested tables.
    const headers = [...(t.tHead?.rows || [])].flatMap(r => [...r.cells].map(e => e.innerText.trim()));
    const kind = headers[0] === 'Pick' && headers[1] === 'Player' ? 'results' : headers.includes('XRank') && headers.includes('Proj Pts') ? 'players' : 'other';
    const dataRows = [...t.tBodies].flatMap(body => [...body.rows]).filter(r => visible(r) && [...r.cells].some(c => c.tagName === 'TD'));
    return { kind, headers, rows: dataRows.map(r => ({
      cells: [...r.cells].map(c => c.innerText), yahooPlayerId: r.querySelector('.ys-player[data-id]')?.getAttribute('data-id'),
      title: r.querySelector('.ys-player [title]')?.getAttribute('title') || null,
      buttons: [...r.querySelectorAll('button')].filter(visible).map(b => ({ text: b.innerText.trim(), title: b.title, disabled: b.disabled }))
    })) };
  });
  const searchElements = [...document.querySelectorAll('input')].filter(e => /search.*player/i.test(e.placeholder || ''));
  const searches = searchElements.map(e => {
    const r=e.getBoundingClientRect(),hit=r.width>0&&r.height>0?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;
    return {placeholder:e.placeholder,value:e.value,...rect(e),visible:Boolean(visible(e)),disabled:e.disabled,
      actionable:Boolean(r.width>=8&&r.height>=8&&hit===e)};
  });
  const resets = buttons.filter(b => b.type === 'reset' || /^(clear|reset)( search)?$/i.test(b.getAttribute('aria-label') || b.title || b.innerText.trim())
    || b.querySelector('[data-icon="close-circle-filled"]')&&searchElements.some(e=>e.parentElement===b.parentElement))
    .map(b => ({ type: b.type, name: b.getAttribute('aria-label') || b.title || b.innerText.trim(), searchIcon:Boolean(b.querySelector('[data-icon="close-circle-filled"]')) }));
  const noticeClosers=buttons.filter(b=>b.querySelector('[data-icon="close-default"]')&&b.parentElement?.parentElement?.innerText?.includes('You have been put into autopick mode due to inactivity.')).length;
  const positionFilters = [...document.querySelectorAll('select')].filter(visible).filter(s => [...s.options].some(o => o.text.trim() === 'All Positions'))
    .map(s => ({ value: s.value, label: s.selectedOptions[0]?.text.trim(), options: [...s.options].map(o => ({ value: o.value, label: o.text.trim() })) }));
  return { ...observation,
    playersSelected: tab('Players')?.getAttribute('aria-selected') === 'true', resultsSelected: tab('Results')?.getAttribute('aria-selected') === 'true',
    roundsSelected: tab('Round by Round')?.getAttribute('aria-selected') === 'true', tables, searches, resets, positionFilters, noticeClosers,
    buttons: buttons.map(b => ({ name: b.getAttribute('aria-label') || b.title || b.innerText.trim(), text: b.innerText.trim(), role: b.getAttribute('role') || 'button' })) };
}

export function parseYahooObservation(raw, identity) {
  if (raw.origin !== identity.origin || raw.path !== identity.path) fail('ROOM_MISMATCH', 'The browser is no longer on the verified Yahoo room route', {
    expected: { origin: identity.origin, path: identity.path }, observed: { origin: raw.origin, path: raw.path }
  });
  const completed = /Draft Complete/i.test(raw.header);
  const waiting = /Draft Starting Soon|Waiting room/i.test(raw.header);
  const phase = completed ? 'completed' : waiting ? 'waiting' : 'drafting';
  const overallPick = completed ? identity.totalPicks + 1 : waiting ? 1 : Number(raw.header.match(/ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1]);
  if (!Number.isInteger(overallPick) || overallPick < 1 || overallPick > identity.totalPicks + 1) fail('ROOM_TURN_UNREADABLE', 'Yahoo current pick is not readable');
  const matches = [...raw.header.matchAll(/(?:^|\n)\s*(\d{1,2}):(\d{2})\s*(?=\n|$)/g)];
  // Yahoo replaces mm:ss with an integer near expiry. Accept that integer only
  // immediately before the current turn label, never from ranks or team text.
  const lines = raw.header.split('\n').map(line => line.trim());
  const turnLine = lines.findIndex(line => /ROUND\s+\d+,\s*PICK\s+\d+/i.test(line));
  const short = turnLine > 0 && /^\d{1,2}$/.test(lines[turnLine-1]) && Number(lines[turnLine-1]) < 60 ? Number(lines[turnLine-1]) : null;
  const secondsLeft = matches.length === 1 && Number(matches[0][2]) < 60 && short === null
    ? Number(matches[0][1]) * 60 + Number(matches[0][2]) : matches.length === 0 ? short : null;
  if (phase === 'drafting' && secondsLeft === null) fail('ROOM_CLOCK_UNREADABLE', 'Yahoo clock is missing or ambiguous');
  return { observedAt: raw.observedAt, phase, overallPick, completedPicks: overallPick - 1, secondsLeft: completed ? null : secondsLeft,
    onClock: phase === 'drafting' && /YOUR TURN\s*•\s*ROUND/i.test(raw.header),
    manualModeKnown: raw.autoKnown && !raw.inactivityNotice, autodraft: raw.autodraft,
    leagueKey: identity.leagueKey, teamKey: identity.teamKey, draftSlot: identity.draftSlot };
}

export function parseYahooRow(row, kind) {
  const parts = String(row.cells[1] || '').split('\n').map(s => s.trim()).filter(Boolean);
  const positionAt = parts.findIndex(s => /^(QB|RB|WR|TE|K|DEF)$/.test(s));
  if (!/^[1-9]\d*$/.test(row.yahooPlayerId || '') || positionAt < 1) fail('PLAYER_IDENTITY_UNREADABLE', 'The visible row lacks a unique Yahoo ID, name or position');
  const player = { yahooPlayerId: row.yahooPlayerId, name: row.title || parts[0], observedName: parts[0], position: parts[positionAt],
    team: teamCode(parts[positionAt] === 'DEF' ? defenseTeams[row.title || parts[0]] || defenseTeams[parts[0]] || parts[positionAt + 1] : parts[positionAt + 1]), injuryStatus: parts.slice(1, positionAt).join(' ') };
  if (!/^[A-Z]{2,4}$/.test(player.team)) fail('PLAYER_TEAM_UNREADABLE', 'The player team is unreadable; a bye-week label is not team evidence');
  if (kind === 'results') return { ...player, overallPick: Number(row.cells[0]), isMine: row.cells[2]?.trim() === 'Your Team' };
  return { ...player, available: true, draftEnabled: row.buttons.filter(b => b.text === 'Draft' && !b.disabled).length === 1 };
}

export function parseYahooRows(raw, kind) {
  if (!['players', 'results'].includes(kind)) fail('ROOM_TABLE_UNVERIFIED', 'Unknown table type');
  const tables = raw.tables.filter(t => t.kind === kind);
  const selected = kind === 'players' ? raw.playersSelected : raw.resultsSelected;
  const header = tables[0]?.headers || [];
  const correct = kind === 'results' ? header.slice(0,3).join('|') === 'Pick|Player|Team'
    : ['Queue', 'Draft'].includes(header[0]) && header.slice(1,6).join('|') === 'Player|XRank|ADP|Bye|Proj Pts';
  if (!selected || tables.length !== 1 || !correct) fail('ROOM_TABLE_UNVERIFIED', 'Verify the selected tab and exact table columns before reading rows');
  // Retained snapshots from the earlier reader may still contain TH-only rows.
  // A nonempty data row without an identity remains an error, never a silent skip.
  return tables.flatMap(t => t.rows)
    .filter(row => row.cells.length || row.yahooPlayerId).map(row => parseYahooRow(row, kind));
}

// Test/browser-assisted import only. This does not provide an independent feed.
// Preserve the oldest source read; building an envelope must not renew its age.
export function parseYahooMockSnapshot({ results, players, identity, rules, teamCount, now = Date.now() }) {
  const board = parseYahooObservation(results, identity);
  const picks = parseYahooRows(results, 'results').sort((a,b) => a.overallPick-b.overallPick);
  if (picks.length !== board.completedPicks || picks.some((p,i) => p.overallPick !== i+1)
      || new Set(picks.map(p=>p.yahooPlayerId)).size !== picks.length) fail('RESULTS_PREFIX_INCOMPLETE', 'The complete board must match the observed turn');
  const complete = board.phase === 'completed';
  const current = complete ? board : parseYahooObservation(players, identity);
  if (!complete && (current.overallPick !== board.overallPick || current.phase !== board.phase)) fail('ROOM_TURN_CHANGED', 'The draft advanced between results and player reads');
  if (!complete && !current.manualModeKnown) fail('ROOM_MANUAL_MODE_UNVERIFIED', 'Observe manual mode and dismiss inactivity notices before importing recommendations');
  const sourceTimes = [Date.parse(results.observedAt), ...(!complete ? [Date.parse(players.observedAt)] : [])];
  if (sourceTimes.some(t=>!Number.isFinite(t)||t>now+1000||now-t>5000)) fail('ROOM_OBSERVATION_STALE', 'The source observation is too old; reread the room');
  const availablePlayers = complete ? [] : parseYahooRows(players, 'players').map((p,i)=>{
    const row=players.tables.find(t=>t.kind==='players').rows.filter(r=>r.cells.length||r.yahooPlayerId)[i];
    return {...p,expertRank:Number(row.cells[2]),adp:Number(row.cells[3]),byeWeek:Number(row.cells[4])||null,projectedPoints:Number(row.cells[5].replaceAll(',',''))};
  });
  if (availablePlayers.some(p=>picks.some(pick=>pick.yahooPlayerId===p.yahooPlayerId))) fail('ROOM_AVAILABILITY_CONFLICT', 'A drafted player is still listed as available');
  return {roomId:identity.path.split('/')[3],draftSlot:identity.draftSlot,teamCount,rules,
    phase:current.phase,autodraft:current.autodraft,observedAt:new Date(Math.min(...sourceTimes)).toISOString(),currentOverall:current.overallPick,picks,availablePlayers,
    observationEvidence:{resultsObservedAt:results.observedAt,playersObservedAt:complete?null:players.observedAt,clockObservedAt:current.observedAt,secondsLeft:current.secondsLeft,onClock:current.onClock},
    deliverySource:'browser-assisted',independentDelivery:false};
}

export function createYahooLiveRoom({ tab, identity, simulation = false, now = Date.now, queueContainerSelector, queueItemSelector = 'li' }) {
  if (!identity?.origin || !identity?.path || !identity.leagueKey || !identity.teamKey || !identity.draftSlot || !identity.totalPicks) fail('ROOM_IDENTITY_REQUIRED', 'Supply the room identity observed during the verified entry handoff');
  const url = new URL(identity.origin);
  if (simulation ? !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) : url.origin !== 'https://football.fantasysports.yahoo.com') fail('ROOM_ORIGIN_INVALID', 'Simulation and live Yahoo origins must remain separate');
  if (!/^\/draftclient\/f1\/\d+\/\d+\/?$/.test(identity.path) || identity.path.split('/')[3] !== identity.leagueKey.split('.l.').at(-1)) fail('ROOM_IDENTITY_REQUIRED', 'The observed room path must match the league');
  const events = [];
  const budget = options => ({ until: now() + (options?.timeoutMs || 4500), signal: options?.signal });
  const left = b => { if (b.signal?.aborted || b.until - now() < 80) fail('ROOM_OPERATION_DEADLINE', 'The browser operation exhausted its time budget'); return Math.max(80, Math.floor(b.until - now())); };
  const inspect = (b, turnOnly = false) => tab.playwright.evaluate(readYahooDocument, { turnOnly }, { timeoutMs: left(b) });
  const namedButton = text => tab.playwright.getByRole('button', { name: text, exact: true });
  function navigation(name, raw) {
    const matches = raw.buttons.filter(button => button.text === name);
    if (matches.length !== 1 || !['tab','button'].includes(matches[0].role || 'button')) fail('ROOM_NAVIGATION_UNAVAILABLE', `Identify the unique visible ${name} tab`);
    return tab.playwright.getByRole(matches[0].role || 'button', { name, exact: true });
  }
  async function waitForView(raw, predicate, b) {
    while (!predicate(raw)) {
      await tab.playwright.waitForTimeout(Math.min(80,left(b)));
      raw = await inspect(b); parseYahooObservation(raw,identity);
    }
    return raw;
  }
  async function selectView(name, raw, selected, b) {
    await navigation(name,raw).press('Enter', { timeoutMs: left(b) });
    raw = await inspect(b); parseYahooObservation(raw,identity);
    const probeUntil = Math.min(b.until-1200,now()+600);
    while (!selected(raw) && now()<probeUntil) {
      await tab.playwright.waitForTimeout(Math.min(80,left(b)));
      raw = await inspect(b); parseYahooObservation(raw,identity);
    }
    if (!selected(raw) && left(b)>=1200) {
      // Selecting an already selected tab is idempotent. One retry is allowed
      // only after input returned and a fresh read still shows the old view.
      // This rule never applies to Draft, Queue, or a rejected input operation.
      raw = await inspect(b); parseYahooObservation(raw,identity);
      if (!selected(raw)) {
        events.push({type:'navigation-retry',control:name,at:new Date(now()).toISOString()});
        await navigation(name,raw).press('Enter', { timeoutMs: left(b) });
        raw = await inspect(b); parseYahooObservation(raw,identity);
      }
    }
    return waitForView(raw,selected,b);
  }
  async function view(name, b) {
    let raw = await inspect(b);
    parseYahooObservation(raw, identity);
    const selected = name === 'Players' ? raw.playersSelected : raw.resultsSelected;
    if (!selected) {
      raw = await selectView(name,raw,r => name === 'Players' ? r.playersSelected : r.resultsSelected,b);
    }
    if (name === 'Results' && !raw.roundsSelected) {
      raw = await waitForView(raw, r => r.roundsSelected || r.buttons.some(button => button.text === 'Round by Round'),b);
      if (!raw.roundsSelected) {
        raw = await selectView('Round by Round',raw,r => r.roundsSelected,b);
      }
    }
    const kind = name.toLowerCase();
    raw = await waitForView(raw, r => r.tables.some(t => t.kind === kind),b);
    return raw;
  }
  const rows = parseYahooRows;
  async function resetSearch(raw, b) {
    if (raw.searches.length !== 1) fail('ROOM_SEARCH_AMBIGUOUS', 'Identify a unique player-search input');
    const search = raw.searches[0];
    if (search.value && (search.width < 8 || !search.visible)) {
      if (raw.resets.length !== 1) fail('ROOM_SEARCH_RESET_UNAVAILABLE', 'The collapsed search needs its visible reset control');
      const reset = raw.resets[0];
      const control = reset.searchIcon ? tab.playwright.getByPlaceholder(search.placeholder,{exact:true})
        .locator('..').locator('button').filter({has:tab.playwright.locator('[data-icon="close-circle-filled"]')})
        : reset.type === 'reset' ? tab.playwright.locator('button[type="reset"]').filter({ visible: true }) : namedButton(reset.name);
      await control.press('Enter', { timeoutMs: left(b) }); raw = await inspect(b);
      events.push({ type: 'collapsed-search-reset', at: new Date(now()).toISOString() });
    }
    if (raw.searches[0].value) {
      if(raw.searches[0].width<8||!raw.searches[0].visible||raw.searches[0].disabled||raw.searches[0].actionable===false)fail('ROOM_SEARCH_UNUSABLE','Player search is not interactive');
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
        if (raw.searches.length !== 1 || !choice.name || raw.searches[0].width<8 || !raw.searches[0].visible || raw.searches[0].disabled || raw.searches[0].actionable===false) fail('ROOM_SEARCH_UNAVAILABLE', 'The preferred player is outside the visible rows and search is unavailable');
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
      .filter({ has: tab.playwright.locator(`.ys-player[data-id="${id}"]`) })
      .locator(`.ys-addqueue[data-id="${id}"]`).getByRole('button');
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
  async function recoverManual(options){
    const b=budget(options);let raw=await inspect(b);parseYahooObservation(raw,identity);
    const phase=name=>events.push({type:'manual-recovery-phase',phase:name,at:new Date(now()).toISOString()});
    phase('observed');
    if(raw.inactivityNotice){
      if(raw.noticeClosers!==1)fail('RECOVERY_NOTICE_AMBIGUOUS','Identify the exact inactivity notice before dismissal');
      await tab.playwright.locator('button:visible').filter({has:tab.playwright.locator('[data-icon="close-default"]')})
        .filter({has:tab.playwright.locator('xpath=../..').filter({hasText:'You have been put into autopick mode due to inactivity.'})}).press('Enter',{timeoutMs:left(b)});
      raw=await inspect(b);parseYahooObservation(raw,identity);
      raw=await waitForView(raw,r=>!r.inactivityNotice,b);
      phase('notice-dismissed');
    }
    if(!raw.autoKnown)fail('RECOVERY_TOGGLE_AMBIGUOUS','Manual mode control is not uniquely known');
    if(raw.autodraft){
      await tab.playwright.locator('button:visible').filter({hasText:/^Autodraft$/}).press('Enter',{timeoutMs:left(b)});
      phase('manual-toggle-sent');
      raw=await inspect(b);parseYahooObservation(raw,identity);
    }
    raw=await waitForView(raw,r=>r.autoKnown&&!r.autodraft&&!r.inactivityNotice,b);
    events.push({type:'manual-mode-verified',at:new Date(now()).toISOString()});return parseYahooObservation(raw,identity);
  }
  return Object.freeze({ version:'selector-2026-09-09-v2', recoverManual, observe: async options => parseYahooObservation(await inspect(budget(options), true), identity), prepare, submit, results,
    enqueue, queue: options => readQueue(budget(options)), inspect: options => inspect(budget(options)), events: () => structuredClone(events) });
}
