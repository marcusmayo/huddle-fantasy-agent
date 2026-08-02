'use strict';

const state = {
  leagues: [],
  defaultLeagueId: null,
  leagueId: null,
  league: null,
  session: null,
  recommendation: null,
  availablePlayers: [],
  selectedPlayerId: null,
  searchDirty: false,
  screenshotObjectUrl: null,
  screenshotFile: null,
  screenshotCandidates: [],
  providerStatus: null,
  providerStatusAt: 0,
  timer: null
};
const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Request failed');
  return body;
}

function scoped(path = '') {
  return `/api/leagues/${encodeURIComponent(state.leagueId)}${path}`;
}

function sessionKey() {
  return `huddle-session-id:${state.leagueId}`;
}

function playerLabel(player) {
  return `${player.name} · ${player.position} · ${player.team}`;
}

function findPlayer(value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return null;
  return state.availablePlayers.find((player) =>
    String(player.id).toLowerCase() === needle ||
    player.name.toLowerCase() === needle ||
    playerLabel(player).toLowerCase() === needle
  ) || null;
}

function syncPlayerHighlights() {
  document.querySelectorAll('[data-player-id]').forEach((element) => {
    const selected = element.dataset.playerId === state.selectedPlayerId;
    element.classList.toggle('selected-player', selected);
    element.setAttribute('aria-pressed', String(selected));
  });
}

function selectPlayer(playerId, announce = false) {
  const player = state.availablePlayers.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  state.selectedPlayerId = player.id;
  state.searchDirty = false;
  $('#player-search').value = playerLabel(player);
  syncPlayerHighlights();
  if (announce) $('#pick-message').textContent = `${player.name} selected. Confirm whether this was your pick, then record it.`;
  return true;
}

function makePlayerSelectable(element, player) {
  if (!element) return;
  element.classList.toggle('player-selectable', Boolean(player));
  if (!player) {
    element.onclick = null;
    element.onkeydown = null;
    element.removeAttribute('data-player-id');
    element.removeAttribute('role');
    element.removeAttribute('tabindex');
    element.removeAttribute('aria-label');
    return;
  }
  element.dataset.playerId = player.id;
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', `Select ${player.name} as the drafted player`);
  element.onclick = () => selectPlayer(player.id, true);
  element.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPlayer(player.id, true);
    }
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function renderLeagueFleet() {
  $('#fleet-mode').textContent = `${state.leagues.length} active league${state.leagues.length === 1 ? '' : 's'} · isolated state`;
  $('#league-grid').innerHTML = state.leagues.map((league) => `
    <button class="league-card ${league.id === state.leagueId ? 'active' : ''}" data-league-id="${escapeHtml(league.id)}">
      <span class="league-state"><i></i>${league.activeSessions ? `${league.activeSessions} active draft` : 'ready'}</span>
      <strong>${escapeHtml(league.name)}</strong>
      <span>${escapeHtml(league.targetTeam)} · ${league.teamCount} teams</span>
      <small>Yahoo ${escapeHtml(league.id)} · ${league.sessions} session${league.sessions === 1 ? '' : 's'}</small>
    </button>`).join('');
  document.querySelectorAll('.league-card').forEach((card) => {
    card.addEventListener('click', () => selectLeague(card.dataset.leagueId));
  });
}

async function loadFleet() {
  const fleet = await api('/api/leagues');
  state.leagues = fleet.leagues;
  state.defaultLeagueId = fleet.defaultLeagueId;
  const saved = localStorage.getItem('huddle-active-league');
  const selected = state.leagues.some((league) => league.id === saved) ? saved : state.defaultLeagueId;
  $('#league-select').innerHTML = state.leagues.map((league) =>
    `<option value="${escapeHtml(league.id)}">${escapeHtml(league.name)} · ${escapeHtml(league.targetTeam)}</option>`
  ).join('');
  await selectLeague(selected);
}

async function selectLeague(leagueId) {
  if (!state.leagues.some((league) => league.id === leagueId)) return;
  clearInterval(state.timer);
  state.leagueId = leagueId;
  state.session = null;
  localStorage.setItem('huddle-active-league', leagueId);
  $('#league-select').value = leagueId;
  state.league = await api(scoped());
  $('#league-name').textContent = `${state.league.name} · ${state.league.targetTeam}`;
  $('#draft-slot').max = state.league.teamCount;
  $('#draft-room').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  $('#sync-label').textContent = 'Ready · recommendation only';
  renderLeagueFleet();

  let sessionId = localStorage.getItem(sessionKey());
  if (!sessionId && leagueId === state.defaultLeagueId) {
    sessionId = localStorage.getItem('huddle-session-id');
    if (sessionId) localStorage.setItem(sessionKey(), sessionId);
  }
  if (sessionId) await resumeSession(sessionId);
}

