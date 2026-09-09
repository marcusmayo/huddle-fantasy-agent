'use strict';

const { leagueProjection } = require('../domain/league-projections');
const { playerSnapshot } = require('../domain/player-snapshot');
const { yahooId } = require('./player-evidence');
const { DraftControllerService } = require('./draft-controller-service');
const { isFreshObservation } = require('../domain/observation-time');
const { digest, rankingPlayer, choiceSnapshot, appendEvent, verifyEvents, validatePlan } = require('../domain/decision-audit');

const crypto = require('node:crypto');
const { buildRecommendationCard, STYLES } = require('../domain/draft-board');
const { draftedRosterSize, pickOwner } = require('../domain/league');
const { prepareMockSnapshot, mockReadiness } = require('../domain/mock-room');

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const EVIDENCE_PURPOSES = new Set(['available_players', 'team_roster', 'waiver_players']);
const EVIDENCE_TAGS = {
  available_players: 'AVAILABLE',
  team_roster: 'ROSTER',
  waiver_players: 'WAIVER'
};

function manualPlayer(input) {
  const value = input?.manualPlayer;
  if (!value) return null;
  const name = String(value.name || '').trim();
  const position = String(value.position || '').trim().toUpperCase().replace('DST', 'DEF');
  const team = String(value.team || 'FA').trim().toUpperCase().slice(0, 8) || 'FA';
  if (name.length < 2 || name.length > 80 || !POSITIONS.has(position)) {
    const error = new Error('Manual player requires a name and valid QB, RB, WR, TE, K, or DEF position');
    error.code = 'INVALID_MANUAL_PLAYER';
    throw error;
  }
  const fingerprint = crypto.createHash('sha256').update(`${name.toLowerCase()}|${position}|${team}`).digest('hex').slice(0, 16);
  return { id: `manual:${fingerprint}`, name, position, team };
}

function externalYahooPlayer(input) {
  const value = input?.externalPlayer;
  if (!value) return null;
  const yahooPlayerKey = String(value.yahooPlayerKey || '').trim().slice(0, 120);
  if (!yahooPlayerKey) {
    const error = new Error('External Yahoo player requires yahooPlayerKey');
    error.code = 'INVALID_EXTERNAL_PLAYER';
    throw error;
  }
  const normalizedPosition = String(value.position || '').trim().toUpperCase().replace('D/ST', 'DEF').replace('DST', 'DEF');
  const position = POSITIONS.has(normalizedPosition) ? normalizedPosition : null;
  const yahooId = yahooPlayerKey.includes('.p.') ? yahooPlayerKey.split('.p.').at(-1) : yahooPlayerKey;
  const suppliedName = String(value.name || '').trim().slice(0, 80);
  return {
    id: `yahoo:${yahooPlayerKey}`,
    ...playerSnapshot(value),
    yahooPlayerKey,
    name: suppliedName.length >= 2 ? suppliedName : `Yahoo player ${yahooId}`,
    position,
    team: String(value.team || 'FA').trim().toUpperCase().slice(0, 8) || 'FA',
    resolutionStatus: position && suppliedName.length >= 2 ? 'resolved-yahoo' : 'unresolved-yahoo'
  };
}

class DraftService {
  constructor({ league, playerPool, store, evidenceRetentionDays = 30, now = () => new Date(), simulation = false }) {
    this.league = league;
    this.playerPool = playerPool;
    this.store = store;
    this.evidenceRetentionDays = Math.max(1, Math.min(30, Number(evidenceRetentionDays) || 30));
    this.now = now;
    this.simulation = simulation === true;
    this.state = store.load();
    this.state.sessions ||= {};
    this.state.draftAudit ||= { schemaVersion: 1, recommendations: {}, pools: {}, events: {} };
    this.controllers = new DraftControllerService(this);
    const pruned = this.pruneExpiredEvidence({ persist: false });
    if (pruned.deletedReviews || pruned.deletedSessions || pruned.deletedAuditSessions) this.persist();
  }

  currentIso() {
    return this.now().toISOString();
  }

  createSession({ draftSlot, sourceMode = 'manual', playerSource = this.playerPool.source }) {
    if (!Number.isInteger(draftSlot) || draftSlot < 1 || draftSlot > this.league.teamCount) {
      const error = new Error(`draftSlot must be between 1 and ${this.league.teamCount}`);
      error.code = 'INVALID_DRAFT_SLOT';
      throw error;
    }
    if (!['manual', 'yahoo', 'screenshot', 'mock'].includes(sourceMode)) {
      const error = new Error('sourceMode must be manual, yahoo, screenshot, or mock');
      error.code = 'INVALID_SOURCE_MODE';
      throw error;
    }
    if (sourceMode === 'mock' && !['manual', 'demo'].includes(this.league.platform)) {
      throw Object.assign(new Error('Create a separate manual practice league before using mock-room imports.'), { code: 'MOCK_SESSION_REQUIRED' });
    }
    const id = crypto.randomUUID();
    const now = this.currentIso();
    const session = {
      id,
      leagueId: this.league.id,
      draftSlot,
      sourceMode,
      playerSource,
      status: 'active',
      picks: [],
      appliedEventIds: [],
      evidenceReviews: [],
      appliedEvidenceEventIds: [],
      createdAt: now,
      updatedAt: now
    };
    this.state.sessions[id] = session;
    this.persist();
    return this.decorate(session);
  }

