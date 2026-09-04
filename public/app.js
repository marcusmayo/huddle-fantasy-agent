'use strict';

const state = {
  leagues: [],
  defaultLeagueId: null,
  leagueId: null,
  league: null,
  session: null,
  draftSessions: [],
  recommendation: null,
  boardPosition: 'ALL',
  availablePlayers: [],
  selectedPlayerId: null,
  searchDirty: false,
  screenshotObjectUrl: null,
  screenshotFile: null,
  screenshotCandidates: [],
  screenshotAnalysis: null,
  screenshotReviewEventId: null,
  providerStatus: null,
  leagueOnboarding: null,
  yahooOAuth: null,
  yahooLeagues: [],
  providerStatusAt: 0,
  timer: null,
  mode: localStorage.getItem('huddle-mode') === 'weekly' ? 'weekly' : 'draft',
  weeklyReview: null,
  weeklyReviewPersisted: false,
  weeklyWeeks: [],
  weeklySelectedSeason: null,
  weeklyPlayerSearch: '',
  weeklyPlayerPosition: 'ALL',
  yahooDraftSync: null,
  yahooWeeklyStatus: null,
  unresolvedPlayers: []
};
const $ = (selector) => document.querySelector(selector);
let toastTimer = null;
const BOARD_HEIGHT_KEY = 'huddle-best-available-height';
const LEAGUE_ORDER_KEY = 'huddle-league-card-order';
const SCREENSHOT_PURPOSE_COPY = {
  draft_picks: {
    help: 'Use a Yahoo Draft Results or Draft Log image. Only confirmed rows become pick events.',
    ready: 'Review completed selections, correct player matches and ownership, then apply only confirmed picks.'
  },
  available_players: {
    help: 'Use a Yahoo Players page filtered to available players. Visible rows add positive availability evidence; omitted rows remain unknown.',
    ready: 'Review the visible available-player rows. Saving evidence annotates the board but never changes its ranking.'
  },
  team_roster: {
    help: 'Use a Yahoo My Team or roster page. Visible rows add roster-membership evidence only.',
    ready: 'Review the visible roster rows. Saving evidence does not overwrite Yahoo or create draft picks.'
  },
  waiver_players: {
    help: 'Use a Yahoo Players or waiver/free-agent page. Visible rows add waiver evidence; omitted rows remain unknown.',
    ready: 'Review visible waiver candidates and ownership data. Saving evidence does not submit a claim.'
  }
};

function selectedScreenshotPurpose() {
  return $('#screenshot-purpose')?.value || 'draft_picks';
}

