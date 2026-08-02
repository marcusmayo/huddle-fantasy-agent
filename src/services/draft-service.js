'use strict';

const crypto = require('node:crypto');
const { buildRecommendationCard, STYLES } = require('../domain/draft-board');

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
    if (!input?.playerId) {
      const error = new Error('playerId is required');
      error.code = 'INVALID_PICK';
      throw error;
    }
    const player = this.playerPool.players.find((candidate) => candidate.id === input.playerId);
    if (!player) {
      const error = new Error(`Unknown player: ${input.playerId}`);
      error.code = 'UNKNOWN_PLAYER';
      throw error;
    }
    const eventId = input.eventId || `manual:${session.picks.length + 1}:${input.playerId}`;
    if (session.appliedEventIds.includes(eventId)) {
      return { applied: false, reason: 'duplicate-event', session: this.decorate(session) };
    }
    if (session.picks.some((pick) => pick.playerId === input.playerId)) {
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
      playerId: input.playerId,
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

  recommendation(id) {
    const session = this.state.sessions[id];
    if (!session) return this.getSession(id);
    const card = buildRecommendationCard({
      players: this.playerPool.players,
      picks: session.picks,
      league: this.league,
      draftSlot: session.draftSlot
    });
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
          playerInputs: ['projected points', 'floor', 'ceiling', 'ECR', 'ADP', 'tier', 'injury status', 'risk'],
          computedFactors: ['value over replacement', 'positional scarcity', 'roster need', 'next-turn urgency', 'upside', 'floor', 'risk', 'K/DEF draft phase']
        },
        warning: this.playerPool.complete === false
          ? 'Player evidence is truncated or incomplete; confirm the preferred player against Yahoo before drafting.'
          : null
      },
      execution: 'recommendation-only'
    };
  }

  decorate(session) {
    return {
      ...structuredClone(session),
      currentOverall: session.picks.length + 1,
      availableCount: this.playerPool.players.length - session.picks.length
    };
  }

  persist() {
    this.store.save(this.state);
  }
}

module.exports = { DraftService };