async function createSession(event) {
  event.preventDefault();
  const session = await api(scoped('/draft/sessions'), {
    method: 'POST',
    body: JSON.stringify({ draftSlot: Number($('#draft-slot').value), sourceMode: $('#source-mode').value })
  });
  localStorage.setItem(sessionKey(), session.id);
  state.session = session;
  showDraftRoom();
  await refresh();
  startPolling();
  await refreshFleetSummary();
}

async function resumeSession(id) {
  try {
    state.session = await api(scoped(`/draft/sessions/${id}`));
    showDraftRoom();
    await refresh();
    startPolling();
  } catch {
    localStorage.removeItem(sessionKey());
  }
}

function showDraftRoom() {
  $('#setup').classList.add('hidden');
  $('#draft-room').classList.remove('hidden');
  $('#sync-label').textContent = `${state.session.sourceMode} sync · ${state.league.name}`;
  const screenshotMode = state.session.sourceMode === 'screenshot';
  $('#screenshot-assistant').classList.toggle('hidden', !screenshotMode);
  $('#reconcile-help').textContent = screenshotMode
    ? 'Analyze a Yahoo draft-log screenshot, review every extracted candidate, then apply only the confirmed picks. Recommendations refresh from confirmed draft state.'
    : 'Until Yahoo OAuth is connected, record each selection here. The board refreshes immediately.';
  if (screenshotMode) {
    const configured = Boolean(state.providerStatus?.vision?.configured);
    $('#analyze-screenshot').disabled = !configured || !state.screenshotFile;
    $('#screenshot-message').textContent = configured
      ? 'Choose a Yahoo draft-log screenshot. It is sent transiently to OpenRouter only after you click Analyze screenshot.'
      : 'Preview only: set OPENROUTER_API_KEY and restart Huddle to enable screenshot analysis.';
  }
}

function renderChoice(prefix, choice) {
  $(`#${prefix}-name`).textContent = choice ? choice.player.name : '—';
  $(`#${prefix}-meta`).textContent = choice ? `${choice.player.position} · ${choice.score} score` : '';
}

function renderRecommendation(card) {
  state.recommendation = card;
  $('#current-pick').textContent = card.currentOverall;
  $('#next-turn').textContent = card.nextUserPick || 'slot required';
  $('#coverage').textContent = card.evidence.complete ? card.evidence.source : 'Incomplete';
  $('#clock-state').textContent = card.onClock ? 'YOU ARE ON THE CLOCK' : 'Watching the room';
  $('#clock-state').classList.toggle('hot', card.onClock);
  $('#evidence-warning').classList.toggle('hidden', !card.evidence.warning);
  $('#evidence-warning').textContent = card.evidence.warning || '';
  renderBoardEvidence(card);
  const preferred = card.preferred;
  $('#preferred-name').textContent = preferred?.player.name || 'No eligible player';
  $('#preferred-meta').textContent = preferred ? `${preferred.player.position} · ${preferred.player.team} · ADP ${preferred.player.adp ?? '—'}` : '';
  $('#preferred-score').textContent = preferred?.score ?? '—';
  $('#preferred-why').innerHTML = (preferred?.why || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  $('#explanation').textContent = card.explanation;
  renderChoice('safe', card.alternatives.safe);
  renderChoice('upside', card.alternatives.upside);
  makePlayerSelectable(document.querySelector('.hero-card'), preferred?.player);
  makePlayerSelectable(document.querySelector('.choice.safe'), card.alternatives.safe?.player);
  makePlayerSelectable(document.querySelector('.choice.upside'), card.alternatives.upside?.player);
  $('#updated-at').textContent = `Updated ${new Date(card.generatedAt).toLocaleTimeString()}`;
  $('#board-body').innerHTML = card.board.map((item, index) => `
    <tr class="board-player" data-player-id="${escapeHtml(item.player.id)}" tabindex="0" role="button" aria-label="Select ${escapeHtml(item.player.name)} as the drafted player">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(item.player.name)}</strong><small>${escapeHtml(item.player.team)}</small></td>
      <td><span class="position">${escapeHtml(item.player.position)}</span></td>
      <td><strong>${item.score}</strong></td>
      <td>${Math.round(item.waitProbability * 100)}%</td>
      <td>${item.sleeper ? '<span class="badge">SLEEPER</span>' : ''}</td>
    </tr>`).join('');
  document.querySelectorAll('.board-player').forEach((row) => {
    row.addEventListener('click', () => selectPlayer(row.dataset.playerId, true));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPlayer(row.dataset.playerId, true);
      }
    });
  });
  syncPlayerHighlights();
}

