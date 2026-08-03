'use strict';

const state = {
  leagues: [],
  defaultLeagueId: null,
  leagueId: null,
  league: null,
  session: null,
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
  providerStatusAt: 0,
  timer: null
};
const $ = (selector) => document.querySelector(selector);
let toastTimer = null;
const BOARD_HEIGHT_KEY = 'huddle-best-available-height';
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
    <tr class="board-player" data-player-id="${escapeHtml(item.player.id)}" tabindex="0" role="button" aria-label="Select ${escapeHtml(item.player.name)} as the drafted player">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(item.player.name)}</strong><small>${escapeHtml(item.player.team)}</small></td>
      <td><span class="position">${escapeHtml(item.player.position)}</span></td>
      <td><strong>${item.score}</strong></td>
      <td>${Math.round(item.waitProbability * 100)}%</td>
      <td>${[
        item.sleeper ? '<span class="badge">SLEEPER</span>' : '',
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
  renderBoardRows();
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
    ['Player evidence', `${evidence.source || 'unknown'} · ${evidence.season || 'season unknown'} · ${evidence.complete ? 'complete' : 'incomplete'}`],
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
  state.providerStatus = await api('/api/provider-status');
  state.providerStatusAt = Date.now();
  await loadFleet();
}

init().catch((error) => { document.body.innerHTML = `<pre>${escapeHtml(error.message)}</pre>`; });
