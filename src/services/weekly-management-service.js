'use strict';

const crypto = require('node:crypto');
const { buildWeeklyReview } = require('../domain/weekly-management');

function playerIdentity(player) {
  return String(player?.yahooPlayerKey || player?.playerId || player?.id || player?.name || player?.playerName || '').trim().toLowerCase();
}

function projectionValue(player) {
  for (const value of [player?.remainingProjectedPoints, player?.projectedPoints, player?.weeklyProjectedPoints]) {
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value);
  }
  return -Infinity;
}

function compactCandidatePool(players, recommendation, limit) {
  const byIdentity = new Map((players || []).map((player) => [playerIdentity(player), player]));
  const selected = [];
  const seen = new Set();
  const add = (player) => {
    const identity = playerIdentity(player);
    if (!identity || seen.has(identity) || selected.length >= limit) return;
    const original = byIdentity.get(identity);
    if (!original) return;
    seen.add(identity);
    selected.push(structuredClone(original));
  };
  for (const item of recommendation?.claimPlan || []) add(item.add);
  for (const item of recommendation?.consideredAlternatives || []) add(item.add);
  for (const player of [...(players || [])].sort((a, b) => projectionValue(b) - projectionValue(a))) add(player);
  return selected;
}

function compactWeeklyEntry(snapshot, review, limit) {
  const compactAvailable = compactCandidatePool(snapshot.availablePlayers, review.waiver.recommendation, limit);
  const identities = new Set(compactAvailable.map(playerIdentity));
  const compactReviewPlayers = review.availablePlayers.filter((player) => identities.has(playerIdentity(player)));
  const persistence = {
    persisted: true,
    rawProviderPayloadPersisted: false,
    compacted: compactAvailable.length < snapshot.availablePlayers.length,
    availablePlayersObserved: snapshot.availablePlayers.length,
    availablePlayersPersisted: compactAvailable.length,
    candidateLimit: limit
  };
  return {
    snapshot: { ...structuredClone(snapshot), availablePlayers: compactAvailable },
    review: { ...structuredClone(review), availablePlayers: structuredClone(compactReviewPlayers), persistence },
    persistence
  };
}

class WeeklyManagementService {
  constructor({ league, playerPool, draftService, persistedCandidateLimit = 25 }) {
    this.league = league;
    this.playerPool = playerPool;
    this.draftService = draftService;
    this.persistedCandidateLimit = Math.max(5, Math.min(100, Number(persistedCandidateLimit) || 25));
    this.state = draftService.state;
    this.state.weekly ||= { weeks: {}, appliedEventIds: [], runs: [] };
    this.state.weekly.weeks ||= {};
    this.state.weekly.appliedEventIds ||= [];
    this.state.weekly.runs ||= [];
  }

  key(season, week) {
    return `${Number(season)}:${Number(week)}`;
  }

  listWeeks() {
    return Object.values(this.state.weekly.weeks)
      .map((entry) => this.summary(entry))
      .sort((a, b) => b.season - a.season || b.week - a.week);
  }

  getWeek(week, season) {
    const resolvedSeason = Number(season || this.latest()?.season || new Date().getFullYear());
    const entry = this.state.weekly.weeks[this.key(resolvedSeason, week)];
    if (!entry) {
      const error = new Error(`Weekly review not found for ${resolvedSeason} week ${week}`);
      error.code = 'WEEK_NOT_FOUND';
      throw error;
    }
    return structuredClone(entry.review);
  }

  latest() {
    const first = this.listWeeks()[0];
    return first ? this.getWeek(first.week, first.season) : null;
  }

  deleteWeek(week, season) {
    const resolvedSeason = Number(season);
    const resolvedWeek = Number(week);
    const key = this.key(resolvedSeason, resolvedWeek);
    const entry = this.state.weekly.weeks[key];
    if (!entry) return this.getWeek(resolvedWeek, resolvedSeason);
    const removedRuns = this.state.weekly.runs.filter((run) => run.season === resolvedSeason && run.week === resolvedWeek);
    const removedEventIds = new Set([entry.eventId, ...removedRuns.map((run) => run.eventId)].filter(Boolean));
    delete this.state.weekly.weeks[key];
    this.state.weekly.runs = this.state.weekly.runs.filter((run) => run.season !== resolvedSeason || run.week !== resolvedWeek);
    this.state.weekly.appliedEventIds = this.state.weekly.appliedEventIds.filter((eventId) => !removedEventIds.has(eventId));
    this.draftService.persist();
    return { leagueId: this.league.id, season: resolvedSeason, week: resolvedWeek, deleted: true };
  }

  deleteWeeks({ season } = {}) {
    const resolvedSeason = season === undefined || season === null || season === '' ? null : Number(season);
    const matches = (itemSeason) => resolvedSeason === null || Number(itemSeason) === resolvedSeason;
    const entries = Object.entries(this.state.weekly.weeks).filter(([, entry]) => matches(entry.review.season));
    const removedRuns = this.state.weekly.runs.filter((run) => matches(run.season));
    const removedEventIds = new Set([
      ...entries.map(([, entry]) => entry.eventId),
      ...removedRuns.map((run) => run.eventId)
    ].filter(Boolean));
    for (const [key] of entries) delete this.state.weekly.weeks[key];
    this.state.weekly.runs = this.state.weekly.runs.filter((run) => !matches(run.season));
    this.state.weekly.appliedEventIds = this.state.weekly.appliedEventIds.filter((eventId) => !removedEventIds.has(eventId));
    this.draftService.persist();
    return {
      leagueId: this.league.id,
      season: resolvedSeason,
      deletedReviews: entries.length,
      deletedRuns: removedRuns.length
    };
  }

