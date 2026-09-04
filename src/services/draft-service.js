'use strict';

const crypto = require('node:crypto');
const { buildRecommendationCard, STYLES } = require('../domain/draft-board');
const { draftedRosterSize } = require('../domain/league');

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
    yahooPlayerKey,
    name: suppliedName.length >= 2 ? suppliedName : `Yahoo player ${yahooId}`,
    position,
    team: String(value.team || 'FA').trim().toUpperCase().slice(0, 8) || 'FA',
    resolutionStatus: position && suppliedName.length >= 2 ? 'resolved-yahoo' : 'unresolved-yahoo'
  };
}

class DraftService {
  constructor({ league, playerPool, store, evidenceRetentionDays = 30, now = () => new Date() }) {
    this.league = league;
    this.playerPool = playerPool;
    this.store = store;
    this.evidenceRetentionDays = Math.max(1, Math.min(30, Number(evidenceRetentionDays) || 30));
    this.now = now;
    this.state = store.load();
    this.state.sessions ||= {};
    const pruned = this.pruneExpiredEvidence({ persist: false });
    if (pruned.deletedReviews || pruned.deletedSessions) this.persist();
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
    if (!['manual', 'yahoo', 'screenshot'].includes(sourceMode)) {
      const error = new Error('sourceMode must be manual, yahoo, or screenshot');
      error.code = 'INVALID_SOURCE_MODE';
      throw error;
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
    if (session.picks.some((pick) => pick.playerId === playerId || pick.playerName.toLowerCase() === player.name.toLowerCase())) {
      return { applied: false, reason: 'player-already-drafted', session: this.decorate(session) };
    }
    const expectedOverall = session.picks.length + 1;
    if (input.overallPick && input.overallPick !== expectedOverall) {
      const error = new Error(`Expected overall pick ${expectedOverall}, received ${input.overallPick}`);
      error.code = 'OUT_OF_ORDER_PICK';
      throw error;
    }
    session.picks.push({
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
    this.persist();
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
    if (persist && (deletedReviews || deletedSessions)) this.persist();
    return {
      leagueId: this.league.id,
      retentionDays: this.evidenceRetentionDays,
      deletedReviews,
      deletedSessions,
      rawImagesPersisted: false
    };
  }

  unresolvedPlayers() {
    const items = [];
    for (const session of Object.values(this.state.sessions)) {
      for (const pick of session.picks || []) {
        const isManual = String(pick.playerId).startsWith('manual:');
        const isYahooPlaceholder = pick.resolutionStatus === 'unresolved-yahoo';
        if (!isManual && !isYahooPlaceholder) continue;
        items.push({
          leagueId: this.league.id,
          sessionId: session.id,
          kind: isYahooPlaceholder ? 'yahoo-pick' : 'manual-pick',
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

  recommendation(id) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    session.evidenceReviews ||= [];
    const rawCard = buildRecommendationCard({
      players: this.playerPool.players,
      picks: session.picks,
      league: this.league,
      draftSlot: session.draftSlot
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
    return {
      ...card,
      sessionId: id,
      evidence: {
        source: this.playerPool.source,
        season: this.playerPool.season,
        complete: this.playerPool.complete !== false,
        quality: this.playerPool.complete === false ? 'partial-estimated' : 'complete',
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
          algorithm: 'deterministic-v1',
          weights: structuredClone(STYLES.balanced),
          playerInputs: ['projected points', 'floor', 'ceiling', 'ECR', 'ADP', 'FantasyPros normalized positional rank', 'Tank01 ADP/projection rank', 'Sleeper add/drop trend', 'tier', 'injury status', 'risk'],
          computedFactors: ['source consensus', 'value over replacement', 'positional scarcity', 'roster need', 'next-turn urgency', 'upside', 'floor', 'risk', 'K/DEF draft phase']
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
        warning: this.playerPool.complete === false
          ? 'Draft synchronization is operational. Some provider projections are missing, so disclosed rank-based estimates may be used; confirm estimated recommendations in Yahoo.'
          : null
      },
      execution: 'recommendation-only'
    };
  }

  decorate(session) {
    session.evidenceReviews ||= [];
    session.appliedEvidenceEventIds ||= [];
    const poolIds = new Set(this.playerPool.players.map((player) => player.id));
    const draftedFromPool = session.picks.filter((pick) => poolIds.has(pick.playerId)).length;
    return {
      ...structuredClone(session),
      currentOverall: session.picks.length + 1,
      availableCount: this.playerPool.players.length - draftedFromPool,
      totalPicks: draftedRosterSize(this.league.roster) * this.league.teamCount
    };
  }

  persist() {
    this.store.save(this.state);
  }
}

module.exports = { DraftService, externalYahooPlayer, manualPlayer };