  listSessions() {
    return Object.values(this.state.sessions)
      .map((session) => this.decorate(session))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  getSession(id) {
    const session = this.state.sessions[id];
    if (!session) {
      const error = new Error(`Draft session not found: ${id}`);
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }
    return this.decorate(session);
  }

  updateDraftSlot(id, draftSlot, { source = 'operator-confirmed' } = {}) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    if (!Number.isInteger(draftSlot) || draftSlot < 1 || draftSlot > this.league.teamCount) {
      const error = new Error(`draftSlot must be between 1 and ${this.league.teamCount}`);
      error.code = 'INVALID_DRAFT_SLOT';
      throw error;
    }
    if (session.draftSlot === draftSlot) return this.decorate(session);
    session.draftSlot = draftSlot;
    session.draftSlotSource = source;
    session.updatedAt = this.currentIso();
    this.persist();
    return this.decorate(session);
  }

  completeSession(id, { reason = 'operator-completed' } = {}) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    if (session.status === 'completed') return this.decorate(session);
    const now = this.currentIso();
    session.status = 'completed';
    session.completionReason = String(reason || 'operator-completed').slice(0, 80);
    session.completedAt = now;
    session.updatedAt = now;
    this.persist();
    return this.decorate(session);
  }

  reopenSession(id) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    if (session.status === 'active') return this.decorate(session);
    session.status = 'active';
    delete session.completionReason;
    delete session.completedAt;
    session.updatedAt = this.currentIso();
    this.persist();
    return this.decorate(session);
  }

  deleteSession(id) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    delete this.state.sessions[id];
    delete this.state.draftAudit.recommendations[id];
    delete this.state.draftAudit.events[id];
    this.pruneAuditPools();
    this.persist();
    return {
      leagueId: this.league.id,
      sessionId: id,
      deleted: true,
      status: session.status,
      picks: session.picks.length
    };
  }

  recordPick(id, input) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    if (session.sourceMode === 'mock') {
      throw Object.assign(new Error('Import the complete Yahoo room snapshot to reconcile this practice session.'), { code: 'MOCK_SNAPSHOT_REQUIRED' });
    }
    if (!input?.playerId && !input?.manualPlayer && !input?.externalPlayer) {
      const error = new Error('playerId, manualPlayer, or externalPlayer is required');
      error.code = 'INVALID_PICK';
      throw error;
    }
    const fallbackPlayer = manualPlayer(input) || externalYahooPlayer(input);
    const player = this.playerPool.players.find((candidate) => candidate.id === input.playerId) || fallbackPlayer;
    if (!player) {
      const error = new Error(`Unknown player: ${input.playerId}`);
      error.code = 'UNKNOWN_PLAYER';
      throw error;
    }
    const playerId = player.id;
    const eventId = input.eventId || `manual:${session.picks.length + 1}:${playerId}`;
    if (session.appliedEventIds.includes(eventId)) {
      return { applied: false, reason: 'duplicate-event', session: this.decorate(session) };
    }
    if (session.status !== 'active') {
      const error = new Error('Draft session is completed; reopen it before recording another pick');
      error.code = 'DRAFT_SESSION_COMPLETED';
      throw error;
    }
    const candidateYahooId = yahooId({ ...player, yahooPlayerKey: input.yahooPlayerKey || player.yahooPlayerKey });
    if (session.picks.some((pick) => {
      if (pick.playerId === playerId) return true;
      const pickedYahooId = yahooId(pick);
      if (candidateYahooId && pickedYahooId) return candidateYahooId === pickedYahooId;
      // Display names, especially Yahoo abbreviations, cannot override distinct IDs.
      return !candidateYahooId && !pickedYahooId && pick.playerName.toLowerCase() === player.name.toLowerCase()
        && pick.position === player.position && pick.team === player.team;
    })) {
      return { applied: false, reason: 'player-already-drafted', session: this.decorate(session) };
    }
    const expectedOverall = session.picks.length + 1;
    if (input.overallPick && input.overallPick !== expectedOverall) {
      const error = new Error(`Expected overall pick ${expectedOverall}, received ${input.overallPick}`);
      error.code = 'OUT_OF_ORDER_PICK';
      throw error;
    }
    const before = structuredClone(session);
    const oldEvents = structuredClone(this.state.draftAudit.events[id] || []);
    session.picks.push({
      ...playerSnapshot(leagueProjection(player, this.league), { observedAt: this.currentIso(), source: input.source || session.sourceMode }),
      eventId,
      overallPick: expectedOverall,
      playerId,
      playerName: player.name,
      position: player.position,
      yahooPlayerKey: input.yahooPlayerKey || player.yahooPlayerKey || null,
      resolutionStatus: player.resolutionStatus || 'resolved-pool',
      teamId: input.teamId || null,
      isMine: Boolean(input.isMine),
      observedAt: input.observedAt || this.currentIso(),
      source: input.source || session.sourceMode
    });
    session.appliedEventIds.push(eventId);
    session.updatedAt = this.currentIso();
    const totalPicks = draftedRosterSize(this.league.roster) * this.league.teamCount;
    if (session.picks.length >= totalPicks) {
      session.status = 'completed';
      session.completionReason = 'draft-board-complete';
      session.completedAt = session.updatedAt;
    }
    this.auditAcceptedPick(id, session.picks.at(-1));
    try { this.persist(); } catch (error) {
      this.state.sessions[id] = before;
      this.state.draftAudit.events[id] = oldEvents;
      throw error;
    }
    return { applied: true, reason: null, session: this.decorate(session) };
  }

  recordEvidenceReview(id, input) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    const purpose = String(input?.purpose || '');
    if (!EVIDENCE_PURPOSES.has(purpose)) {
      const error = new Error('purpose must be available_players, team_roster, or waiver_players');
      error.code = 'INVALID_EVIDENCE_PURPOSE';
      throw error;
    }
    if (!Array.isArray(input.observations) || !input.observations.length || input.observations.length > 250) {
      const error = new Error('observations must contain between 1 and 250 reviewed player rows');
      error.code = 'INVALID_EVIDENCE_REVIEW';
      throw error;
    }
    session.evidenceReviews ||= [];
    session.appliedEvidenceEventIds ||= [];
    const eventId = String(input.eventId || `review:${purpose}:${crypto.randomUUID()}`);
    if (session.appliedEvidenceEventIds.includes(eventId)) {
      return { applied: false, reason: 'duplicate-event', session: this.decorate(session) };
    }

    const draftedIds = new Set(session.picks.map((pick) => pick.playerId));
    const observations = input.observations.map((item, index) => {
      const player = this.playerPool.players.find((candidate) => candidate.id === item.playerId) || null;
      const conflictsWithDraft = Boolean(player && draftedIds.has(player.id)
        && ['available_players', 'waiver_players'].includes(purpose));
      const ownership = item.ownershipPercent == null || item.ownershipPercent === ''
        ? Number.NaN
        : Number(item.ownershipPercent);
      return {
        observationId: String(item.candidateId || `${eventId}:${index + 1}`),
        playerId: player?.id || null,
        playerName: player?.name || String(item.playerName || '').trim().slice(0, 80),
        position: player?.position || String(item.position || '').trim().toUpperCase().replace('DST', 'DEF') || null,
        nflTeam: player?.team || String(item.nflTeam || '').trim().toUpperCase().slice(0, 8) || null,
        fantasyTeam: String(item.fantasyTeam || '').trim().slice(0, 80) || null,
        rosterSlot: String(item.rosterSlot || '').trim().slice(0, 20) || null,
        evidenceStatus: String(item.evidenceStatus || '').trim().slice(0, 30) || null,
        ownershipPercent: Number.isFinite(ownership) ? Math.max(0, Math.min(100, ownership)) : null,
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
        status: conflictsWithDraft ? 'conflict-drafted' : player ? 'confirmed' : 'unresolved-player'
      };
    });
    const now = this.currentIso();
    const review = {
      id: crypto.randomUUID(),
      eventId,
      purpose,
      source: String(input.source || 'openrouter-screenshot').slice(0, 50),
      observations,
      createdAt: now,
      expiresAt: new Date(this.now().getTime() + this.evidenceRetentionDays * 24 * 60 * 60 * 1_000).toISOString()
    };
    session.evidenceReviews.push(review);
    session.evidenceReviews = session.evidenceReviews.slice(-20);
    session.appliedEvidenceEventIds.push(eventId);
    session.appliedEvidenceEventIds = session.appliedEvidenceEventIds.slice(-100);
    session.updatedAt = now;
    this.persist();
    return { applied: true, reason: null, review: structuredClone(review), session: this.decorate(session) };
  }

  reconcileBrowserResults(id, input) {
    const session = this.getSession(id);
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    const age = this.now().getTime() - Date.parse(input?.observedAt);
    if (session.sourceMode !== 'yahoo') fail('BROWSER_RESULTS_LIVE_SESSION_REQUIRED', 'Use the mock snapshot importer for a practice session');
    if (!isFreshObservation(input?.observedAt, this.now().getTime())) fail('BROWSER_RESULTS_STALE', 'Read the Yahoo Results table again');
    if (!this.league.provenance?.yahooLeagueKey || input.leagueKey !== this.league.provenance.yahooLeagueKey
      || !this.league.provenance?.yahooTeamKey || input.teamKey !== this.league.provenance.yahooTeamKey
      || input.draftSlot !== session.draftSlot) fail('BROWSER_RESULTS_ROOM_MISMATCH', 'Results must match the active league, team and seat');
    const rows = input.picks;
    if (!Array.isArray(rows) || rows.length < session.picks.length || rows.length > session.totalPicks) fail('BROWSER_RESULTS_INCOMPLETE', 'Read the complete results prefix without dropping accepted picks');
    const ids = new Set();
    for (const [index, row] of rows.entries()) {
      if (row.overallPick !== index + 1 || !/^[1-9]\d*$/.test(String(row.yahooPlayerId || '')) || ids.has(String(row.yahooPlayerId))
        || !row.name || !POSITIONS.has(row.position) || row.isMine !== (pickOwner(index + 1, this.league.teamCount) === session.draftSlot)) fail('BROWSER_RESULTS_INVALID', 'Results need consecutive picks, unique Yahoo IDs, player positions and verified ownership');
      ids.add(String(row.yahooPlayerId));
      const existing = session.picks[index];
      if (existing && (yahooId(existing) !== String(row.yahooPlayerId) || existing.isMine !== row.isMine)) fail('BROWSER_RESULTS_CONFLICT', 'The observed results disagree with an accepted pick; inspect the room before continuing');
    }
    // Validate the whole prefix first. Each accepted pick is then durable and
    // idempotent, so interruption can resume from the last saved receipt.
    const before = session.picks.length;
    for (const row of rows.slice(before)) {
      const player = this.playerPool.players.find(p => yahooId(p) === String(row.yahooPlayerId));
      const key = player?.yahooPlayerKey || `nfl.p.${row.yahooPlayerId}`;
      const result = this.recordPick(id, { eventId: `yahoo-browser:${id}:${row.overallPick}:${row.yahooPlayerId}`,
        overallPick: row.overallPick, playerId: player?.id, yahooPlayerKey: key, isMine: row.isMine,
        source: 'yahoo-browser-results', observedAt: input.observedAt,
        externalPlayer: { name: row.name, position: row.position, team: row.team, yahooPlayerKey: key } });
      if (!result.applied) fail('BROWSER_RESULTS_CONFLICT', 'This result did not reconcile at its expected pick');
    }
    return { imported: rows.length - before, session: this.getSession(id), decisions: this.decisionSummary(id) };
  }

  deleteEvidenceReviews(id) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    const reviews = session.evidenceReviews || [];
    const removedEventIds = new Set(reviews.map((review) => review.eventId));
    session.evidenceReviews = [];
    session.appliedEvidenceEventIds = (session.appliedEvidenceEventIds || []).filter((eventId) => !removedEventIds.has(eventId));
    session.updatedAt = this.currentIso();
    this.persist();
    return { deletedReviews: reviews.length, session: this.decorate(session) };
  }

  pruneExpiredEvidence({ persist = true } = {}) {
    const cutoff = this.now().getTime() - this.evidenceRetentionDays * 24 * 60 * 60 * 1_000;
    let deletedReviews = 0;
    let deletedSessions = 0;
    const audit = this.state.draftAudit;
    let deletedAuditSessions = 0;
    for (const [sessionId, session] of Object.entries(this.state.sessions)) {
      const hasExpiredVisionPick = (session.picks || []).some((pick) =>
        pick.source === 'openrouter-screenshot' && Number.isFinite(Date.parse(pick.observedAt)) && Date.parse(pick.observedAt) < cutoff
      );
      if (hasExpiredVisionPick) {
        delete this.state.sessions[sessionId];
        deletedSessions += 1;
        continue;
      }
      const reviews = session.evidenceReviews || [];
      const retained = reviews.filter((review) => {
        const timestamp = Date.parse(review.createdAt);
        return !Number.isFinite(timestamp) || timestamp >= cutoff;
      });
      const removed = reviews.filter((review) => !retained.includes(review));
      if (!removed.length) continue;
      deletedReviews += removed.length;
      const removedEventIds = new Set(removed.map((review) => review.eventId));
      session.evidenceReviews = retained;
      session.appliedEvidenceEventIds = (session.appliedEvidenceEventIds || []).filter((eventId) => !removedEventIds.has(eventId));
      session.updatedAt = this.currentIso();
    }
    for (const id of new Set([...Object.keys(audit.recommendations), ...Object.keys(audit.events)])) {
      const times = [...(audit.recommendations[id] || []).map(item => Date.parse(item.capturedAt)),
        ...(audit.events[id] || []).map(item => Date.parse(item.observedAt))].filter(Number.isFinite);
      if (!this.state.sessions[id] || (times.length && Math.max(...times) < cutoff)) {
        delete audit.recommendations[id]; delete audit.events[id]; deletedAuditSessions++;
      }
    }
    this.pruneAuditPools();
    if (persist && (deletedReviews || deletedSessions || deletedAuditSessions)) this.persist();
    return {
      leagueId: this.league.id,
      retentionDays: this.evidenceRetentionDays,
      deletedReviews,
      deletedSessions,
      deletedAuditSessions,
      rawImagesPersisted: false
    };
  }

  unresolvedPlayers() {
    const items = [];
    for (const session of Object.values(this.state.sessions)) {
      for (const pick of session.picks || []) {
        const isManual = String(pick.playerId).startsWith('manual:');
        const isYahooPlaceholder = pick.resolutionStatus === 'unresolved-yahoo';
        const isObservedName = pick.resolutionStatus === 'observed-yahoo-name';
        if (!isManual && !isYahooPlaceholder && !isObservedName) continue;
        items.push({
          leagueId: this.league.id,
          sessionId: session.id,
          kind: isObservedName ? 'mock-observed-player' : isYahooPlaceholder ? 'yahoo-pick' : 'manual-pick',
          playerId: pick.playerId,
          playerName: pick.playerName,
          position: pick.position,
          yahooPlayerKey: pick.yahooPlayerKey || null,
          overallPick: pick.overallPick,
          observedAt: pick.observedAt,
          resolution: 'needs-provider-crosswalk'
        });
      }
      for (const review of session.evidenceReviews || []) {
        for (const observation of review.observations || []) {
          if (observation.status !== 'unresolved-player') continue;
          items.push({
            leagueId: this.league.id,
            sessionId: session.id,
            kind: 'screenshot-observation',
            reviewId: review.id,
            playerId: null,
            playerName: observation.playerName,
            position: observation.position,
            observedAt: review.createdAt,
            resolution: 'needs-provider-crosswalk'
          });
        }
      }
    }
    return items;
  }

  importMockSnapshot(id, snapshot) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    const next = prepareMockSnapshot({ snapshot, session, league: this.league, playerPool: this.playerPool, now: this.now() });
    const imported = next.picks.length - session.picks.length;
    // Validate the entire observation before replacing state; persist exactly once.
    const priorEvents = structuredClone(this.state.draftAudit.events[id] || []);
    const priorSnapshots = this.state.draftAudit.recommendations[id]?.length || 0;
    const priorPoolKeys = new Set(Object.keys(this.state.draftAudit.pools));
    this.state.sessions[id] = next;
    try {
      for (const pick of next.picks.slice(session.picks.length)) this.auditAcceptedPick(id, pick);
      const result = this.workspace(id, { saveRecommendation: false });
      this.persist();
      return { imported, ...result };
    } catch (error) {
      this.state.sessions[id] = session; this.state.draftAudit.events[id] = priorEvents; throw error;
    } finally {
      if (this.state.sessions[id] === session) {
        this.state.draftAudit.recommendations[id]?.splice(priorSnapshots);
        for (const key of Object.keys(this.state.draftAudit.pools)) if (!priorPoolKeys.has(key)) delete this.state.draftAudit.pools[key];
      }
    }
  }

  sessionPlayers(id) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    const players = session.sourceMode === 'mock' ? (session.mockRoom?.players || []) : this.playerPool.players;
    const draftedIds = new Set(session.picks.map((pick) => pick.playerId));
    return players.filter((player) => !draftedIds.has(player.id));
  }

  workspace(id, { saveRecommendation = true } = {}) {
    const card = this.recommendation(id, { saveSnapshot: saveRecommendation });
    return {
      session: this.getSession(id),
      card,
      decisions: this.decisionSummary(id),
      controller: this.controllers.status(id),
      pool: { source: this.state.sessions[id].sourceMode === 'mock' ? 'yahoo-browser-observation' : this.playerPool.source, players: this.sessionPlayers(id) },
      unresolved: { players: this.unresolvedPlayers() }
    };
  }

  recommendation(id, { saveSnapshot = true } = {}) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    session.evidenceReviews ||= [];
    const normalizedPlayers = session.sourceMode === 'mock' ? this.sessionPlayers(id) : this.playerPool.players.map(player => leagueProjection(player, this.league));
    const rawCard = buildRecommendationCard({
      players: normalizedPlayers,
      picks: session.picks,
      league: session.sourceMode === 'mock' && session.mockRoom?.rules.rosterMaximums
        ? { ...this.league, rosterMaximums: session.mockRoom.rules.rosterMaximums } : this.league,
      draftSlot: session.draftSlot,
      status: session.status
    });
    const draftedIds = new Set(session.picks.map((pick) => pick.playerId));
    const tagsByPlayer = new Map();
    for (const review of session.evidenceReviews) {
      for (const observation of review.observations || []) {
        if (!observation.playerId || observation.status === 'unresolved-player') continue;
        if (draftedIds.has(observation.playerId) && ['available_players', 'waiver_players'].includes(review.purpose)) continue;
        const tags = tagsByPlayer.get(observation.playerId) || new Set();
        tags.add(EVIDENCE_TAGS[review.purpose]);
        tagsByPlayer.set(observation.playerId, tags);
      }
    }
    const annotate = (item) => item ? { ...item, evidenceTags: [...(tagsByPlayer.get(item.player.id) || [])] } : item;
    const card = {
      ...rawCard,
      preferred: annotate(rawCard.preferred),
      alternatives: {
        safe: annotate(rawCard.alternatives.safe),
        upside: annotate(rawCard.alternatives.upside)
      },
      board: rawCard.board.map(annotate)
    };
    const latestReview = session.evidenceReviews.at(-1) || null;
    const readiness = session.sourceMode === 'mock' ? mockReadiness(session, this.now()) : null;
    const result = {
      ...card,
      ...(readiness && !readiness.ready ? { preferred: null, alternatives: { safe: null, upside: null }, onClock: false } : {}),
      mockReadiness: readiness,
      sessionId: id,
      evidence: {
        source: session.sourceMode === 'mock' ? 'yahoo-browser-observation + Huddle balanced scoring' : this.playerPool.source,
        season: this.playerPool.season,
        complete: session.sourceMode === 'mock' ? true : this.playerPool.complete !== false,
        quality: session.sourceMode === 'mock' ? 'observed-yahoo-candidates' : this.playerPool.complete === false ? 'partial-estimated' : 'complete',
        projectionCoverage: structuredClone(this.playerPool.projectionCoverage || null),
        fetchedAt: this.playerPool.fetchedAt || null,
        league: {
          id: this.league.id,
          name: this.league.name,
          teamCount: this.league.teamCount,
          scoringType: this.league.scoringType,
          roster: structuredClone(this.league.roster),
          scoring: structuredClone(this.league.scoring)
        },
        ranking: {
          algorithm: 'roster-contribution-v4-offensive-completion',
          weights: structuredClone(STYLES.balanced),
          playerInputs: ['projected points', 'floor', 'ceiling', 'ECR', 'ADP', 'FantasyPros normalized positional rank', 'Tank01 ADP/projection rank', 'Sleeper add/drop trend', 'tier', 'injury status', 'risk'],
          computedFactors: ['marginal legal-lineup contribution', 'diminishing bench depth with ownership-credit floor', 'owned offensive bye coverage', 'disclosed K/DEF streaming estimate', 'remaining league replacement demand', 'actual uncovered starter/Flex need', 'roster-useful urgency and rank bonuses', 'provider upside only', 'injury risk', 'Yahoo position limits', 'K/DEF draft phase']
        },
        sourceReconciliation: structuredClone(this.playerPool.sourceEvidence || {
          algorithm: 'primary-source-only',
          configuredWeights: { fantasyPros: 0.675, tank01: 0.325 },
          effectiveWeights: { fantasyPros: 1, tank01: 0 },
          sleeperRole: 'market tie-breaker only',
          yahooRole: 'league scoring and player availability are authoritative filters'
        }),
        screenshotReviews: {
          count: session.evidenceReviews.length,
          latestPurpose: latestReview?.purpose || null,
          latestAt: latestReview?.createdAt || null,
          confirmedObservations: session.evidenceReviews.reduce((count, review) =>
            count + (review.observations || []).filter((item) => item.status === 'confirmed').length, 0),
          semantics: 'Positive visible-row evidence only; omitted players remain unknown and rankings are unchanged.'
        },
        retention: {
          screenshotMetadataDays: this.evidenceRetentionDays,
          rawImagesPersisted: false,
          providerPayloadsPersisted: false
        },
        warning: session.sourceMode === 'mock'
          ? 'Practice-room input is maintained through the browser. Candidates are limited to positively observed Yahoo available rows. Yahoo displayed projections are used; provider matches contribute existing consensus evidence. Recheck availability and the live turn before submitting in Yahoo.'
          : this.playerPool.complete === false
          ? 'Draft synchronization is operational. Some provider projections are missing, so disclosed rank-based estimates may be used; confirm estimated recommendations in Yahoo.'
          : null
      },
      execution: 'recommendation-only'
    };
    return this.captureRecommendation(session, result, normalizedPlayers, { persist: saveSnapshot });
  }

  captureRecommendation(session, card, players, { persist = true } = {}) {
    const audit = this.state.draftAudit;
    const pool = players.map(rankingPlayer);
    const poolRevision = digest(pool);
    const revision = digest([session.id, session.draftSlot, session.status, session.picks, this.league, poolRevision, card.evidence.ranking]);
    const snapshots = audit.recommendations[session.id] ||= [];
    let snapshot = snapshots.find(item => item.id === revision);
    if (!snapshot) {
      const newPool = !audit.pools[poolRevision];
      audit.pools[poolRevision] ||= { capturedAt: this.currentIso(), players: pool };
      snapshot = { id: revision, sessionId: session.id, leagueId: this.league.id, capturedAt: this.currentIso(),
        poolRevision, reconciledPicks: session.picks.length, overallPick: card.currentOverall, onClock: card.onClock,
        completed: card.completed, draftSlot: session.draftSlot, league: structuredClone(this.league),
        ownedPicks: structuredClone(session.picks.filter(pick => pick.isMine)),
        preferred: choiceSnapshot(card.preferred), alternatives: { safe: choiceSnapshot(card.alternatives.safe), upside: choiceSnapshot(card.alternatives.upside) },
        ranking: structuredClone(card.evidence.ranking), evidenceSource: card.evidence.source };
      snapshot.contentHash = digest(snapshot);
      snapshots.push(snapshot);
      try { if (persist) this.persist(); } catch (error) { snapshots.pop(); if (newPool) delete audit.pools[poolRevision]; throw error; }
    }
    return { ...card, recommendationId: revision, poolRevision, reconciledPicks: session.picks.length, snapshotCapturedAt: snapshot.capturedAt };
  }

  recordDecision(id, input) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    const events = this.state.draftAudit.events[id] ||= [];
    if (!this.decisionSummary(id).integrityVerified) throw Object.assign(new Error('Decision history integrity check failed'), { code: 'DECISION_AUDIT_CORRUPT' });
    const eventId = String(input.eventId || '').trim().slice(0, 120);
    if (!eventId) throw Object.assign(new Error('A unique decision event ID is required'), { code: 'DECISION_EVENT_ID_REQUIRED' });
    const duplicate = events.find(event => event.eventId === eventId);
    if (duplicate) return { applied: false, reason: 'duplicate-event', event: structuredClone(duplicate) };
    let event;
    if (input.type === 'plan') {
      if (input.executor?.mode === 'computer-use') {
        const controllerId = this.controllers.assertLease(id, input.controllerToken, input.executor);
        if (input.executor.controllerId !== controllerId) throw Object.assign(new Error('Decision executor differs from the active controller'), { code: 'CONTROLLER_ID_MISMATCH' });
      }
      const current = this.recommendation(id);
      const snapshot = this.state.draftAudit.recommendations[id]?.find(item => item.id === input.recommendationId);
      event = validatePlan({ input, session, league: this.league, snapshot, recommendationId: current.recommendationId, poolRevision: current.poolRevision, now: this.now() });
    } else {
      const plan = events.find(item => item.hash === input.planId && item.type === 'plan');
      if (!plan) throw Object.assign(new Error('A saved decision plan is required'), { code: 'DECISION_PLAN_REQUIRED' });
      if (!['submit-started', 'submit-uncertain', 'input-acknowledged', 'input-not-dispatched', 'display-confirmed', 'abandoned'].includes(input.type)) throw Object.assign(new Error('Unsupported decision event type'), { code: 'INVALID_DECISION_EVENT' });
      const reportingInput = ['submit-uncertain', 'input-acknowledged'].includes(input.type);
      if (!reportingInput && events.some(item => item.type === 'accepted' && item.overallPick === plan.overallPick)) throw Object.assign(new Error('This pick already has an accepted result'), { code: 'DECISION_ALREADY_ACCEPTED' });
      if (reportingInput && !events.some(item => item.type === 'submit-started' && item.planId === plan.hash)) throw Object.assign(new Error('Input acknowledgment requires a previously recorded dispatch'), { code: 'DECISION_DISPATCH_REQUIRED' });
      const cancelled = hash => events.some(item => item.type === 'input-not-dispatched' && item.planId === hash);
      if (reportingInput && cancelled(plan.hash)) throw Object.assign(new Error('This plan was cancelled before browser input'), { code: 'DECISION_INPUT_CANCELLED' });
      if (input.type === 'submit-started' && events.some(item => item.type === 'submit-started' && item.overallPick === plan.overallPick && !cancelled(item.planId))) throw Object.assign(new Error('A submission was already started; inspect Yahoo before any retry'), { code: 'DECISION_SUBMISSION_ALREADY_STARTED' });
      if (input.type === 'input-not-dispatched') {
        this.controllers.assertOwner(id, input.controllerToken, plan.executor);
        if (events.some(item => item.planId === plan.hash && ['submit-uncertain', 'input-acknowledged'].includes(item.type))) {
          throw Object.assign(new Error('An issued or uncertain input cannot be cancelled as never dispatched'), { code: 'DECISION_INPUT_ALREADY_DISPATCHED' });
        }
      }
      let dispatchObservation;
      let viewObservation;
      if (input.type === 'display-confirmed') {
        const view = input.viewObservation, age = this.now().getTime() - Date.parse(view?.observedAt);
        if (!view || !isFreshObservation(view.observedAt, this.now().getTime()) || view.planId !== plan.hash || view.recommendationId !== plan.recommendationId
          || view.overallPick !== plan.overallPick || view.selected !== plan.playerName || view.preferred !== plan.recommendedPlayer
          || view.allPanelsInFrame !== true || view.stale !== false) throw Object.assign(new Error('The exact current recommendation and decision must be visibly rendered in frame'), { code: 'DECISION_DISPLAY_UNVERIFIED' });
        viewObservation = { observedAt: view.observedAt, planId: plan.hash, recommendationId: plan.recommendationId, overallPick: plan.overallPick,
          selected: view.selected, preferred: view.preferred, allPanelsInFrame: true, stale: false, width: Number(view.width), height: Number(view.height), source: 'reported-rendered-dom' };
      }
      if (input.type === 'submit-started') {
        if (events.some(item => ['abandoned', 'input-not-dispatched'].includes(item.type) && item.planId === plan.hash)) throw Object.assign(new Error('An abandoned plan cannot authorize a submission'), { code: 'DECISION_PLAN_ABANDONED' });
        if (events.findLast(item => item.type === 'plan' && item.overallPick === plan.overallPick)?.hash !== plan.hash) throw Object.assign(new Error('Use the latest reviewed decision plan'), { code: 'DECISION_PLAN_SUPERSEDED' });
        if (plan.executor?.mode === 'computer-use') {
          this.controllers.assertLease(id, input.controllerToken, plan.executor);
          const painted = events.findLast(item => item.type === 'display-confirmed' && item.planId === plan.hash);
          if (!painted || this.now().getTime() - Date.parse(painted.viewObservation.observedAt) > 5000) throw Object.assign(new Error('Confirm the displayed recommendation and decision immediately before dispatch'), { code: 'DECISION_DISPLAY_UNVERIFIED' });
        }
        const current = this.recommendation(id);
        const snapshot = this.state.draftAudit.recommendations[id]?.find(item => item.id === plan.recommendationId);
        const validated = validatePlan({ input: { ...plan, yahooObservation: input.yahooObservation || plan.yahooObservation }, session,
          league: this.league, snapshot, recommendationId: current.recommendationId, poolRevision: current.poolRevision, now: this.now() });
        dispatchObservation = validated.yahooObservation;
      }
      event = { type: input.type, planId: plan.hash, overallPick: plan.overallPick,
        observedAt: this.currentIso(), ...(dispatchObservation ? { yahooObservation: dispatchObservation } : {}), ...(viewObservation ? { viewObservation } : {}), details: String(input.details || '').slice(0, 1200) };
    }
    const saved = appendEvent(events, { ...event, eventId });
    try { this.persist(); } catch (error) { events.pop(); throw error; }
    return { applied: true, event: structuredClone(saved), decisions: this.decisionSummary(id) };
  }

  auditAcceptedPick(id, pick) {
    if (!pick.isMine) return;
    const events = this.state.draftAudit.events[id] ||= [];
    if (events.some(item => item.type === 'accepted' && item.overallPick === pick.overallPick)) return;
    const cancelled = hash => events.some(item => item.type === 'input-not-dispatched' && item.planId === hash);
    const submitted = events.findLast(item => item.type === 'submit-started' && item.overallPick === pick.overallPick && !cancelled(item.planId));
    const plan = submitted ? events.find(item => item.type === 'plan' && item.hash === submitted.planId)
      : [...events].reverse().find(item => item.type === 'plan' && item.overallPick === pick.overallPick && !events.some(e => ['abandoned', 'input-not-dispatched'].includes(e.type) && e.planId === item.hash));
    const actualYahooId = String(pick.yahooPlayerKey || '').split('.p.').at(-1) || null;
    const matched = Boolean(plan && (plan.yahooPlayerId ? plan.yahooPlayerId === actualYahooId : plan.playerId === pick.playerId));
    appendEvent(events, { type: 'accepted', eventId: `accepted:${pick.eventId}`, overallPick: pick.overallPick,
      observedAt: pick.observedAt, playerId: pick.playerId, yahooPlayerId: actualYahooId, playerName: pick.playerName,
      planId: plan?.hash || null, recommendationId: plan?.recommendationId || null,
      recommendedPlayer: plan?.recommendedPlayer || null, reason: plan?.reason || null,
      classification: matched ? plan.classification : 'unattributed',
      inputAcknowledged: Boolean(matched && events.some(item => item.type === 'input-acknowledged' && item.planId === plan.hash)),
      verification: matched ? 'matched-plan' : plan ? 'different-player-accepted' : 'accepted-without-plan', source: pick.source });
  }

  decisionSummary(id) {
    this.getSession(id);
    const events = this.state.draftAudit.events[id] || [];
    const snapshots = this.state.draftAudit.recommendations[id] || [];
    const snapshotIntegrity = snapshots.every(({ contentHash, ...snapshot }) => digest(snapshot) === contentHash
      && this.state.draftAudit.pools[snapshot.poolRevision]
      && digest(this.state.draftAudit.pools[snapshot.poolRevision].players) === snapshot.poolRevision);
    return { events: structuredClone(events), integrityVerified: verifyEvents(events) && snapshotIntegrity,
      latestPlan: structuredClone(events.findLast(event => event.type === 'plan') || null),
      lastAccepted: structuredClone(events.findLast(event => event.type === 'accepted') || null),
      recommendationSnapshots: (this.state.draftAudit.recommendations[id] || []).length };
  }

  exportDecisionAudit(id) {
    const summary = this.decisionSummary(id);
    const recommendations = this.state.draftAudit.recommendations[id] || [];
    return { schemaVersion: 1, session: this.getSession(id), ...summary, recommendations: structuredClone(recommendations),
      pools: Object.fromEntries([...new Set(recommendations.map(item => item.poolRevision))].map(revision => [revision, structuredClone(this.state.draftAudit.pools[revision])])) };
  }

  pruneAuditPools() {
    const referenced = new Set(Object.values(this.state.draftAudit.recommendations).flat().map(item => item.poolRevision));
    for (const revision of Object.keys(this.state.draftAudit.pools)) if (!referenced.has(revision)) delete this.state.draftAudit.pools[revision];
  }

  decorate(session) {
    session.evidenceReviews ||= [];
    session.appliedEvidenceEventIds ||= [];
    const poolIds = new Set(this.playerPool.players.map((player) => player.id));
    const draftedFromPool = session.picks.filter((pick) => poolIds.has(pick.playerId)).length;
    return {
      ...structuredClone(session),
      currentOverall: session.status === 'completed' ? null : session.picks.length + 1,
      availableCount: session.sourceMode === 'mock' ? session.mockRoom?.players.length || 0 : this.playerPool.players.length - draftedFromPool,
      totalPicks: draftedRosterSize(this.league.roster) * this.league.teamCount
    };
  }

  persist() {
    this.store.save(this.state);
  }
}

module.exports = { DraftService, externalYahooPlayer, manualPlayer };