  previewSnapshot(snapshot, { expectedWeek, source, preferSharedProjections = false } = {}) {
    const normalized = { ...structuredClone(snapshot), source: source || snapshot?.source || 'transient-preview' };
    const review = buildWeeklyReview({
      snapshot: normalized,
      league: this.league,
      playerPool: this.playerPool,
      expectedWeek,
      preferSharedProjections
    });
    return {
      ...review,
      persistence: {
        persisted: false,
        rawProviderPayloadPersisted: false,
        commitRequired: true
      }
    };
  }

  importSnapshot(snapshot, { expectedWeek, eventId, source, preferSharedProjections = false } = {}) {
    const now = new Date().toISOString();
    const stableEventId = String(eventId || snapshot?.eventId || `weekly:${crypto.randomUUID()}`);
    if (this.state.weekly.appliedEventIds.includes(stableEventId)) {
      const prior = Object.values(this.state.weekly.weeks).find((entry) => entry.eventId === stableEventId);
      return { applied: false, reason: 'duplicate-event', review: prior ? structuredClone(prior.review) : null };
    }
    const normalized = { ...structuredClone(snapshot), source: source || snapshot?.source || 'normalized-import' };
    const review = buildWeeklyReview({ snapshot: normalized, league: this.league, playerPool: this.playerPool, expectedWeek, preferSharedProjections });
    const compacted = compactWeeklyEntry(normalized, review, this.persistedCandidateLimit);
    const persistedReview = { ...structuredClone(review), persistence: compacted.persistence };
    const key = this.key(review.season, review.week);
    const existing = this.state.weekly.weeks[key];
    const run = {
      id: crypto.randomUUID(),
      eventId: stableEventId,
      season: review.season,
      week: review.week,
      source: review.source,
      action: review.waiver.recommendation.action,
      expectedPointsGained: review.waiver.recommendation.expectedPointsGained,
      recordedAt: now
    };
    this.state.weekly.weeks[key] = {
      eventId: stableEventId,
      snapshot: compacted.snapshot,
      review: compacted.review,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      revisions: (existing?.revisions || 0) + 1
    };
    this.state.weekly.appliedEventIds.push(stableEventId);
    this.state.weekly.appliedEventIds = this.state.weekly.appliedEventIds.slice(-500);
    this.state.weekly.runs.push(run);
    this.state.weekly.runs = this.state.weekly.runs.slice(-250);
    this.draftService.persist();
    return { applied: true, reason: null, review: persistedReview, run };
  }

  rerun(week, season) {
    const resolvedSeason = Number(season || this.latest()?.season || new Date().getFullYear());
    const key = this.key(resolvedSeason, week);
    const entry = this.state.weekly.weeks[key];
    if (!entry) return this.getWeek(week, resolvedSeason);
    return this.importSnapshot(entry.snapshot, {
      expectedWeek: Number(week),
      source: `${entry.snapshot.source || 'normalized-import'}:rerun`,
      preferSharedProjections: true
    });
  }

  status() {
    const latest = this.latest();
    const weeks = this.listWeeks();
    return {
      leagueId: this.league.id,
      storedWeeks: weeks.length,
      latest: latest ? {
        season: latest.season,
        week: latest.week,
        observedAt: latest.observedAt,
        waiverAction: latest.waiver.recommendation.action,
        targetResult: latest.targetResult?.result || null
      } : null,
      execution: 'recommendation-only'
    };
  }

  summary(entry) {
    const review = entry.review;
    return {
      leagueId: review.leagueId,
      season: review.season,
      week: review.week,
      observedAt: review.observedAt,
      updatedAt: entry.updatedAt,
      revisions: entry.revisions,
      targetResult: review.targetResult?.result || null,
      targetScore: review.targetResult?.score ?? null,
      standingRank: review.targetResult?.standingRank ?? null,
      waiverAction: review.waiver.recommendation.action,
      expectedPointsGained: review.waiver.recommendation.expectedPointsGained,
      lineupPointsLost: review.lineup.pointsLeftOnBench
    };
  }
}

class WeeklyFleetRunner {
  constructor({ weeklyServices }) {
    this.weeklyServices = weeklyServices;
  }

  async run(input = {}) {
    if (!Array.isArray(input.leagues) || !input.leagues.length) {
      const error = new Error('leagues must contain at least one league snapshot');
      error.code = 'INVALID_WEEKLY_FLEET_RUN';
      throw error;
    }
    const settled = await Promise.all(input.leagues.map(async (item) => {
      const leagueId = String(item.leagueId || '');
      const service = this.weeklyServices.get(leagueId);
      if (!service) {
        const error = new Error(`League not found: ${leagueId}`);
        error.code = 'LEAGUE_NOT_FOUND';
        throw error;
      }
      const snapshot = { ...structuredClone(item.snapshot || {}), season: item.snapshot?.season || input.season, week: item.snapshot?.week || input.week };
      const result = service.importSnapshot(snapshot, { expectedWeek: input.week, eventId: item.eventId, source: item.source });
      return { leagueId, applied: result.applied, review: result.review };
    }).map((operation) => operation.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))));
    const results = settled.map((item, index) => item.status === 'fulfilled' ? item.value : {
      leagueId: String(input.leagues[index].leagueId || ''),
      error: item.reason.code || 'WEEKLY_RUN_FAILED',
      message: item.reason.message
    });
    return {
      complete: results.every((item) => !item.error),
      succeeded: results.filter((item) => !item.error).length,
      failed: results.filter((item) => item.error).length,
      results
    };
  }
}

module.exports = { WeeklyFleetRunner, WeeklyManagementService, compactCandidatePool, compactWeeklyEntry };
