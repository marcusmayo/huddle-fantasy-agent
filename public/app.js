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
    ? 'Select a screenshot below, review its draft results, then click and confirm each visible player. The board refreshes after every confirmed pick.'
    : 'Until Yahoo OAuth is connected, record each selection here. The board refreshes immediately.';
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
  const rows = [
    ['Player evidence', `${evidence.source || 'unknown'} · ${evidence.season || 'season unknown'} · ${evidence.complete ? 'complete' : 'incomplete'}`],
    ['Evidence timestamp', sourceTime],
    ['League context', `${league.name || state.league.name} · ${league.teamCount || state.league.teamCount} teams · ${league.scoringType || state.league.scoringType}`],
    ['Roster demand', roster || 'Not available'],
    ['Scoring inputs', `${offense.reception ?? '—'} PPR · ${offense.passingTouchdown ?? '—'} pass-TD points · ${offense.passingYardsPerPoint ?? '—'} pass yards/point`],
    ['Player inputs', (evidence.ranking?.playerInputs || []).join(' · ')],
    ['Factor weights', weights || 'Not available'],
    ['Computed logic', (evidence.ranking?.computedFactors || []).join(' · ')],
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
  state.screenshotObjectUrl = URL.createObjectURL(file);
  $('#screenshot-image').src = state.screenshotObjectUrl;
  $('#screenshot-meta').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  $('#screenshot-preview').classList.remove('hidden');
  $('#screenshot-message').textContent = 'Screenshot ready for review. Click each visible drafted player and confirm it below; no pick is applied automatically.';
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
  const [session, card, pool] = await Promise.all([
    api(scoped(`/draft/sessions/${state.session.id}`)),
    api(scoped(`/draft/sessions/${state.session.id}/recommendation`)),
    api(scoped(`/players?sessionId=${state.session.id}`))
  ]);
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
  if (!state.selectedPlayerId) {
    $('#pick-message').textContent = 'Choose a player from the search results or click a player on the board.';
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api(scoped(`/draft/sessions/${state.session.id}/picks`), {
      method: 'POST',
      body: JSON.stringify({ playerId: state.selectedPlayerId, isMine: $('#is-mine').checked, source: state.session.sourceMode })
    });
    $('#pick-message').textContent = result.applied ? 'Pick reconciled. Board refreshed.' : result.reason;
    $('#is-mine').checked = false;
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
  $('#screenshot-file').value = '';
  $('#screenshot-preview').classList.add('hidden');
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
  await loadFleet();
}

init().catch((error) => { document.body.innerHTML = `<pre>${escapeHtml(error.message)}</pre>`; });
