'use strict';

const state = {
  leagues: [],
  defaultLeagueId: null,
  leagueId: null,
  league: null,
  session: null,
  recommendation: null,
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
  const preferred = card.preferred;
  $('#preferred-name').textContent = preferred?.player.name || 'No eligible player';
  $('#preferred-meta').textContent = preferred ? `${preferred.player.position} · ${preferred.player.team} · ADP ${preferred.player.adp ?? '—'}` : '';
  $('#preferred-score').textContent = preferred?.score ?? '—';
  $('#preferred-why').innerHTML = (preferred?.why || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  $('#explanation').textContent = card.explanation;
  renderChoice('safe', card.alternatives.safe);
  renderChoice('upside', card.alternatives.upside);
  $('#updated-at').textContent = `Updated ${new Date(card.generatedAt).toLocaleTimeString()}`;
  $('#board-body').innerHTML = card.board.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(item.player.name)}</strong><small>${escapeHtml(item.player.team)}</small></td>
      <td><span class="position">${escapeHtml(item.player.position)}</span></td>
      <td><strong>${item.score}</strong></td>
      <td>${Math.round(item.waitProbability * 100)}%</td>
      <td>${item.sleeper ? '<span class="badge">SLEEPER</span>' : ''}</td>
    </tr>`).join('');
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
  const select = $('#player-select');
  const current = select.value;
  select.innerHTML = pool.players
    .sort((a, b) => (a.expertRank ?? 999) - (b.expertRank ?? 999))
    .map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(playerLabel(player))}</option>`).join('');
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  $('#recent-picks').innerHTML = session.picks.slice(-6).reverse().map((pick) =>
    `<li><span>${pick.overallPick}. ${escapeHtml(pick.playerName)}</span><small>${pick.isMine ? escapeHtml(state.league.targetTeam) : escapeHtml(pick.position)}</small></li>`
  ).join('');
}

async function recordPick(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api(scoped(`/draft/sessions/${state.session.id}/picks`), {
      method: 'POST',
      body: JSON.stringify({ playerId: $('#player-select').value, isMine: $('#is-mine').checked, source: 'manual' })
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
  $('#draft-room').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  await refreshFleetSummary();
}

async function init() {
  $('#session-form').addEventListener('submit', createSession);
  $('#pick-form').addEventListener('submit', recordPick);
  $('#new-session').addEventListener('click', resetSession);
  $('#league-select').addEventListener('change', (event) => selectLeague(event.target.value));
  await loadFleet();
}

init().catch((error) => { document.body.innerHTML = `<pre>${escapeHtml(error.message)}</pre>`; });