function renderBoardEvidence(card) {
  const evidence = card.evidence || {};
  const league = evidence.league || {};
  const offense = league.scoring?.offense || {};
  const roster = Object.entries(league.roster || {})
    .filter(([, count]) => count > 0)
    .map(([slot, count]) => `${slot} ${count}`)
    .join(' · ');
  const weights = Object.entries(evidence.ranking?.weights || {})
    .map(([factor, weight]) => `${factor} ${Math.round(weight * 100)}%`)
    .join(' · ');
  const sourceTime = evidence.fetchedAt ? new Date(evidence.fetchedAt).toLocaleString() : 'Bundled fixture';
  const refresh = state.providerStatus?.fantasyPros?.autoRefresh;
  const quota = refresh?.quota;
  const vision = state.providerStatus?.vision;
  const rows = [
    ['Player evidence', `${evidence.source || 'unknown'} · ${evidence.season || 'season unknown'} · ${evidence.complete ? 'complete' : 'incomplete'}`],
    ['Evidence timestamp', sourceTime],
    ['League context', `${league.name || state.league.name} · ${league.teamCount || state.league.teamCount} teams · ${league.scoringType || state.league.scoringType}`],
    ['Roster demand', roster || 'Not available'],
    ['Scoring inputs', `${offense.reception ?? '—'} PPR · ${offense.passingTouchdown ?? '—'} pass-TD points · ${offense.passingYardsPerPoint ?? '—'} pass yards/point`],
    ['Player inputs', (evidence.ranking?.playerInputs || []).join(' · ')],
    ['Factor weights', weights || 'Not available'],
    ['Computed logic', (evidence.ranking?.computedFactors || []).join(' · ')],
    ['FantasyPros refresh', refresh && quota ? `${refresh.enabled ? `automatic every ${refresh.intervalHours}h` : 'manual/cache only'} · ${quota.estimatedUsed}/${quota.budget} local daily request budget used` : 'Status unavailable'],
    ['Screenshot vision', vision ? `${vision.configured ? 'enabled' : 'not configured'} · ${vision.provider} · ${vision.model} · confirmation required` : 'Status unavailable'],
    ['Draft state', `Pick ${card.currentOverall} · slot ${card.draftSlot || '—'} · next turn ${card.nextUserPick || '—'} · ${state.session.picks.length} confirmed picks`],
    ['Execution', 'Recommendation only; Huddle cannot submit a Yahoo pick']
  ];
  $('#evidence-details').innerHTML = rows.map(([label, value]) => `
    <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function reviewScreenshot(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    $('#screenshot-message').textContent = 'Choose a PNG, JPEG, or WebP image.';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    $('#screenshot-message').textContent = 'Screenshot exceeds the 5 MB review limit.';
    event.target.value = '';
    return;
  }
  if (state.screenshotObjectUrl) URL.revokeObjectURL(state.screenshotObjectUrl);
  state.screenshotFile = file;
  state.screenshotCandidates = [];
  state.screenshotObjectUrl = URL.createObjectURL(file);
  $('#screenshot-image').src = state.screenshotObjectUrl;
  $('#screenshot-meta').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  $('#screenshot-preview').classList.remove('hidden');
  $('#screenshot-results').classList.add('hidden');
  const configured = Boolean(state.providerStatus?.vision?.configured);
  $('#analyze-screenshot').disabled = !configured;
  $('#screenshot-message').textContent = configured
    ? 'Preview ready. Click Analyze screenshot to send it transiently through OpenRouter; no extracted pick is applied automatically.'
    : 'Preview ready, but vision is disabled until OPENROUTER_API_KEY is configured.';
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The screenshot could not be read'));
    reader.readAsDataURL(file);
  });
}

function candidatePlayerValue(candidate) {
  const player = state.availablePlayers.find((item) => item.id === candidate.playerId);
  return player ? playerLabel(player) : candidate.playerName;
}

function renderScreenshotAnalysis(analysis) {
  state.screenshotCandidates = analysis.candidates || [];
  $('#screenshot-summary').textContent = `${analysis.screenshotType.replaceAll('_', ' ')} · ${analysis.summary || 'Analysis complete.'}`;
  $('#screenshot-warnings').innerHTML = (analysis.warnings || []).map((warning) => `<p>${escapeHtml(warning)}</p>`).join('');
  $('#screenshot-candidates').innerHTML = state.screenshotCandidates.map((candidate, index) => `
    <article class="vision-candidate" data-candidate-index="${index}">
      <header><span>Pick ${candidate.overallPick || 'unknown'}</span><span>${Math.round(candidate.confidence * 100)}% · ${escapeHtml(candidate.status)}</span></header>
      <input type="search" list="player-options" data-candidate-player value="${escapeHtml(candidatePlayerValue(candidate))}" aria-label="Player for extracted pick ${candidate.overallPick || index + 1}">
      <label class="check"><input type="checkbox" data-candidate-include ${candidate.actionable ? 'checked' : ''}> Include this pick</label>
      <label class="check"><input type="checkbox" data-candidate-mine ${candidate.isMine ? 'checked' : ''}> This was my pick</label>
    </article>`).join('');
  $('#apply-screenshot-picks').classList.toggle('hidden', !state.screenshotCandidates.length);
  $('#screenshot-results').classList.remove('hidden');
}

async function analyzeScreenshot() {
  if (!state.screenshotFile) return;
  const button = $('#analyze-screenshot');
  button.disabled = true;
  $('#screenshot-message').textContent = 'OpenRouter is analyzing the screenshot. No pick will be applied automatically.';
  try {
    const analysis = await api(scoped(`/draft/sessions/${state.session.id}/analyze-screenshot`), {
      method: 'POST',
      body: JSON.stringify({ dataUrl: await fileDataUrl(state.screenshotFile) })
    });
    renderScreenshotAnalysis(analysis);
    $('#screenshot-message').textContent = analysis.usableForPicks
      ? 'Review the extracted candidates below. Correct names and ownership before applying.'
      : 'No picks were extracted. Use a Yahoo Draft Results or Draft Log screenshot showing completed selections.';
  } catch (error) {
    $('#screenshot-message').textContent = error.message;
  } finally {
    button.disabled = !state.providerStatus?.vision?.configured;
  }
}

async function applyScreenshotPicks() {
  const rows = [...document.querySelectorAll('.vision-candidate')];
  const button = $('#apply-screenshot-picks');
  button.disabled = true;
  let applied = 0;
  try {
    for (const row of rows) {
      if (!row.querySelector('[data-candidate-include]').checked) continue;
      const candidate = state.screenshotCandidates[Number(row.dataset.candidateIndex)];
      const player = findPlayer(row.querySelector('[data-candidate-player]').value);
      if (!player) throw new Error(`Match ${candidate.playerName} to a loaded player before applying the screenshot.`);
      const result = await api(scoped(`/draft/sessions/${state.session.id}/picks`), {
        method: 'POST',
        body: JSON.stringify({
          eventId: candidate.candidateId,
          overallPick: candidate.overallPick,
          playerId: player.id,
          isMine: row.querySelector('[data-candidate-mine]').checked,
          source: 'openrouter-screenshot'
        })
      });
      if (result.applied) applied += 1;
    }
    $('#screenshot-message').textContent = `${applied} reviewed pick${applied === 1 ? '' : 's'} applied. Recommendations refreshed below.`;
    await refresh();
    await refreshFleetSummary();
  } catch (error) {
    $('#screenshot-message').textContent = `${applied} pick${applied === 1 ? '' : 's'} applied before review stopped: ${error.message}`;
    await refresh();
  } finally {
    button.disabled = false;
  }
}

function renderPlayerPicker(players) {
  const input = $('#player-search');
  const previousSelection = state.selectedPlayerId;
  state.availablePlayers = [...players].sort((a, b) => (a.expertRank ?? 999) - (b.expertRank ?? 999));
  $('#player-options').innerHTML = state.availablePlayers.map((player) =>
    `<option value="${escapeHtml(playerLabel(player))}"></option>`
  ).join('');

  if (state.searchDirty) {
    const exact = findPlayer(input.value);
    state.selectedPlayerId = exact?.id || null;
    syncPlayerHighlights();
    return;
  }
  const nextSelection = state.availablePlayers.some((player) => player.id === previousSelection)
    ? previousSelection
    : state.availablePlayers[0]?.id;
  if (nextSelection) selectPlayer(nextSelection);
  else {
    state.selectedPlayerId = null;
    input.value = '';
    syncPlayerHighlights();
  }
}

async function refresh() {
  if (!state.session) return;
  const shouldRefreshProviderStatus = Date.now() - state.providerStatusAt > 30_000;
  const [session, card, pool, providerStatus] = await Promise.all([
    api(scoped(`/draft/sessions/${state.session.id}`)),
    api(scoped(`/draft/sessions/${state.session.id}/recommendation`)),
    api(scoped(`/players?sessionId=${state.session.id}`)),
    shouldRefreshProviderStatus ? api('/api/provider-status') : Promise.resolve(null)
  ]);
  if (providerStatus) {
    state.providerStatus = providerStatus;
    state.providerStatusAt = Date.now();
  }
  state.session = session;
  renderRecommendation(card);
  renderPlayerPicker(pool.players);
  $('#recent-picks').innerHTML = session.picks.slice(-6).reverse().map((pick) =>
    `<li><span>${pick.overallPick}. ${escapeHtml(pick.playerName)}</span><small>${pick.isMine ? escapeHtml(state.league.targetTeam) : escapeHtml(pick.position)}</small></li>`
  ).join('');
}

async function recordPick(event) {
  event.preventDefault();
  const typedPlayer = findPlayer($('#player-search').value);
  if (typedPlayer) selectPlayer(typedPlayer.id);
  const manualMode = !$('#manual-player-fields').classList.contains('hidden');
  const manualName = $('#player-search').value.trim();
  if (!state.selectedPlayerId && (!manualMode || manualName.length < 2)) {
    $('#pick-message').textContent = 'Choose a player from the search results or click a player on the board.';
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api(scoped(`/draft/sessions/${state.session.id}/picks`), {
      method: 'POST',
      body: JSON.stringify({
        playerId: state.selectedPlayerId,
        manualPlayer: state.selectedPlayerId ? undefined : {
          name: manualName,
          position: $('#manual-player-position').value,
          team: $('#manual-player-team').value || 'FA'
        },
        isMine: $('#is-mine').checked,
        source: state.selectedPlayerId ? state.session.sourceMode : 'manual-unresolved'
      })
    });
    $('#pick-message').textContent = result.applied ? 'Pick reconciled. Board refreshed.' : result.reason;
    $('#is-mine').checked = false;
    $('#manual-player-fields').classList.add('hidden');
    $('#manual-player-toggle').textContent = 'Player not found?';
    await refresh();
  } catch (error) {
    $('#pick-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function refreshFleetSummary() {
  const fleet = await api('/api/leagues');
  state.leagues = fleet.leagues;
  renderLeagueFleet();
}

function startPolling() {
  clearInterval(state.timer);
  state.timer = setInterval(() => refresh().catch(() => {}), 1500);
}

async function resetSession() {
  clearInterval(state.timer);
  localStorage.removeItem(sessionKey());
  state.session = null;
  if (state.screenshotObjectUrl) URL.revokeObjectURL(state.screenshotObjectUrl);
  state.screenshotObjectUrl = null;
  state.screenshotFile = null;
  state.screenshotCandidates = [];
  $('#screenshot-file').value = '';
  $('#screenshot-preview').classList.add('hidden');
  $('#screenshot-results').classList.add('hidden');
  $('#analyze-screenshot').disabled = true;
  $('#manual-player-fields').classList.add('hidden');
  $('#manual-player-toggle').textContent = 'Player not found?';
  $('#draft-room').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  await refreshFleetSummary();
}

async function init() {
  $('#session-form').addEventListener('submit', createSession);
  $('#pick-form').addEventListener('submit', recordPick);
  $('#new-session').addEventListener('click', resetSession);
  $('#league-select').addEventListener('change', (event) => selectLeague(event.target.value));
  $('#player-search').addEventListener('input', (event) => {
    state.searchDirty = true;
    state.selectedPlayerId = findPlayer(event.target.value)?.id || null;
    syncPlayerHighlights();
  });
  $('#player-search').addEventListener('change', (event) => {
    const player = findPlayer(event.target.value);
    if (player) selectPlayer(player.id);
  });
  $('#screenshot-file').addEventListener('change', reviewScreenshot);
  $('#analyze-screenshot').addEventListener('click', analyzeScreenshot);
  $('#apply-screenshot-picks').addEventListener('click', applyScreenshotPicks);
  $('#manual-player-toggle').addEventListener('click', () => {
    const fields = $('#manual-player-fields');
    fields.classList.toggle('hidden');
    $('#manual-player-toggle').textContent = fields.classList.contains('hidden') ? 'Player not found?' : 'Use loaded player search';
    if (!fields.classList.contains('hidden')) {
      state.selectedPlayerId = null;
      syncPlayerHighlights();
    }
  });
  state.providerStatus = await api('/api/provider-status');
  state.providerStatusAt = Date.now();
  await loadFleet();
}

init().catch((error) => { document.body.innerHTML = `<pre>${escapeHtml(error.message)}</pre>`; });