function showToast(message) {
  const toast = $('#app-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 7000);
}

function flashBoardRefresh() {
  const board = $('#board-panel');
  board.classList.remove('board-evidence-updated');
  requestAnimationFrame(() => board.classList.add('board-evidence-updated'));
  setTimeout(() => board.classList.remove('board-evidence-updated'), 1200);
}

function finishScreenshotReview(message) {
  if (state.screenshotObjectUrl) URL.revokeObjectURL(state.screenshotObjectUrl);
  state.screenshotObjectUrl = null;
  state.screenshotFile = null;
  state.screenshotCandidates = [];
  state.screenshotAnalysis = null;
  state.screenshotReviewEventId = null;
  $('#screenshot-file').value = '';
  $('#screenshot-preview').classList.add('hidden');
  $('#screenshot-results').classList.add('hidden');
  $('#analyze-screenshot').disabled = true;
  $('#screenshot-saved').textContent = message;
  $('#screenshot-saved').classList.remove('hidden');
  $('#screenshot-message').textContent = 'Review complete. Choose another screenshot whenever the draft room changes.';
  $('#pick-message').textContent = message;
  showToast(message);
  flashBoardRefresh();
  $('#pick-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('#player-search').focus({ preventScroll: true }), 350);
}

function updateScreenshotPurpose({ resetAnalysis = true } = {}) {
  const copy = SCREENSHOT_PURPOSE_COPY[selectedScreenshotPurpose()];
  $('#screenshot-purpose-help').textContent = copy.help;
  if (resetAnalysis) {
    state.screenshotAnalysis = null;
    state.screenshotCandidates = [];
    state.screenshotReviewEventId = null;
    $('#screenshot-results').classList.add('hidden');
    $('#screenshot-saved').classList.add('hidden');
  }
  if (state.screenshotFile) {
    $('#screenshot-message').textContent = state.providerStatus?.vision?.configured
      ? `${copy.help} Click Analyze screenshot when ready.`
      : 'Preview ready, but vision is disabled until OPENROUTER_API_KEY is configured.';
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Request failed');
  return body;
}

function yahooReady() {
  return Boolean(
    state.yahooOAuth?.enabled
    && state.yahooOAuth?.clientConfigured
    && state.yahooOAuth?.encryptedTokenStorageConfigured
  );
}

function renderYahooConnection() {
  const ready = yahooReady();
  const connected = Boolean(state.yahooOAuth?.connected);
  const topButton = $('#connect-yahoo');
  const emptyButton = $('#empty-connect-yahoo');
  const dialogConnect = $('#dialog-connect-yahoo');
  const discover = $('#discover-yahoo-leagues');
  topButton.disabled = !ready;
  emptyButton.disabled = !ready;
  topButton.textContent = connected ? 'Import Yahoo league' : 'Connect Yahoo';
  emptyButton.textContent = connected ? 'Import from Yahoo' : 'Connect Yahoo';
  dialogConnect.classList.toggle('hidden', connected);
  discover.classList.toggle('hidden', !connected);
  $('#yahoo-connection-title').textContent = connected ? 'Yahoo account connected' : 'Connect your Yahoo account';
  $('#yahoo-connection-message').textContent = !ready
    ? 'Yahoo OAuth is not fully configured in this Huddle environment.'
    : connected
      ? `Read-only token connected${state.yahooOAuth.expiresAt ? ` · current access expires ${new Date(state.yahooOAuth.expiresAt).toLocaleString()}` : ''}. Discover leagues to import one.`
      : 'Authorize read-only access. Huddle cannot draft, change a lineup, or submit a waiver claim.';
}

function startYahooOAuth() {
  if (!yahooReady()) {
    showToast('Yahoo OAuth is not fully configured in this Huddle environment.');
    return;
  }
  window.location.assign('/auth/yahoo/start');
}

function renderYahooLeagues(leagues) {
  state.yahooLeagues = leagues;
  const container = $('#yahoo-league-results');
  const owned = leagues.map((league) => ({
    ...league,
    teams: league.teams.filter((team) => team.ownedByCurrentUser)
  })).filter((league) => league.teams.length);
  container.innerHTML = owned.map((league) => `
    <article class="yahoo-discovered-league">
      <header>
        <div><h4>${escapeHtml(league.name)}</h4><small>${escapeHtml(String(league.season || 'Current season'))} · ${league.numTeams || '—'} teams · ${escapeHtml(league.leagueKey)}</small></div>
        <span class="badge">YAHOO READ</span>
      </header>
      ${league.teams.map((team) => `
        <div class="yahoo-team-choice">
          <div><strong>${escapeHtml(team.name)}</strong><small>${team.draftPosition ? `Draft position ${team.draftPosition}` : 'Draft position pending'} · ${escapeHtml(team.teamKey)}</small></div>
          <button type="button" data-yahoo-import data-league-key="${escapeHtml(league.leagueKey)}" data-team-key="${escapeHtml(team.teamKey)}">Import this league</button>
        </div>`).join('')}
    </article>`).join('');
  container.classList.toggle('hidden', !owned.length);
  $('#yahoo-discovery-message').textContent = owned.length
    ? `${owned.length} Yahoo league${owned.length === 1 ? '' : 's'} with an owned team found. Choose one to import its rules.`
    : 'Yahoo returned no NFL leagues owned by this account.';
  document.querySelectorAll('[data-yahoo-import]').forEach((button) => button.addEventListener('click', () => importYahooLeague(button)));
}

async function discoverYahooLeagues() {
  if (!state.yahooOAuth?.connected) {
    startYahooOAuth();
    return;
  }
  const button = $('#discover-yahoo-leagues');
  button.disabled = true;
  $('#yahoo-discovery-message').textContent = 'Reading owned Yahoo Fantasy football leagues…';
  try {
    const result = await api('/api/yahoo/leagues');
    renderYahooLeagues(result.leagues || []);
  } catch (error) {
    $('#yahoo-discovery-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function importYahooLeague(button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Importing rules…';
  $('#yahoo-discovery-message').textContent = 'Reading and normalizing the selected league settings without retaining the raw Yahoo response…';
  try {
    const result = await api('/api/yahoo/leagues/import', {
      method: 'POST',
      body: JSON.stringify({
        leagueKey: button.dataset.leagueKey,
        teamKey: button.dataset.teamKey,
        confirm: true
      })
    });
    await loadFleet();
    closeLeagueDialog();
    const warnings = result.yahoo?.warnings?.length || 0;
    showToast(`${result.league.name} imported from Yahoo${warnings ? ` with ${warnings} setting warning${warnings === 1 ? '' : 's'}` : ' and verified'}.`);
    await selectLeague(result.league.id);
  } catch (error) {
    $('#yahoo-discovery-message').textContent = error.message;
    button.disabled = false;
    button.textContent = original;
  }
}

async function openYahooOnboarding() {
  openLeagueDialog();
  if (state.yahooOAuth?.connected) await discoverYahooLeagues();
}

function scoped(path = '') {
  return `/api/leagues/${encodeURIComponent(state.leagueId)}${path}`;
}

function sessionKey() {
  return `huddle-session-id:${state.leagueId}`;
}

function weeklySeasonKey() {
  return `huddle-weekly-season:${state.leagueId}`;
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

function selectedLeagueSummary() {
  return state.leagues.find((league) => league.id === state.leagueId) || null;
}

function yahooSyncEligible() {
  return Boolean(selectedLeagueSummary()?.yahooSyncEligible);
}

function applySavedLeagueOrder(leagues) {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(LEAGUE_ORDER_KEY) || '[]'); } catch { saved = []; }
  const positions = new Map(saved.map((id, index) => [String(id), index]));
  return [...leagues].sort((left, right) => {
    const leftPosition = positions.has(left.id) ? positions.get(left.id) : Number.MAX_SAFE_INTEGER;
    const rightPosition = positions.has(right.id) ? positions.get(right.id) : Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition;
  });
}

function saveLeagueOrder() {
  localStorage.setItem(LEAGUE_ORDER_KEY, JSON.stringify(state.leagues.map((league) => league.id)));
}

function moveLeagueCard(leagueId, direction) {
  const index = state.leagues.findIndex((league) => league.id === leagueId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= state.leagues.length) return;
  [state.leagues[index], state.leagues[next]] = [state.leagues[next], state.leagues[index]];
  saveLeagueOrder();
  renderLeagueSelector();
  renderLeagueFleet();
}

function placeLeagueCard(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const sourceIndex = state.leagues.findIndex((league) => league.id === sourceId);
  if (sourceIndex < 0) return;
  const [source] = state.leagues.splice(sourceIndex, 1);
  const targetIndex = state.leagues.findIndex((league) => league.id === targetId);
  state.leagues.splice(targetIndex < 0 ? state.leagues.length : targetIndex, 0, source);
  saveLeagueOrder();
  renderLeagueSelector();
  renderLeagueFleet();
}

function renderLeagueFleet() {
  $('#fleet-mode').textContent = `${state.leagues.length} active league${state.leagues.length === 1 ? '' : 's'} · isolated state`;
  $('#fleet-empty').classList.toggle('hidden', state.leagues.length > 0);
  $('#league-grid').innerHTML = state.leagues.map((league, index) => {
    const sourceLabel = league.connectionType === 'yahoo'
      ? 'Yahoo source'
      : league.connectionType === 'demo' ? 'Demo profile' : 'Manual profile';
    return `
    <article class="league-card ${league.id === state.leagueId ? 'active' : ''}" data-league-id="${escapeHtml(league.id)}" draggable="true">
      <button class="league-card-select" type="button" data-league-select="${escapeHtml(league.id)}">
        <span class="league-state"><i></i>${league.activeSessions ? `${league.activeSessions} active draft` : 'ready'}</span>
        <strong>${escapeHtml(league.name)}</strong>
        <span>${escapeHtml(league.targetTeam)} · ${league.teamCount} teams</span>
        <small>${sourceLabel} · ${league.sessions} draft session${league.sessions === 1 ? '' : 's'} · ${league.weekly?.storedWeeks || 0} saved week${league.weekly?.storedWeeks === 1 ? '' : 's'} · ${escapeHtml(league.verificationStatus || 'unverified')}</small>
      </button>
      <div class="league-card-actions" aria-label="Arrange ${escapeHtml(league.name)}">
        <button type="button" class="ghost compact" data-league-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(league.name)} left">←</button>
        <button type="button" class="ghost compact" data-league-move="1" ${index === state.leagues.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeHtml(league.name)} right">→</button>
        ${league.deletable ? `<button type="button" class="ghost compact league-delete" data-league-delete aria-label="Delete ${escapeHtml(league.name)}">Delete</button>` : ''}
      </div>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-league-select]').forEach((button) => {
    button.addEventListener('click', () => selectLeague(button.dataset.leagueSelect));
  });
  document.querySelectorAll('.league-card').forEach((card) => {
    card.querySelectorAll('[data-league-move]').forEach((button) => button.addEventListener('click', () =>
      moveLeagueCard(card.dataset.leagueId, Number(button.dataset.leagueMove))));
    card.querySelector('[data-league-delete]')?.addEventListener('click', () => removeLeague(card.dataset.leagueId));
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.leagueId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      placeLeagueCard(event.dataTransfer.getData('text/plain'), card.dataset.leagueId);
    });
  });
}

function renderLeagueSelector() {
  $('#league-select').innerHTML = state.leagues.length
    ? state.leagues.map((league) =>
      `<option value="${escapeHtml(league.id)}">${escapeHtml(league.name)} · ${escapeHtml(league.targetTeam)}</option>`
    ).join('')
    : '<option value="">No leagues configured</option>';
  $('#league-select').disabled = state.leagues.length === 0;
  if (state.leagueId) $('#league-select').value = state.leagueId;
}

function renderDraftSessions() {
  const sessions = state.draftSessions;
  const active = sessions.filter((session) => session.status === 'active').length;
  $('#draft-session-count').textContent = `${active} active · ${sessions.length} total`;
  $('#draft-session-list').innerHTML = sessions.length ? sessions.map((session) => {
    const updated = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : 'time unavailable';
    const progress = `${session.picks.length} of ${session.totalPicks} picks`;
    return `<article class="history-row">
      <div class="history-row-copy">
        <span class="session-status">${escapeHtml(session.status)}</span>
        <strong>${escapeHtml(session.sourceMode)} session · slot ${session.draftSlot}</strong>
        <small>${progress} · updated ${escapeHtml(updated)}${session.completedAt ? ` · completed ${escapeHtml(new Date(session.completedAt).toLocaleString())}` : ''}</small>
      </div>
      <div class="history-row-actions">
        ${session.status === 'active'
          ? `<button type="button" class="ghost compact" data-session-resume="${escapeHtml(session.id)}">Resume</button><button type="button" class="ghost compact" data-session-complete="${escapeHtml(session.id)}">Complete</button>`
          : `<button type="button" class="ghost compact" data-session-reopen="${escapeHtml(session.id)}">Reopen</button>`}
        <button type="button" class="ghost compact danger" data-session-delete="${escapeHtml(session.id)}">Delete</button>
      </div>
    </article>`;
  }).join('') : '<p class="muted">No saved draft sessions for this league.</p>';
  $('#draft-session-history').classList.toggle('hidden', state.mode !== 'draft' || Boolean(state.session));
  document.querySelectorAll('[data-session-resume]').forEach((button) => button.addEventListener('click', () => resumeSession(button.dataset.sessionResume)));
  document.querySelectorAll('[data-session-complete]').forEach((button) => button.addEventListener('click', () => completeDraftSession(button.dataset.sessionComplete)));
  document.querySelectorAll('[data-session-reopen]').forEach((button) => button.addEventListener('click', () => reopenDraftSession(button.dataset.sessionReopen)));
  document.querySelectorAll('[data-session-delete]').forEach((button) => button.addEventListener('click', () => deleteDraftSession(button.dataset.sessionDelete)));
}

async function loadDraftSessions() {
  if (!state.leagueId) return;
  const result = await api(scoped('/draft/sessions'));
  state.draftSessions = result.sessions;
  renderDraftSessions();
}

async function completeDraftSession(sessionId = state.session?.id) {
  const session = state.draftSessions.find((item) => item.id === sessionId) || state.session;
  if (!sessionId || !session) return;
  if (!window.confirm(`Complete this ${state.league.name} draft session at ${session.picks.length} of ${session.totalPicks} picks? It can be reopened later.`)) return;
  try {
    await api(scoped(`/draft/sessions/${encodeURIComponent(sessionId)}/complete`), { method: 'POST', body: '{}' });
    if (state.session?.id === sessionId) {
      clearInterval(state.timer);
      localStorage.removeItem(sessionKey());
      state.session = null;
      state.yahooDraftSync = null;
      $('#draft-room').classList.add('hidden');
      $('#setup').classList.remove('hidden');
    }
    await Promise.all([loadDraftSessions(), refreshFleetSummary()]);
    showToast('Draft session completed. It no longer counts as active and can be reopened from Draft history.');
  } catch (error) {
    showToast(error.message);
  }
}

async function reopenDraftSession(sessionId) {
  try {
    await api(scoped(`/draft/sessions/${encodeURIComponent(sessionId)}/reopen`), { method: 'POST', body: '{}' });
    await Promise.all([loadDraftSessions(), refreshFleetSummary()]);
    showToast('Draft session reopened. Select Resume when you are ready to use it.');
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteDraftSession(sessionId) {
  const session = state.draftSessions.find((item) => item.id === sessionId);
  if (!session || !window.confirm(`Permanently delete this ${state.league.name} ${session.status} draft session and its ${session.picks.length} recorded picks? This cannot be undone.`)) return;
  try {
    await api(scoped(`/draft/sessions/${encodeURIComponent(sessionId)}`), { method: 'DELETE' });
    if (localStorage.getItem(sessionKey()) === sessionId) localStorage.removeItem(sessionKey());
    await Promise.all([loadDraftSessions(), refreshFleetSummary()]);
    showToast('Draft session permanently deleted.');
  } catch (error) {
    showToast(error.message);
  }
}

function showEmptyFleet() {
  clearInterval(state.timer);
  state.leagueId = null;
  state.league = null;
  state.session = null;
  state.weeklyReview = null;
  localStorage.removeItem('huddle-active-league');
  $('#league-picker').classList.add('hidden');
  $('#mode-switch').classList.add('hidden');
  $('#setup').classList.add('hidden');
  $('#draft-room').classList.add('hidden');
  $('#weekly-room').classList.add('hidden');
  $('#app-context').textContent = 'HUDDLE / LEAGUE SETUP';
  $('#app-title').textContent = 'Build your fantasy league fleet.';
  $('#sync-label').textContent = 'No leagues configured';
}

async function loadFleet() {
  const fleet = await api('/api/leagues');
  state.leagues = applySavedLeagueOrder(fleet.leagues);
  state.defaultLeagueId = fleet.defaultLeagueId;
  const saved = localStorage.getItem('huddle-active-league');
  const selected = state.leagues.some((league) => league.id === saved) ? saved : state.defaultLeagueId;
  renderLeagueSelector();
  renderLeagueFleet();
  if (selected) await selectLeague(selected);
  else showEmptyFleet();
}

async function removeLeague(leagueId) {
  const league = state.leagues.find((candidate) => candidate.id === leagueId);
  if (!league?.deletable) return;
  if (!window.confirm(`Delete ${league.name} from the active Huddle fleet? Dashboard-created data will be archived; configured presets will be hidden without deleting their source files.`)) return;
  try {
    const result = await api(`/api/leagues/${encodeURIComponent(leagueId)}`, { method: 'DELETE' });
    localStorage.removeItem(`huddle-session-id:${leagueId}`);
    localStorage.removeItem(`huddle-weekly-season:${leagueId}`);
    state.defaultLeagueId = result.defaultLeagueId;
    state.leagues = applySavedLeagueOrder(result.fleet.leagues);
    saveLeagueOrder();
    renderLeagueSelector();
    renderLeagueFleet();
    showToast(result.removalMode === 'managed-league-archived'
      ? `${league.name} deleted from the active fleet. Its files were archived for recovery.`
      : `${league.name} removed from the active fleet. Its configured source files were left unchanged.`);
    const nextLeagueId = state.leagues.some((candidate) => candidate.id === state.leagueId)
      ? state.leagueId
      : state.defaultLeagueId || state.leagues[0]?.id;
    if (nextLeagueId) await selectLeague(nextLeagueId);
    else showEmptyFleet();
  } catch (error) {
    showToast(error.message);
  }
}

function showMode(mode) {
  if (!state.leagues.length) {
    showEmptyFleet();
    return;
  }
  state.mode = mode;
  localStorage.setItem('huddle-mode', mode);
  const weekly = mode === 'weekly';
  $('#draft-mode').classList.toggle('active', !weekly);
  $('#draft-mode').classList.toggle('ghost', weekly);
  $('#weekly-mode').classList.toggle('active', weekly);
  $('#weekly-mode').classList.toggle('ghost', !weekly);
  $('#app-context').textContent = weekly ? 'HUDDLE / WEEKLY MANAGEMENT' : 'HUDDLE / DRAFT ROOM';
  $('#app-title').textContent = weekly ? 'Win the week, league by league.' : 'Make the next pick count.';
  $('#weekly-room').classList.toggle('hidden', !weekly);
  $('#draft-session-history').classList.toggle('hidden', weekly || Boolean(state.session));
  if (weekly) {
    clearInterval(state.timer);
    $('#setup').classList.add('hidden');
    $('#draft-room').classList.add('hidden');
    $('#sync-label').textContent = `Weekly review · ${state.league?.name || 'league'}`;
    if (state.leagueId) loadWeekly().catch((error) => { $('#weekly-message').textContent = error.message; });
  } else {
    $('#weekly-room').classList.add('hidden');
    if (state.session) {
      showDraftRoom();
      startPolling();
    } else {
      $('#draft-room').classList.add('hidden');
      $('#setup').classList.remove('hidden');
      $('#sync-label').textContent = 'Ready · recommendation only';
      loadDraftSessions().catch((error) => showToast(error.message));
    }
  }
}

function closeLeagueDialog() {
  const dialog = $('#league-dialog');
  if (dialog.open) dialog.close();
  $('#league-form-message').textContent = '';
}

function openLeagueDialog() {
  const dialog = $('#league-dialog');
  $('#league-form-message').textContent = '';
  if (!state.leagueOnboarding?.enabled) {
    showToast(state.leagueOnboarding?.message || 'League onboarding is disabled on this instance.');
    return;
  }
  dialog.showModal();
  setTimeout(() => $('#add-league-name').focus(), 50);
}

function rosterInput() {
  return Object.fromEntries([...document.querySelectorAll('[data-roster-slot]')]
    .map((input) => [input.dataset.rosterSlot, Number(input.value)]));
}

async function addLeague(event) {
  event.preventDefault();
  const button = $('#save-league');
  button.disabled = true;
  $('#league-form-message').textContent = 'Saving isolated league configuration…';
  try {
    const result = await api('/api/leagues', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#add-league-name').value,
        targetTeam: $('#add-target-team').value,
        teamCount: Number($('#add-team-count').value),
        draftSlot: $('#add-draft-slot').value,
        receptionPoints: Number($('#add-reception-points').value),
        passingTouchdown: Number($('#add-passing-td').value),
        roster: rosterInput(),
        yahooLeagueKey: $('#add-yahoo-league-key').value,
        yahooTeamKey: $('#add-yahoo-team-key').value
      })
    });
    const fleet = await api('/api/leagues');
    state.leagues = applySavedLeagueOrder(fleet.leagues);
    state.defaultLeagueId = fleet.defaultLeagueId;
    renderLeagueSelector();
    renderLeagueFleet();
    closeLeagueDialog();
    $('#league-form').reset();
    showToast(`${result.league.name} added. Yahoo verification is still required.`);
    await selectLeague(result.league.id);
  } catch (error) {
    $('#league-form-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function selectLeague(leagueId) {
  if (!state.leagues.some((league) => league.id === leagueId)) return;
  $('#league-picker').classList.remove('hidden');
  $('#mode-switch').classList.remove('hidden');
  clearInterval(state.timer);
  state.leagueId = leagueId;
  state.session = null;
  state.draftSessions = [];
  state.weeklyWeeks = [];
  state.weeklyReview = null;
  state.weeklyReviewPersisted = false;
  localStorage.setItem('huddle-active-league', leagueId);
  $('#league-select').value = leagueId;
  state.league = await api(scoped());
  $('#league-name').textContent = `${state.league.name} · ${state.league.targetTeam}`;
  $('#weekly-league-name').textContent = `${state.league.name} · ${state.league.targetTeam}`;
  const verificationWarnings = state.league.provenance?.warnings || [];
  $('#league-verification-warning').classList.toggle('hidden', !verificationWarnings.length);
  $('#league-verification-warning').textContent = verificationWarnings.length
    ? `Yahoo verification warnings: ${verificationWarnings.join(' ')}`
    : '';
  $('#draft-slot').max = state.league.teamCount;
  $('#draft-slot').value = state.league.draft?.draftSlot || '';
  const yahooEligible = yahooSyncEligible();
  const yahooSeason = Number(state.league.provenance?.season);
  const storedWeeklySeason = validWeeklySeason(localStorage.getItem(weeklySeasonKey()));
  setWeeklySeason(storedWeeklySeason || (yahooEligible && Number.isInteger(yahooSeason) ? yahooSeason : new Date().getFullYear()), { persist: false });
  const yahooOption = $('#source-mode').querySelector('option[value="yahoo"]');
  yahooOption.disabled = !yahooEligible;
  if (!yahooEligible && $('#source-mode').value === 'yahoo') $('#source-mode').value = 'manual';
  $('#session-help').textContent = yahooEligible
    ? 'Huddle checks Yahoo for your confirmed draft slot before opening the room. It recommends; you make every pick in Yahoo.'
    : 'This is a demo or manual profile. Choose its draft slot and use Manual or Screenshot mode; Yahoo synchronization does not apply.';
  $('#draft-slot-status').textContent = state.league.draft?.draftSlot
    ? `${yahooEligible ? 'Yahoo/imported' : 'Configured'} draft position ${state.league.draft.draftSlot}.`
    : yahooEligible ? 'Yahoo has not published a draft position yet; refresh later or enter the confirmed slot.' : 'Enter the demo/manual snake-draft position.';
  $('#refresh-yahoo-draft-slot').classList.toggle('hidden', !yahooEligible);
  $('#refresh-yahoo-draft-slot').disabled = !state.yahooOAuth?.connected;
  $('#refresh-yahoo-settings').classList.toggle('hidden', !yahooEligible);
  $('#refresh-yahoo-settings').disabled = !state.yahooOAuth?.connected;
  $('#rehearse-yahoo').classList.toggle('hidden', !yahooEligible);
  $('#rehearse-yahoo').disabled = !state.yahooOAuth?.connected;
  $('#yahoo-rehearsal-status').classList.add('hidden');
  $('#weekly-yahoo-refresh').disabled = !yahooEligible || !state.yahooOAuth?.connected;
  $('#weekly-yahoo-refresh').title = yahooEligible
    ? state.yahooOAuth?.connected ? 'Refresh this league from Yahoo' : 'Connect Yahoo before refreshing'
    : 'Yahoo refresh does not apply to demo or manual leagues';
  $('#draft-room').classList.add('hidden');
  $('#setup').classList.toggle('hidden', state.mode === 'weekly');
  $('#sync-label').textContent = state.mode === 'weekly' ? `Weekly review · ${state.league.name}` : 'Ready · recommendation only';
  renderLeagueFleet();
  await loadDraftSessions();

  if (state.mode === 'weekly') {
    $('#weekly-room').classList.remove('hidden');
    await loadWeekly();
    return;
  }

  let sessionId = localStorage.getItem(sessionKey());
  if (!sessionId && leagueId === state.defaultLeagueId) {
    sessionId = localStorage.getItem('huddle-session-id');
    if (sessionId) localStorage.setItem(sessionKey(), sessionId);
  }
  if (sessionId) await resumeSession(sessionId);
  else if (yahooEligible && state.yahooOAuth?.connected) await refreshYahooDraftPosition({ silent: true });
}

async function refreshYahooSettings() {
  if (!yahooSyncEligible()) return null;
  const button = $('#refresh-yahoo-settings');
  button.disabled = true;
  try {
    const result = await api(scoped('/yahoo/settings/refresh'), { method: 'POST', body: '{}' });
    showToast(result.warnings.length
      ? `Yahoo settings refreshed with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`
      : 'Yahoo league settings refreshed and fully recognized.');
    await refreshFleetSummary();
    await selectLeague(state.leagueId);
    return result;
  } catch (error) {
    showToast(`Yahoo settings refresh failed: ${error.message}`);
    return null;
  } finally {
    button.disabled = !state.yahooOAuth?.connected;
  }
}

async function rehearseYahoo() {
  if (!yahooSyncEligible()) return null;
  const button = $('#rehearse-yahoo');
  const status = $('#yahoo-rehearsal-status');
  button.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Checking read-only settings, draft results, player identity, and draft depth…';
  try {
    const result = await api(scoped('/yahoo/rehearsal'), { method: 'POST', body: '{}' });
    status.textContent = result.ready
      ? `Yahoo rehearsal passed: ${result.checks.map((check) => `${check.name} ${check.durationMs}ms`).join(' · ')}. Yahoo was not changed; any depth identities are held in memory only.`
      : `Yahoo rehearsal needs attention: ${result.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.error.message}`).join(' · ')}`;
    return result;
  } catch (error) {
    status.textContent = `Yahoo rehearsal failed: ${error.message}`;
    return null;
  } finally {
    button.disabled = !state.yahooOAuth?.connected;
  }
}

async function refreshYahooDraftPosition({ silent = false } = {}) {
  if (!yahooSyncEligible()) return null;
  const button = $('#refresh-yahoo-draft-slot');
  button.disabled = true;
  if (!silent) $('#draft-slot-status').textContent = 'Checking Yahoo for the latest draft position…';
  try {
    const result = await api(scoped('/yahoo/draft-position/refresh'), { method: 'POST', body: '{}' });
    if (result.draftSlot) {
      state.league.draft.draftSlot = result.draftSlot;
      $('#draft-slot').value = result.draftSlot;
      state.league.provenance.warnings = (state.league.provenance?.warnings || [])
        .filter((warning) => !String(warning).includes('confirmed draft position'));
      const warnings = state.league.provenance.warnings;
      $('#league-verification-warning').classList.toggle('hidden', !warnings.length);
      $('#league-verification-warning').textContent = warnings.length ? `Yahoo verification warnings: ${warnings.join(' ')}` : '';
    }
    $('#draft-slot-status').textContent = result.message;
    return result;
  } catch (error) {
    if (!silent) $('#draft-slot-status').textContent = error.message;
    return null;
  } finally {
    button.disabled = !state.yahooOAuth?.connected;
  }
}

function weeklyKey(review) {
  return review ? `${review.season}:${review.week}` : '';
}

function weeklyTemplate() {
  const week = Number($('#weekly-week').value || 1);
  const season = Number($('#weekly-season').value || new Date().getFullYear());
  const teams = Array.from({ length: state.league.teamCount }, (_, index) => {
    const isTarget = index === 0;
    const pairedIndex = index % 2 === 0 ? index + 1 : index - 1;
    const hasBye = pairedIndex >= state.league.teamCount;
    const opponentIndex = hasBye ? null : pairedIndex;
    return {
      teamId: isTarget ? 'target' : `team-${index + 1}`,
      name: isTarget ? state.league.targetTeam : index === 1 ? 'WEEKLY OPPONENT' : `LEAGUE TEAM ${index + 1}`,
      isTarget,
      score: roundTemplateScore(112.4 - index * 2.7),
      opponentId: hasBye ? null : opponentIndex === 0 ? 'target' : `team-${opponentIndex + 1}`,
      bye: hasBye,
      standingRank: index + 1,
      previousStandingRank: index === 0 ? Math.min(2, state.league.teamCount) : index,
      wins: index % 2 === 0 ? 1 : 0,
      losses: index % 2 === 0 ? 0 : 1,
      pointsFor: roundTemplateScore(112.4 - index * 2.7),
      pointsAgainst: roundTemplateScore(104.8 + index * 1.1)
    };
  });
  return {
    season,
    week,
    source: 'manual-normalized-import',
    observedAt: new Date().toISOString(),
    teams,
    roster: [
      { playerId: 'qb-starter', name: 'Starting Quarterback', position: 'QB', rosterSlot: 'QB', actualPoints: 18.2, projectedPoints: 19.5, remainingProjectedPoints: 245 },
      { playerId: 'rb-starter-1', name: 'Starting Running Back', position: 'RB', rosterSlot: 'RB', actualPoints: 14.1, projectedPoints: 13.5, remainingProjectedPoints: 178 },
      { playerId: 'wr-starter-1', name: 'Starting Wide Receiver', position: 'WR', rosterSlot: 'WR', actualPoints: 11.8, projectedPoints: 15.2, remainingProjectedPoints: 190 },
      { playerId: 'te-starter', name: 'Starting Tight End', position: 'TE', rosterSlot: 'TE', actualPoints: 7.4, projectedPoints: 8.1, remainingProjectedPoints: 105 },
      { playerId: 'bench-rb', name: 'Bench Running Back', position: 'RB', rosterSlot: 'BN', actualPoints: 19.6, projectedPoints: 10.1, remainingProjectedPoints: 120 },
      { playerId: 'bench-wr', name: 'Bench Wide Receiver', position: 'WR', rosterSlot: 'BN', actualPoints: 4.2, projectedPoints: 6.1, remainingProjectedPoints: 72 }
    ],
    availablePlayers: [
      { playerId: 'free-agent-wr', name: 'Available Wide Receiver', position: 'WR', nflTeam: 'FA', available: true, projectedPoints: 9.5, remainingProjectedPoints: 115, sleeperTrend: { direction: 'rising' } },
      { playerId: 'free-agent-rb', name: 'Available Running Back', position: 'RB', nflTeam: 'FA', available: true, projectedPoints: 8.2, remainingProjectedPoints: 102 }
    ],
    transactions: [],
    waiver: { budgetRemaining: 100, priority: 5 },
    holdThreshold: 2
  };
}

function roundTemplateScore(value) {
  return Math.round(value * 10) / 10;
}

function movementLabel(value) {
  if (value == null || value === 0) return 'No movement';
  return value > 0 ? `▲ ${value} place${value === 1 ? '' : 's'}` : `▼ ${Math.abs(value)} place${value === -1 ? '' : 's'}`;
}

function authoritativeYahooSeason() {
  const season = Number(state.league?.provenance?.season);
  return yahooSyncEligible() && Number.isInteger(season) ? season : null;
}

function validWeeklySeason(value) {
  const season = Number(value);
  return Number.isInteger(season) && season >= 2020 && season <= 2100 ? season : null;
}

function setWeeklySeason(value, { persist = true } = {}) {
  const season = validWeeklySeason(value) || authoritativeYahooSeason() || new Date().getFullYear();
  state.weeklySelectedSeason = season;
  $('#weekly-season').value = season;
  if (persist && state.leagueId) localStorage.setItem(weeklySeasonKey(), String(season));
  const savedCount = state.weeklyWeeks.filter((review) => review.season === season).length;
  const yahooSeason = authoritativeYahooSeason();
  $('#weekly-season-status').textContent = `Viewing ${season} season · ${savedCount} saved week${savedCount === 1 ? '' : 's'}`;
  $('#weekly-season-help').textContent = yahooSeason
    ? season === yahooSeason
      ? `Yahoo source season ${yahooSeason}. Yahoo updates stay in this season.`
      : `Historical ${season} view. This league's live Yahoo source is ${yahooSeason}.`
    : `Manual snapshots will be assigned to season ${season}.`;
  $('#weekly-clear-season').textContent = `Clear ${season} history`;
  $('#weekly-clear-season').disabled = savedCount === 0;
  return season;
}

function weeklyPlayerIdentity(player) {
  return String(player?.yahooPlayerKey || player?.playerId || player?.id || player?.name || '').trim().toLowerCase();
}

function weeklyProjection(player, field) {
  const value = player?.[field];
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
}

function renderWeeklyPlayerBoard(review = state.weeklyReview) {
  const body = $('#weekly-player-body');
  const count = $('#weekly-player-count');
  if (!review) {
    body.innerHTML = '<tr><td colspan="7" class="empty-board">Run a weekly review to load available players.</td></tr>';
    count.textContent = 'No available-player review loaded.';
    return;
  }
  const recommendation = review.waiver?.recommendation || {};
  const guidance = new Map();
  for (const item of recommendation.claimPlan || []) {
    guidance.set(weeklyPlayerIdentity(item.add), {
      priority: item.priority,
      label: item.priority === 1 ? 'Recommended claim' : `Fallback #${item.priority}`,
      detail: `Drop ${item.drop.name} · ${item.expectedPointsGained >= 0 ? '+' : ''}${item.expectedPointsGained} pts`,
      className: 'claim-priority'
    });
  }
  for (const item of recommendation.consideredAlternatives || []) {
    const identity = weeklyPlayerIdentity(item.add);
    if (!guidance.has(identity)) guidance.set(identity, {
      priority: 100 + item.priority,
      label: `Below threshold #${item.priority}`,
      detail: `Drop ${item.drop.name} · ${item.expectedPointsGained >= 0 ? '+' : ''}${item.expectedPointsGained} pts`,
      className: 'below-threshold'
    });
  }
  const allPlayers = [...(review.availablePlayers || [])].sort((a, b) => {
    const aGuidance = guidance.get(weeklyPlayerIdentity(a));
    const bGuidance = guidance.get(weeklyPlayerIdentity(b));
    if (aGuidance || bGuidance) return (aGuidance?.priority ?? 999) - (bGuidance?.priority ?? 999);
    const remaining = (weeklyProjection(b, 'remainingProjectedPoints') ?? -Infinity) - (weeklyProjection(a, 'remainingProjectedPoints') ?? -Infinity);
    if (remaining) return remaining;
    const weekly = (weeklyProjection(b, 'projectedPoints') ?? -Infinity) - (weeklyProjection(a, 'projectedPoints') ?? -Infinity);
    return weekly || String(a.name).localeCompare(String(b.name));
  });
  const query = state.weeklyPlayerSearch.trim().toLowerCase();
  const position = state.weeklyPlayerPosition;
  const visible = allPlayers.filter((player) => {
    const matchesPosition = position === 'ALL' || player.position === position;
    const haystack = `${player.name || ''} ${player.nflTeam || ''} ${player.position || ''}`.toLowerCase();
    return matchesPosition && (!query || haystack.includes(query));
  });
  const persistence = review.persistence || {};
  const reviewed = Number(persistence.availablePlayersObserved || allPlayers.length);
  const retained = persistence.compacted ? ` · ${allPlayers.length} retained from ${reviewed} originally reviewed` : '';
  const source = review.source === 'yahoo-live-transient-v1' ? 'Live Yahoo preview' : 'Saved normalized snapshot';
  count.textContent = `${source} · ${visible.length} of ${allPlayers.length} loaded players shown${retained}`;
  body.innerHTML = visible.length ? visible.map((player) => {
    const item = guidance.get(weeklyPlayerIdentity(player));
    const sources = [
      player.sourceCoverage?.fantasyPros ? 'FP' : '',
      player.sourceCoverage?.tank01 ? 'T01' : '',
      player.sourceCoverage?.sleeper ? 'SLP' : ''
    ].filter(Boolean);
    const playerRank = allPlayers.indexOf(player) + 1;
    return `<tr class="${item?.className || ''}">
      <td>${playerRank}</td>
      <td><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.nflTeam || 'FA')} · ${escapeHtml(player.availabilityStatus || 'available')}</small></td>
      <td><span class="position">${escapeHtml(player.position)}</span></td>
      <td>${weeklyProjection(player, 'projectedPoints') ?? '—'}</td>
      <td>${weeklyProjection(player, 'remainingProjectedPoints') ?? '—'}</td>
      <td class="weekly-player-guidance">${item ? `<strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small>` : '<span class="muted">Available · not in top claim plan</span>'}</td>
      <td class="weekly-player-evidence">${sources.length ? sources.map((source) => `<span class="badge">${source}</span>`).join(' ') : '<span class="muted">No shared projection</span>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty-board">No available players match this search and position.</td></tr>';
}

function renderWeekly(review) {
  state.weeklyReview = review;
  const savedSummary = review && state.weeklyWeeks.find((item) => weeklyKey(item) === weeklyKey(review));
  state.weeklyReviewPersisted = Boolean(review && review.persistence?.persisted !== false && savedSummary);
  const hasReview = Boolean(review);
  $('#weekly-empty').classList.toggle('hidden', hasReview);
  $('#weekly-review').classList.toggle('hidden', !hasReview);
  $('#weekly-delete-review').disabled = !state.weeklyReviewPersisted;
  if (!review) {
    $('#weekly-rerun').disabled = true;
    $('#weekly-rerun').title = 'Choose a saved review before recalculating it.';
    setWeeklySeason(state.weeklySelectedSeason);
    renderWeeklyPlayerBoard(null);
    return;
  }
  const transientYahoo = review.persistence?.persisted === false && review.source === 'yahoo-live-transient-v1';
  $('#weekly-rerun').disabled = transientYahoo || !state.weeklyReviewPersisted;
  $('#weekly-rerun').title = transientYahoo ? 'Save this Yahoo preview with Update week from Yahoo before recalculating it.' : '';
  setWeeklySeason(review.season);
  if (savedSummary) {
    $('#weekly-season-status').textContent = `Viewing ${review.season} season · Week ${review.week} · saved revision ${savedSummary.revisions} · updated ${new Date(savedSummary.updatedAt).toLocaleString()}`;
  }
  $('#weekly-week').value = review.week;
  $('#weekly-history').value = state.weeklyReviewPersisted ? weeklyKey(review) : '';
  const target = review.targetResult || {};
  $('#weekly-result').textContent = target.result || 'PENDING';
  $('#weekly-score').textContent = `${target.score ?? '—'} vs ${target.opponentScore ?? '—'} · ${target.opponentName || 'opponent'}`;
  $('#weekly-rank').textContent = target.standingRank ? `#${target.standingRank}` : '—';
  $('#weekly-movement').textContent = movementLabel(target.positionMovement);
  $('#weekly-lineup-loss').textContent = `${review.lineup.pointsLeftOnBench} pts`;
  $('#weekly-lineup-score').textContent = `${review.lineup.actualPoints} actual · ${review.lineup.optimalPoints} optimal`;
  const winners = review.weeklyWinners || [];
  $('#weekly-winner').textContent = winners.map((item) => item.name).join(', ') || '—';
  $('#weekly-winner-score').textContent = winners.length ? `${winners[0].score} points` : 'No completed scores';

  const waiver = review.waiver.recommendation;
  $('#waiver-card').classList.toggle('hold', waiver.action === 'HOLD');
  $('#waiver-action').textContent = waiver.action === 'HOLD' ? 'HOLD — no worthwhile claim' : `ADD ${waiver.add.name}`;
  $('#waiver-move').textContent = waiver.action === 'ADD_DROP'
    ? `Drop ${waiver.drop.name} (${waiver.drop.position}) for ${waiver.add.name} (${waiver.add.position}).`
    : 'Keep the current roster and preserve waiver capital this week.';
  $('#waiver-gain').textContent = `${waiver.expectedPointsGained} expected points gained`;
  $('#waiver-faab').textContent = waiver.faab.recommended == null ? `${waiver.faab.percent}% FAAB guidance` : `$${waiver.faab.recommended} · ${waiver.faab.percent}% FAAB`;
  $('#waiver-confidence').textContent = `${waiver.confidenceLabel} confidence`;
  $('#waiver-reasons').innerHTML = waiver.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
  $('#waiver-priority').textContent = waiver.priorityGuidance;
  const plan = waiver.claimPlan || [];
  const considered = waiver.consideredAlternatives || [];
  $('#waiver-plan').innerHTML = plan.length > 1
    ? `<article><strong>Fallback claim order</strong><span>${plan.slice(1).map((item) => `${item.priority}. ${escapeHtml(item.add.name)} for ${escapeHtml(item.drop.name)} (+${item.expectedPointsGained})`).join(' · ')}</span></article>`
    : waiver.action === 'HOLD' && considered.length
      ? `<article><strong>Closest reviewed move</strong><span>${escapeHtml(considered[0].add.name)} for ${escapeHtml(considered[0].drop.name)} (+${considered[0].expectedPointsGained}; below threshold)</span></article>`
      : '';
  renderWeeklyPlayerBoard(review);

  $('#weekly-standings').innerHTML = review.standings.map((team) => `<tr class="${team.teamId === target.teamId ? 'target-team-row' : ''}">
    <td>${team.standingRank ?? '—'}</td><td><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(team.result || 'pending')}</small></td>
    <td>${team.score}</td><td>${team.pointsFor ?? '—'}</td><td>${team.pointsAgainst ?? '—'}</td><td>${escapeHtml(movementLabel(team.positionMovement))}</td>
  </tr>`).join('');
  $('#weekly-roster').innerHTML = review.roster.map((player) => `<tr><td><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.position)} · ${escapeHtml(player.nflTeam || 'FA')}</small></td><td>${escapeHtml(player.rosterSlot || '—')}</td><td>${player.actualPoints ?? '—'}</td><td>${player.projectedPoints ?? '—'}</td></tr>`).join('');
  $('#weekly-switches').innerHTML = review.lineup.suggestedSwitches.length
    ? review.lineup.suggestedSwitches.map((item) => `<article><strong>Start ${escapeHtml(item.start.name)}</strong><span>${item.start.actualPoints} pts${item.sit ? ` · sit ${escapeHtml(item.sit.name)} (${item.sit.actualPoints} pts)` : ''}</span></article>`).join('')
    : '<article><strong>Best lineup used</strong><span>No points were left on the bench.</span></article>';
  $('#weekly-risks').innerHTML = review.lineupRisks.length
    ? review.lineupRisks.map((item) => `<article class="risk-${escapeHtml(item.severity)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.risks.join(' · '))} · ${escapeHtml(item.rosterSlot || 'roster')}</span></article>`).join('')
    : '<article><strong>No immediate risks</strong><span>No bye, injury, or zero-projection starter was detected.</span></article>';
  $('#weekly-transactions').innerHTML = review.transactions.length
    ? review.transactions.map((item) => `<article><strong>${escapeHtml(item.type.toUpperCase())}</strong><span>${escapeHtml([...(item.playersAdded || []), ...(item.playersDropped || [])].map((player) => player.name || player).join(' · ') || item.teamId || 'League transaction')}</span></article>`).join('')
    : '<article><strong>No transactions imported</strong><span>Adds, drops, trades, and waiver results remain empty for this snapshot.</span></article>';
  const evidence = review.evidence;
  $('#weekly-evidence').innerHTML = [
    ['League scoring', 'Applied to raw projected and actual stats when supplied'],
    ['Yahoo authority', evidence.yahooAuthority],
    ['Shared player source', `${evidence.sharedPlayerSource} · ${evidence.sharedFetchedAt ? new Date(evidence.sharedFetchedAt).toLocaleString() : 'bundled/current cache'}`],
    ['Available pool', `${evidence.availablePlayersReviewed} league-visible players reviewed`],
    ['Source coverage', `${evidence.sourceCoverage.fantasyPros} FantasyPros · ${evidence.sourceCoverage.tank01} Tank01 · ${evidence.sourceCoverage.sleeper} Sleeper`]
  ].map(([label, value]) => `<article><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></article>`).join('');
}

async function loadWeekly(reviewKey, { season } = {}) {
  const explicitParts = reviewKey ? reviewKey.split(':').map(Number) : null;
  const selectedSeason = setWeeklySeason(
    explicitParts?.[0] || validWeeklySeason(season) || state.weeklySelectedSeason || authoritativeYahooSeason() || new Date().getFullYear()
  );
  const [result, yahoo] = await Promise.all([
    api(scoped('/weekly/weeks')),
    reviewKey ? Promise.resolve(null) : api(scoped('/weekly/yahoo/latest')).catch(() => null)
  ]);
  state.weeklyWeeks = result.weeks;
  state.yahooWeeklyStatus = yahoo;
  const seasonWeeks = result.weeks.filter((week) => week.season === selectedSeason);
  $('#weekly-history').innerHTML = `<option value="">${seasonWeeks.length ? `Latest saved week · ${selectedSeason}` : `No saved weeks · ${selectedSeason}`}</option>` + seasonWeeks.map((week) =>
    `<option value="${week.season}:${week.week}">${week.season} · Week ${week.week} · revision ${week.revisions} · ${escapeHtml(week.waiverAction)}</option>`).join('');
  setWeeklySeason(selectedSeason);
  if (!reviewKey && yahoo?.review && yahoo.review.season === selectedSeason) {
    renderWeekly(yahoo.review);
    $('#weekly-week').value = yahoo.week;
    const coverage = yahoo.candidateCoverage;
    $('#weekly-message').textContent = yahoo.persistence === 'normalized-week-revision'
      ? `Yahoo Week ${yahoo.week} saved as revision ${yahoo.savedRevision}. ${coverage ? `${coverage.retrieved} available players were reviewed. ` : ''}Refresh again whenever the league changes.`
      : `Current Yahoo Week ${yahoo.week} preview · ${coverage ? `${coverage.retrieved} available players across ${coverage.pages} page${coverage.pages === 1 ? '' : 's'} · ` : ''}select Update week from Yahoo to save it.`;
    return;
  }
  if (!seasonWeeks.length && !reviewKey) {
    renderWeekly(null);
    $('#weekly-message').textContent = `No saved weeks for ${selectedSeason}. ${authoritativeYahooSeason() === selectedSeason ? 'Update this week from Yahoo to create its first saved revision, or import a normalized snapshot.' : 'Import a normalized historical snapshot to add one.'}`;
    return;
  }
  const selected = reviewKey || `${seasonWeeks[0].season}:${seasonWeeks[0].week}`;
  const [reviewSeason, week] = selected.split(':').map(Number);
  const review = await api(scoped(`/weekly/weeks/${week}?season=${reviewSeason}`));
  renderWeekly(review);
}

async function refreshWeeklyFromYahoo() {
  if (!yahooSyncEligible()) {
    $('#weekly-message').textContent = 'This is a demo or manual league. Use the normalized JSON workflow; Yahoo refresh does not apply.';
    return;
  }
  const button = $('#weekly-yahoo-refresh');
  button.disabled = true;
  $('#weekly-message').textContent = 'Reading Yahoo standings, matchup, roster, transactions, and available players…';
  try {
    const yahooSeason = authoritativeYahooSeason();
    let season = Number($('#weekly-season').value);
    if (yahooSeason && season !== yahooSeason) {
      const requestedSeason = season;
      season = yahooSeason;
      setWeeklySeason(yahooSeason);
      showToast(`Yahoo refresh changed from ${requestedSeason} to ${state.league.name}'s authoritative ${yahooSeason} season.`);
    }
    const result = await api(scoped('/weekly/yahoo/refresh'), {
      method: 'POST',
      body: JSON.stringify({
        week: Number($('#weekly-week').value),
        season
      })
    });
    state.yahooWeeklyStatus = result;
    await refreshFleetSummary();
    await loadWeekly(`${result.season}:${result.week}`);
    const coverage = result.candidateCoverage;
    $('#weekly-message').textContent = `Yahoo Week ${result.week} saved as revision ${result.savedRevision}. ${coverage ? `${coverage.retrieved} available players were reviewed across ${coverage.pages} page${coverage.pages === 1 ? '' : 's'}. ` : ''}Update again whenever rosters, waivers, injuries, or projections change.`;
    showToast(`Yahoo Week ${result.week} revision ${result.savedRevision} saved. Review the guidance and make all changes in Yahoo.`);
  } catch (error) {
    $('#weekly-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function importWeekly() {
  const button = $('#weekly-import');
  button.disabled = true;
  $('#weekly-message').textContent = 'Calculating this league’s weekly review…';
  try {
    const snapshot = JSON.parse($('#weekly-json').value);
    const week = Number(snapshot.week || $('#weekly-week').value);
    const season = Number(snapshot.season || $('#weekly-season').value);
    setWeeklySeason(season);
    const result = await api(scoped(`/weekly/weeks/${week}/import?season=${season}`), {
      method: 'POST',
      body: JSON.stringify({ snapshot: { ...snapshot, week, season }, eventId: `dashboard:${state.leagueId}:${season}:${week}:${Date.now()}` })
    });
    await refreshFleetSummary();
    await loadWeekly(`${result.review.season}:${result.review.week}`);
    showToast(`Week ${result.review.week} saved for ${state.league.name}. ${result.review.waiver.recommendation.action} recommendation ready.`);
  } catch (error) {
    $('#weekly-message').textContent = error instanceof SyntaxError ? `Snapshot JSON is invalid: ${error.message}` : error.message;
  } finally {
    button.disabled = false;
  }
}

async function rerunWeekly() {
  if (!state.weeklyReview || !state.weeklyReviewPersisted) return;
  const button = $('#weekly-rerun');
  button.disabled = true;
  try {
    const review = state.weeklyReview;
    const result = await api(scoped(`/weekly/weeks/${review.week}/run?season=${review.season}`), { method: 'POST', body: '{}' });
    await loadWeekly(`${result.review.season}:${result.review.week}`);
    showToast(`Week ${result.review.week} recalculated using current shared provider evidence and isolated league rules.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function changeWeeklySeason() {
  const season = validWeeklySeason($('#weekly-season').value);
  if (!season) {
    showToast('Season must be a four-digit year from 2020 through 2100.');
    $('#weekly-season').value = state.weeklySelectedSeason || authoritativeYahooSeason() || new Date().getFullYear();
    return;
  }
  setWeeklySeason(season);
  try {
    await loadWeekly(undefined, { season });
  } catch (error) {
    $('#weekly-message').textContent = error.message;
  }
}

async function deleteWeeklyReview() {
  const review = state.weeklyReview;
  if (!review || !state.weeklyReviewPersisted) return;
  if (!window.confirm(`Permanently delete ${state.league.name}'s saved ${review.season} Week ${review.week}? This cannot be undone.`)) return;
  try {
    await api(scoped(`/weekly/weeks/${review.week}?season=${review.season}`), { method: 'DELETE' });
    await refreshFleetSummary();
    await loadWeekly(undefined, { season: review.season });
    showToast(`${review.season} Week ${review.week} deleted.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function clearWeeklySeason() {
  const season = state.weeklySelectedSeason;
  const count = state.weeklyWeeks.filter((review) => review.season === season).length;
  if (!count || !window.confirm(`Permanently delete all ${count} saved ${season} week${count === 1 ? '' : 's'} for ${state.league.name}? Other seasons and leagues will not be changed.`)) return;
  try {
    await api(scoped(`/weekly/weeks?season=${season}`), { method: 'DELETE' });
    await refreshFleetSummary();
    await loadWeekly(undefined, { season });
    showToast(`Cleared ${count} saved ${season} week${count === 1 ? '' : 's'} for ${state.league.name}.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function createSession(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const sourceMode = $('#source-mode').value;
    if (sourceMode === 'yahoo') await refreshYahooDraftPosition({ silent: true });
    const session = await api(scoped('/draft/sessions'), {
      method: 'POST',
      body: JSON.stringify({ draftSlot: Number($('#draft-slot').value), sourceMode })
    });
    localStorage.setItem(sessionKey(), session.id);
    state.yahooDraftSync = session.yahooSync || null;
    state.session = session;
    $('#draft-session-history').classList.add('hidden');
    showDraftRoom();
    await refresh();
    startPolling();
    await refreshFleetSummary();
  } catch (error) {
    $('#draft-slot-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function resumeSession(id) {
  try {
    state.session = await api(scoped(`/draft/sessions/${id}`));
    if (state.session.status !== 'active') {
      localStorage.removeItem(sessionKey());
      state.session = null;
      await loadDraftSessions();
      showToast('That draft session is completed. Reopen it from Draft history before resuming.');
      return;
    }
    localStorage.setItem(sessionKey(), id);
    showDraftRoom();
    await refresh();
    startPolling();
  } catch {
    localStorage.removeItem(sessionKey());
  }
}

function showDraftRoom() {
  $('#setup').classList.add('hidden');
  $('#draft-session-history').classList.add('hidden');
  $('#draft-room').classList.remove('hidden');
  $('#complete-session').disabled = state.session.status !== 'active';
  $('#complete-session').textContent = state.session.status === 'active' ? 'Complete session' : 'Draft completed';
  $('#pick-form button[type="submit"]').disabled = state.session.status !== 'active';
  const yahooMode = state.session.sourceMode === 'yahoo' && yahooSyncEligible();
  $('#sync-label').textContent = yahooMode
    ? `Yahoo sync · ${state.league.name}`
    : `${selectedLeagueSummary()?.connectionType === 'demo' ? 'Demo' : state.session.sourceMode} session · ${state.league.name}`;
  $('#yahoo-draft-sync').classList.toggle('hidden', !yahooMode);
  if (yahooMode) renderYahooDraftSync(state.yahooDraftSync);
  const screenshotMode = state.session.sourceMode === 'screenshot';
  $('#screenshot-assistant').classList.toggle('hidden', !screenshotMode);
  $('#reconcile-help').textContent = screenshotMode
    ? 'Choose what the Yahoo screenshot shows, analyze it through OpenRouter, then confirm every extracted row. Draft logs create picks; other pages add review-only evidence.'
    : 'Until Yahoo OAuth is connected, record each selection here. The board refreshes immediately.';
  if (screenshotMode) {
    const configured = Boolean(state.providerStatus?.vision?.configured);
    $('#analyze-screenshot').disabled = !configured || !state.screenshotFile;
    $('#screenshot-message').textContent = configured
      ? 'Choose a Yahoo screenshot and its purpose. It is sent transiently to OpenRouter only after you click Analyze screenshot.'
      : 'Preview only: set OPENROUTER_API_KEY and restart Huddle to enable screenshot analysis.';
    updateScreenshotPurpose({ resetAnalysis: false });
  }
}

function renderYahooDraftSync(status) {
  if (!status || state.session?.sourceMode !== 'yahoo') return;
  state.yahooDraftSync = status;
  const panel = $('#yahoo-draft-sync');
  panel.classList.remove('sync-ready', 'sync-degraded', 'sync-blocked');
  const stateName = status.state || 'stopped';
  if (stateName === 'running') panel.classList.add('sync-ready');
  if (['degraded', 'blocked'].includes(stateName)) panel.classList.add(`sync-${stateName}`);
  $('#yahoo-draft-sync-state').textContent = stateName === 'running'
    ? `Running · ${status.observedPicks || 0} picks observed`
    : stateName.charAt(0).toUpperCase() + stateName.slice(1);
  $('#yahoo-draft-sync-detail').textContent = status.lastError
    ? `${status.lastError.code}: ${status.lastError.message}. Use manual entry while resolving this.`
    : status.lastSuccessAt
      ? `Last Yahoo read ${new Date(status.lastSuccessAt).toLocaleTimeString()} · every ${status.configuredIntervalSeconds || 15}s · recommendation only.`
      : `Waiting for the first Yahoo read · every ${status.configuredIntervalSeconds || 15}s · recommendation only.`;
  $('#yahoo-draft-sync-start').disabled = ['running', 'starting'].includes(stateName);
  $('#yahoo-draft-sync-stop').disabled = stateName === 'stopped';
}

async function controlYahooDraftSync(action) {
  if (!state.session || state.session.sourceMode !== 'yahoo') return;
  const suffix = action === 'start' ? '' : `/${action}`;
  try {
    const status = await api(scoped(`/draft/sessions/${state.session.id}/yahoo-sync${suffix}`), { method: 'POST', body: '{}' });
    renderYahooDraftSync(status);
    if (action === 'once') await refresh();
  } catch (error) {
    renderYahooDraftSync({
      leagueId: state.leagueId,
      sessionId: state.session.id,
      state: 'blocked',
      lastError: { code: 'YAHOO_SYNC_FAILED', message: error.message }
    });
  }
}

function renderChoice(prefix, choice) {
  $(`#${prefix}-name`).textContent = choice ? choice.player.name : '—';
  $(`#${prefix}-meta`).textContent = choice ? `${choice.player.position} · ${choice.score} score` : '';
}

function trendBadge(player) {
  if (player.sleeperTrend?.direction === 'rising') return '<span class="badge trend-rising">SLEEPER RISING</span>';
  if (player.sleeperTrend?.direction === 'falling') return '<span class="badge trend-falling">SLEEPER FALLING</span>';
  return '';
}

function renderBoardRows() {
  const position = state.boardPosition;
  const board = state.recommendation?.board || [];
  const visible = position === 'ALL' ? board : board.filter((item) => item.player.position === position);
  $('#board-title').textContent = position === 'ALL' ? 'Best available' : `Best available · ${position}`;
  $('#board-body').innerHTML = visible.length ? visible.map((item, index) => `
    <tr class="board-player" data-player-id="${escapeHtml(item.player.id)}" data-roster-blocked="${item.rosterFeasible === false}" tabindex="0" role="button" aria-label="Select ${escapeHtml(item.player.name)} as the drafted player" title="${escapeHtml(item.rosterFeasible === false ? (item.rosterConstraint?.reasons || []).join(' ') : '')}">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(item.player.name)}</strong><small>${escapeHtml(item.player.team)}</small></td>
      <td><span class="position">${escapeHtml(item.player.position)}</span></td>
      <td><strong>${item.score}</strong></td>
      <td>${Math.round(item.waitProbability * 100)}%</td>
      <td>${[
        item.sleeper ? '<span class="badge">SLEEPER</span>' : '',
        item.rosterFeasible === false ? '<span class="badge roster-blocked-badge">ROSTER BLOCKED</span>' : '',
        trendBadge(item.player),
        item.player.sourceDisagreement ? '<span class="badge source-split">SOURCES SPLIT</span>' : '',
        ...(item.evidenceTags || []).map((tag) => `<span class="badge evidence-tag">${escapeHtml(tag)}</span>`)
      ].filter(Boolean).join(' ')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-board">No undrafted players are loaded at this position.</td></tr>';
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

function setBoardHeight(height) {
  const board = $('#board-scroll');
  const maximum = Math.max(440, Math.floor(window.innerHeight * 0.82));
  const next = Math.max(280, Math.min(maximum, Math.round(height)));
  board.style.height = `${next}px`;
  localStorage.setItem(BOARD_HEIGHT_KEY, String(next));
}

function renderRecommendation(card) {
  state.recommendation = card;
  $('#current-pick').textContent = card.currentOverall;
  $('#next-turn').textContent = card.nextUserPick || 'slot required';
  $('#coverage').textContent = card.evidence.complete ? card.evidence.source : `${card.evidence.source} · partial projections`;
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
  renderBoardRows();
}

function renderUnresolvedPlayers(payload) {
  state.unresolvedPlayers = payload?.players || [];
  const panel = $('#unresolved-panel');
  panel.classList.toggle('hidden', !state.unresolvedPlayers.length);
  $('#unresolved-count').textContent = state.unresolvedPlayers.length;
  $('#unresolved-list').innerHTML = state.unresolvedPlayers.map((item) => `
    <article><strong>${escapeHtml(item.playerName || 'Unknown player')} · ${escapeHtml(item.position || '—')}</strong><small>${escapeHtml(item.kind.replaceAll('-', ' '))} · ${escapeHtml(item.resolution)}</small></article>
  `).join('');
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
  const tank01 = state.providerStatus?.tank01;
  const sleeper = state.providerStatus?.sleeper;
  const vision = state.providerStatus?.vision;
  const screenshotReviews = evidence.screenshotReviews || {};
  const reconciliation = evidence.sourceReconciliation || {};
  const configuredSourceWeights = reconciliation.configuredWeights || {};
  const effectiveSourceWeights = reconciliation.effectiveWeights || {};
  const sourceCoverage = reconciliation.coverage || {};
  const sourceErrors = reconciliation.errors || [];
  const rows = [
    ['Player evidence', `${evidence.source || 'unknown'} · ${evidence.season || 'season unknown'} · ${evidence.complete ? 'complete projections' : 'operational with disclosed estimates'}`],
    ['Projection coverage', evidence.projectionCoverage ? `${evidence.projectionCoverage.projected}/${evidence.projectionCoverage.ranked} players (${Math.round(evidence.projectionCoverage.coverage * 100)}%) have provider projections` : 'Coverage metadata unavailable'],
    ['Evidence timestamp', sourceTime],
    ['League context', `${league.name || state.league.name} · ${league.teamCount || state.league.teamCount} teams · ${league.scoringType || state.league.scoringType}`],
    ['Roster demand', roster || 'Not available'],
    ['Scoring inputs', `${offense.reception ?? '—'} PPR · ${offense.passingTouchdown ?? '—'} pass-TD points · ${offense.passingYardsPerPoint ?? '—'} pass yards/point`],
    ['Player inputs', (evidence.ranking?.playerInputs || []).join(' · ')],
    ['Factor weights', weights || 'Not available'],
    ['Computed logic', (evidence.ranking?.computedFactors || []).join(' · ')],
    ['Source consensus', `Configured FantasyPros ${Math.round((configuredSourceWeights.fantasyPros ?? 0.675) * 100)}% · Tank01 ${Math.round((configuredSourceWeights.tank01 ?? 0.325) * 100)}% · effective FantasyPros ${Math.round((effectiveSourceWeights.fantasyPros ?? 1) * 100)}% / Tank01 ${Math.round((effectiveSourceWeights.tank01 ?? 0) * 100)}%`],
    ['Source coverage', `${sourceCoverage.tank01Matched ?? 0}/${sourceCoverage.primaryPlayers ?? state.availablePlayers.length} Tank01 matches · ${sourceCoverage.sleeperMatched ?? 0} Sleeper trend matches`],
    ['Source warnings', sourceErrors.length ? sourceErrors.map((item) => `${item.provider}: ${item.message}`).join(' · ') : 'No optional-source errors'],
    ['FantasyPros refresh', refresh && quota ? `${refresh.enabled ? `automatic every ${refresh.intervalHours}h` : 'manual/cache only'} · ${quota.estimatedUsed}/${quota.budget} local daily request budget used` : 'Status unavailable'],
    ['Tank01 evidence', tank01 ? `${tank01.configured ? 'enabled' : 'key not configured'} · 24h cache · ${tank01.quota.estimatedUsed}/${tank01.quota.budget} local monthly budget used` : 'Status unavailable'],
    ['Sleeper trend', sleeper ? `${sleeper.configured ? 'enabled' : 'disabled'} · ${sleeper.role} · attribution: ${sleeper.attribution}` : 'Status unavailable'],
    ['Yahoo authority', reconciliation.yahooRole || 'Yahoo league scoring and confirmed availability remain authoritative filters.'],
    ['Screenshot vision', vision ? `${vision.configured ? 'enabled' : 'not configured'} · ${vision.provider} · ${vision.model} · confirmation required` : 'Status unavailable'],
    ['Screenshot evidence', screenshotReviews.count
      ? `${screenshotReviews.count} saved review${screenshotReviews.count === 1 ? '' : 's'} · ${screenshotReviews.confirmedObservations} matched visible rows · latest ${String(screenshotReviews.latestPurpose || '').replaceAll('_', ' ')}`
      : 'No availability, roster, or waiver evidence saved'],
    ['Evidence semantics', screenshotReviews.semantics || 'Visible rows are positive evidence; omitted rows remain unknown.'],
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
  state.screenshotAnalysis = null;
  state.screenshotReviewEventId = null;
  $('#screenshot-saved').classList.add('hidden');
  state.screenshotObjectUrl = URL.createObjectURL(file);
  $('#screenshot-image').src = state.screenshotObjectUrl;
  $('#screenshot-meta').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  $('#screenshot-preview').classList.remove('hidden');
  $('#screenshot-results').classList.add('hidden');
  const configured = Boolean(state.providerStatus?.vision?.configured);
  $('#analyze-screenshot').disabled = !configured;
  $('#screenshot-message').textContent = configured
    ? `${SCREENSHOT_PURPOSE_COPY[selectedScreenshotPurpose()].help} Click Analyze screenshot to send it transiently through OpenRouter.`
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
  state.screenshotAnalysis = analysis;
  state.screenshotCandidates = analysis.candidates || [];
  state.screenshotReviewEventId = `vision-review:${analysis.purpose}:${Date.now()}`;
  $('#screenshot-summary').textContent = `${analysis.screenshotType.replaceAll('_', ' ')} · ${analysis.summary || 'Analysis complete.'}`;
  $('#screenshot-warnings').innerHTML = (analysis.warnings || []).map((warning) => `<p>${escapeHtml(warning)}</p>`).join('');
  $('#screenshot-analysis-notes').open = !analysis.compatible || !state.screenshotCandidates.length;
  const pickMode = analysis.applyMode === 'pick-events';
  $('#screenshot-candidates').innerHTML = state.screenshotCandidates.map((candidate, index) => {
    const context = pickMode
      ? `Pick ${candidate.overallPick || 'unknown'}`
      : [candidate.rosterSlot, candidate.evidenceStatus, candidate.ownershipPercent == null ? null : `${candidate.ownershipPercent}% rostered`].filter(Boolean).join(' · ') || 'Visible player row';
    return `
      <article class="vision-candidate" data-candidate-index="${index}">
        <header><span>${escapeHtml(context)}</span><span>${Math.round(candidate.confidence * 100)}% · ${escapeHtml(candidate.status)}</span></header>
        <input type="search" list="player-options" data-candidate-player value="${escapeHtml(candidatePlayerValue(candidate))}" aria-label="Player for extracted ${pickMode ? 'pick' : 'evidence row'} ${index + 1}">
        <label class="check"><input type="checkbox" data-candidate-include ${candidate.actionable ? 'checked' : ''}> Include this ${pickMode ? 'pick' : 'evidence row'}</label>
        ${pickMode ? `<label class="check"><input type="checkbox" data-candidate-mine ${candidate.isMine ? 'checked' : ''}> This was my pick</label>` : ''}
      </article>`;
  }).join('');
  const applyButton = $('#apply-screenshot-review');
  applyButton.textContent = pickMode ? 'Apply confirmed picks' : 'Save confirmed evidence';
  applyButton.classList.toggle('hidden', !state.screenshotCandidates.length);
  $('#screenshot-results').classList.remove('hidden');
}

async function analyzeScreenshot() {
  if (!state.screenshotFile) return;
  const button = $('#analyze-screenshot');
  button.disabled = true;
  const purpose = selectedScreenshotPurpose();
  $('#screenshot-message').textContent = 'OpenRouter is analyzing the screenshot. Nothing will be applied automatically.';
  try {
    const analysis = await api(scoped(`/draft/sessions/${state.session.id}/analyze-screenshot`), {
      method: 'POST',
      body: JSON.stringify({ dataUrl: await fileDataUrl(state.screenshotFile), purpose })
    });
    renderScreenshotAnalysis(analysis);
    $('#screenshot-message').textContent = analysis.compatible
      ? SCREENSHOT_PURPOSE_COPY[purpose].ready
      : `The detected ${analysis.screenshotType.replaceAll('_', ' ')} does not match the selected purpose. Change the purpose or choose another image.`;
  } catch (error) {
    $('#screenshot-message').textContent = error.message;
  } finally {
    button.disabled = !state.providerStatus?.vision?.configured;
  }
}

async function applyScreenshotReview() {
  const rows = [...document.querySelectorAll('.vision-candidate')];
  const button = $('#apply-screenshot-review');
  const analysis = state.screenshotAnalysis;
  if (!analysis) return;
  button.disabled = true;
  const included = rows.filter((row) => row.querySelector('[data-candidate-include]').checked);
  if (!included.length) {
    $('#screenshot-message').textContent = 'Select at least one reviewed row before saving.';
    button.disabled = false;
    return;
  }
  let applied = 0;
  let confirmation = '';
  try {
    if (analysis.applyMode === 'pick-events') {
      for (const row of included) {
        const candidate = state.screenshotCandidates[Number(row.dataset.candidateIndex)];
        const player = findPlayer(row.querySelector('[data-candidate-player]').value);
        if (!player) throw new Error(`Match ${candidate.playerName} to a loaded player before applying the screenshot.`);
        const result = await api(scoped(`/draft/sessions/${state.session.id}/picks`), {
          method: 'POST',
          body: JSON.stringify({
            eventId: candidate.candidateId,
            overallPick: candidate.overallPick,
            playerId: player.id,
            isMine: row.querySelector('[data-candidate-mine]')?.checked || false,
            source: 'openrouter-screenshot'
          })
        });
        if (result.applied) applied += 1;
      }
      confirmation = `${applied} reviewed pick${applied === 1 ? '' : 's'} applied. Draft board refreshed and ready for the next pick.`;
    } else {
      const observations = included.map((row) => {
        const candidate = state.screenshotCandidates[Number(row.dataset.candidateIndex)];
        const typedValue = row.querySelector('[data-candidate-player]').value.trim();
        const player = findPlayer(typedValue);
        const unchanged = typedValue.toLowerCase() === candidatePlayerValue(candidate).toLowerCase();
        return {
          ...candidate,
          playerId: player?.id || (unchanged ? candidate.playerId : null),
          playerName: player?.name || typedValue || candidate.playerName,
          position: player?.position || candidate.position,
          nflTeam: player?.team || candidate.nflTeam
        };
      });
      const result = await api(scoped(`/draft/sessions/${state.session.id}/evidence-reviews`), {
        method: 'POST',
        body: JSON.stringify({
          eventId: state.screenshotReviewEventId,
          purpose: analysis.purpose,
          source: 'openrouter-screenshot',
          observations
        })
      });
      applied = result.review?.observations?.length || 0;
      const matched = result.review?.observations?.filter((item) => item.status === 'confirmed').length || 0;
      confirmation = `${applied} evidence row${applied === 1 ? '' : 's'} saved (${matched} matched). Draft board refreshed; ranking scores remain unchanged.`;
    }
    await refresh();
    await refreshFleetSummary();
    finishScreenshotReview(confirmation);
  } catch (error) {
    $('#screenshot-message').textContent = `${applied} row${applied === 1 ? '' : 's'} saved before review stopped: ${error.message}`;
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
  const [session, card, pool, providerStatus, unresolved, yahooSync] = await Promise.all([
    api(scoped(`/draft/sessions/${state.session.id}`)),
    api(scoped(`/draft/sessions/${state.session.id}/recommendation`)),
    api(scoped(`/players?sessionId=${state.session.id}`)),
    shouldRefreshProviderStatus ? api('/api/provider-status') : Promise.resolve(null),
    api(scoped('/unresolved-players')),
    state.session.sourceMode === 'yahoo'
      ? api(scoped(`/draft/sessions/${state.session.id}/yahoo-sync`)).catch((error) => ({ state: 'degraded', lastError: { code: 'YAHOO_SYNC_STATUS_FAILED', message: error.message } }))
      : Promise.resolve(null)
  ]);
  if (providerStatus) {
    state.providerStatus = providerStatus;
    state.providerStatusAt = Date.now();
  }
  state.session = session;
  if (session.status === 'completed') {
    clearInterval(state.timer);
    $('#complete-session').disabled = true;
    $('#complete-session').textContent = 'Draft completed';
    localStorage.removeItem(sessionKey());
  }
  $('#pick-form button[type="submit"]').disabled = session.status !== 'active';
  if (yahooSync) renderYahooDraftSync(yahooSync);
  renderUnresolvedPlayers(unresolved);
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
  state.leagues = applySavedLeagueOrder(fleet.leagues);
  state.defaultLeagueId = fleet.defaultLeagueId;
  renderLeagueSelector();
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
  state.yahooDraftSync = null;
  if (state.screenshotObjectUrl) URL.revokeObjectURL(state.screenshotObjectUrl);
  state.screenshotObjectUrl = null;
  state.screenshotFile = null;
  state.screenshotCandidates = [];
  state.screenshotAnalysis = null;
  state.screenshotReviewEventId = null;
  $('#screenshot-file').value = '';
  $('#screenshot-preview').classList.add('hidden');
  $('#screenshot-results').classList.add('hidden');
  $('#screenshot-saved').classList.add('hidden');
  $('#analyze-screenshot').disabled = true;
  clearTimeout(toastTimer);
  $('#app-toast').classList.add('hidden');
  $('#manual-player-fields').classList.add('hidden');
  $('#manual-player-toggle').textContent = 'Player not found?';
  $('#draft-room').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  await Promise.all([refreshFleetSummary(), loadDraftSessions()]);
}

async function init() {
  $('#draft-mode').addEventListener('click', () => showMode('draft'));
  $('#weekly-mode').addEventListener('click', () => showMode('weekly'));
  $('#weekly-template').addEventListener('click', () => { $('#weekly-json').value = JSON.stringify(weeklyTemplate(), null, 2); });
  $('#weekly-import').addEventListener('click', importWeekly);
  $('#weekly-rerun').addEventListener('click', rerunWeekly);
  $('#weekly-yahoo-refresh').addEventListener('click', refreshWeeklyFromYahoo);
  $('#weekly-delete-review').addEventListener('click', deleteWeeklyReview);
  $('#weekly-clear-season').addEventListener('click', clearWeeklySeason);
  $('#weekly-season').addEventListener('change', changeWeeklySeason);
  $('#weekly-player-search').addEventListener('input', (event) => {
    state.weeklyPlayerSearch = event.target.value;
    renderWeeklyPlayerBoard();
  });
  $('#weekly-player-position').addEventListener('change', (event) => {
    state.weeklyPlayerPosition = event.target.value;
    renderWeeklyPlayerBoard();
  });
  $('#weekly-import-another').addEventListener('click', () => {
    $('#weekly-review').classList.add('hidden');
    $('#weekly-empty').classList.remove('hidden');
    $('#weekly-json').value = state.weeklyReview ? JSON.stringify({ season: state.weeklyReview.season, week: state.weeklyReview.week, teams: state.weeklyReview.teams, roster: state.weeklyReview.roster, availablePlayers: state.weeklyReview.availablePlayers, transactions: state.weeklyReview.transactions, waiver: state.weeklyReview.waiver.state }, null, 2) : '';
    $('#weekly-empty').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#weekly-history').addEventListener('change', (event) => loadWeekly(event.target.value || undefined));
  $('#weekly-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file) $('#weekly-json').value = await file.text();
  });
  $('#weekly-season').value = new Date().getFullYear();
  $('#add-league').addEventListener('click', openLeagueDialog);
  $('#empty-add-league').addEventListener('click', openLeagueDialog);
  $('#connect-yahoo').addEventListener('click', openYahooOnboarding);
  $('#empty-connect-yahoo').addEventListener('click', openYahooOnboarding);
  $('#dialog-connect-yahoo').addEventListener('click', startYahooOAuth);
  $('#discover-yahoo-leagues').addEventListener('click', discoverYahooLeagues);
  $('#league-form').addEventListener('submit', addLeague);
  $('#close-league-dialog').addEventListener('click', closeLeagueDialog);
  $('#cancel-league').addEventListener('click', closeLeagueDialog);
  $('#league-dialog').addEventListener('click', (event) => {
    if (event.target === $('#league-dialog')) closeLeagueDialog();
  });
  $('#add-team-count').addEventListener('input', (event) => { $('#add-draft-slot').max = event.target.value; });
  $('#session-form').addEventListener('submit', createSession);
  $('#refresh-yahoo-settings').addEventListener('click', refreshYahooSettings);
  $('#refresh-yahoo-draft-slot').addEventListener('click', () => refreshYahooDraftPosition());
  $('#rehearse-yahoo').addEventListener('click', rehearseYahoo);
  $('#yahoo-draft-sync-once').addEventListener('click', () => controlYahooDraftSync('once'));
  $('#yahoo-draft-sync-start').addEventListener('click', () => controlYahooDraftSync('start'));
  $('#yahoo-draft-sync-stop').addEventListener('click', () => controlYahooDraftSync('stop'));
  $('#pick-form').addEventListener('submit', recordPick);
  $('#complete-session').addEventListener('click', () => completeDraftSession());
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
  $('#position-filter').addEventListener('change', (event) => {
    state.boardPosition = event.target.value;
    renderBoardRows();
  });
  $('#board-shorter').addEventListener('click', () => setBoardHeight($('#board-scroll').getBoundingClientRect().height - 180));
  $('#board-taller').addEventListener('click', () => setBoardHeight($('#board-scroll').getBoundingClientRect().height + 180));
  $('#board-fit').addEventListener('click', () => setBoardHeight(window.innerHeight - 180));
  const savedBoardHeight = Number(localStorage.getItem(BOARD_HEIGHT_KEY));
  if (Number.isFinite(savedBoardHeight) && savedBoardHeight > 0) setBoardHeight(savedBoardHeight);
  if ('ResizeObserver' in window) {
    new ResizeObserver(([entry]) => {
      const height = Math.round(entry.contentRect.height);
      if (height >= 280) localStorage.setItem(BOARD_HEIGHT_KEY, String(height));
    }).observe($('#board-scroll'));
  }
  $('#screenshot-file').addEventListener('change', reviewScreenshot);
  $('#screenshot-purpose').addEventListener('change', () => updateScreenshotPurpose());
  $('#analyze-screenshot').addEventListener('click', analyzeScreenshot);
  $('#apply-screenshot-review').addEventListener('click', applyScreenshotReview);
  $('#manual-player-toggle').addEventListener('click', () => {
    const fields = $('#manual-player-fields');
    fields.classList.toggle('hidden');
    $('#manual-player-toggle').textContent = fields.classList.contains('hidden') ? 'Player not found?' : 'Use loaded player search';
    if (!fields.classList.contains('hidden')) {
      state.selectedPlayerId = null;
      syncPlayerHighlights();
    }
  });
  [state.providerStatus, state.leagueOnboarding, state.yahooOAuth] = await Promise.all([
    api('/api/provider-status'),
    api('/api/leagues/onboarding'),
    api('/api/yahoo/oauth/status')
  ]);
  renderYahooConnection();
  $('#league-onboarding-status').textContent = state.leagueOnboarding.message;
  $('#add-league').disabled = !state.leagueOnboarding.enabled;
  $('#empty-add-league').disabled = !state.leagueOnboarding.enabled;
  $('#add-league').title = state.leagueOnboarding.enabled ? 'Add a league to this Huddle fleet' : state.leagueOnboarding.message;
  state.providerStatusAt = Date.now();
  await loadFleet();
  showMode(state.mode);
  const callback = new URLSearchParams(window.location.search);
  if (callback.get('yahoo') === 'connected') {
    history.replaceState({}, '', window.location.pathname);
    showToast('Yahoo account connected with read-only access. Discovering your leagues…');
    await openYahooOnboarding();
  }
}

init().catch((error) => { document.body.innerHTML = `<pre>${escapeHtml(error.message)}</pre>`; });
