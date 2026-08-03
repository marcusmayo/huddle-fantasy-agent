'use strict';

const crypto = require('node:crypto');
const { buildRecommendationCard, STYLES } = require('../domain/draft-board');

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

class DraftService {
  constructor({ league, playerPool, store }) {
    this.league = league;
    this.playerPool = playerPool;
    this.store = store;
    this.state = store.load();
    this.state.sessions ||= {};
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
    const now = new Date().toISOString();
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
    return Object.values(this.state.sessions).map((session) => this.decorate(session));
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

  recordPick(id, input) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    if (!input?.playerId && !input?.manualPlayer) {
      const error = new Error('playerId or manualPlayer is required');
      error.code = 'INVALID_PICK';
      throw error;
    }
    const fallbackPlayer = manualPlayer(input);
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
      teamId: input.teamId || null,
      isMine: Boolean(input.isMine),
      observedAt: input.observedAt || new Date().toISOString(),
      source: input.source || session.sourceMode
    });
    session.appliedEventIds.push(eventId);
    session.updatedAt = new Date().toISOString();
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
    const now = new Date().toISOString();
    const review = {
      id: crypto.randomUUID(),
      eventId,
      purpose,
      source: String(input.source || 'openrouter-screenshot').slice(0, 50),
      observations,
      createdAt: now
    };
    session.evidenceReviews.push(review);
    session.evidenceReviews = session.evidenceReviews.slice(-20);
    session.appliedEvidenceEventIds.push(eventId);
    session.appliedEvidenceEventIds = session.appliedEvidenceEventIds.slice(-100);
    session.updatedAt = now;
    this.persist();
    return { applied: true, reason: null, review: structuredClone(review), session: this.decorate(session) };
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
        warning: this.playerPool.complete === false
          ? 'Player evidence is truncated or incomplete; confirm the preferred player against Yahoo before drafting.'
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
      availableCount: this.playerPool.players.length - draftedFromPool
    };
  }

  persist() {
    this.store.save(this.state);
  }
}

module.exports = { DraftService, manualPlayer };
