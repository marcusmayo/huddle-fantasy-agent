'use strict';

const { extractPlayers } = require('./yahoo-weekly-normalizer');

function transientError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Fetches Yahoo Fantasy Information into process memory and immediately hands it
 * to a versioned normalizer. Raw provider payloads are never returned or saved.
 * Live normalizers must be validated against approved Yahoo payloads before use.
 */
class YahooTransientWeeklyAdapter {
  constructor({ client, normalizer, weeklyEvidence, playerPageSize = 100, maximumAvailablePlayers = 500 }) {
    this.client = client;
    this.normalizer = normalizer;
    this.weeklyEvidence = weeklyEvidence;
    this.playerPageSize = Math.max(1, Math.min(100, Number(playerPageSize) || 100));
    this.maximumAvailablePlayers = Math.max(this.playerPageSize, Math.min(1000, Number(maximumAvailablePlayers) || 500));
  }

  async availablePlayerPages(leagueKey) {
    const pages = [];
    const identities = new Set();
    let start = 0;
    let exhausted = false;
    while (identities.size < this.maximumAvailablePlayers && pages.length < 20) {
      const count = Math.min(this.playerPageSize, this.maximumAvailablePlayers - identities.size);
      const page = await this.client.availablePlayers(leagueKey, { start, count, ownership: true });
      const players = extractPlayers(page, { available: true });
      const before = identities.size;
      for (const player of players) identities.add(player.playerId);
      if (!players.length || identities.size === before) {
        exhausted = true;
        break;
      }
      pages.push(page);
      start += players.length;
    }
    return {
      pages,
      pagination: {
        pages: pages.length,
        retrieved: identities.size,
        pageSize: this.playerPageSize,
        maximum: this.maximumAvailablePlayers,
        complete: exhausted,
        capped: identities.size >= this.maximumAvailablePlayers || pages.length >= 20
      }
    };
  }

  get ready() {
    return Boolean(this.client && typeof this.normalizer === 'function');
  }

  async preview({ leagueKey, teamKey, week, season, weeklyService }) {
    if (!this.ready) throw transientError('YAHOO_WEEKLY_ADAPTER_PENDING', 'Yahoo weekly normalization awaits live payload validation');
    if (!leagueKey || !teamKey) throw transientError('YAHOO_IDENTIFIERS_MISSING', 'Yahoo league and team keys are required');
    const [scoreboard, standings, transactions, roster, available] = await Promise.all([
      this.client.scoreboard(leagueKey, week),
      this.client.standings(leagueKey),
      this.client.transactions(leagueKey),
      this.client.roster(teamKey, week),
      this.availablePlayerPages(leagueKey)
    ]);
    const snapshot = await this.normalizer(
      { scoreboard, standings, transactions, roster, availablePlayers: available.pages },
      {
        league: weeklyService.league,
        leagueKey,
        teamKey,
        week,
        season,
        previousReview: weeklyService.latest()
      }
    );
    const target = snapshot.teams.find(team => team.isTarget);
    const opponent = snapshot.teams.find(team => String(team.teamId) === String(target?.opponentId));
    snapshot.opponent = { teamId: opponent?.teamId || null, name: opponent?.name || null, roster: [],
      rosterStatus: target?.bye ? 'bye' : 'unavailable', observedAt: new Date().toISOString() };
    if (opponent?.yahooTeamKey && !target?.bye) {
      try {
        const opponentPayload = await this.client.roster(opponent.yahooTeamKey, week);
        snapshot.opponent.roster = extractPlayers(opponentPayload, { available: false, week });
        snapshot.opponent.rosterStatus = snapshot.opponent.roster.length ? 'available' : 'unavailable';
      } catch {
        // A missing opponent roster must not prevent the owner's review or leak provider payloads.
        snapshot.opponent.rosterStatus = 'unavailable';
      }
    }
    if (snapshot.availablePlayers.length > this.maximumAvailablePlayers) {
      snapshot.availablePlayers = snapshot.availablePlayers.slice(0, this.maximumAvailablePlayers);
      snapshot.normalization.availablePlayers = snapshot.availablePlayers.length;
    }
    available.pagination.retrieved = snapshot.availablePlayers.length;
    available.pagination.capped ||= snapshot.availablePlayers.length >= this.maximumAvailablePlayers;
    available.pagination.complete &&= !available.pagination.capped;
    if (this.weeklyEvidence) await this.weeklyEvidence.enrich(snapshot, weeklyService.league);
    const review = weeklyService.previewSnapshot(
      { ...snapshot, source: 'yahoo-live-transient-v1' },
      { expectedWeek: week, preferSharedProjections: !this.weeklyEvidence }
    );
    return {
      review,
      normalizedSnapshot: snapshot,
      provenance: {
        provider: 'Yahoo Fantasy',
        ingestion: 'transient-memory-only',
        rawPayloadPersisted: false,
        normalizedReviewPersisted: false,
        availablePlayers: available.pagination,
        observedAt: new Date().toISOString()
      }
    };
  }
}

module.exports = { YahooTransientWeeklyAdapter };
