'use strict';

function transientError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Fetches Yahoo Fantasy Information into process memory and immediately hands it
 * to a versioned normalizer. Raw provider payloads are never returned or saved.
 * Live normalizers must be validated against approved Yahoo payloads before use.
 */
class YahooTransientWeeklyAdapter {
  constructor({ client, normalizer }) {
    this.client = client;
    this.normalizer = normalizer;
  }

  get ready() {
    return Boolean(this.client && typeof this.normalizer === 'function');
  }

  async preview({ leagueKey, teamKey, week, weeklyService }) {
    if (!this.ready) throw transientError('YAHOO_WEEKLY_ADAPTER_PENDING', 'Yahoo weekly normalization awaits live payload validation');
    if (!leagueKey || !teamKey) throw transientError('YAHOO_IDENTIFIERS_MISSING', 'Yahoo league and team keys are required');
    const [scoreboard, standings, transactions, roster, availablePlayers] = await Promise.all([
      this.client.scoreboard(leagueKey, week),
      this.client.standings(leagueKey),
      this.client.transactions(leagueKey),
      this.client.roster(teamKey, week),
      this.client.availablePlayers(leagueKey)
    ]);
    const snapshot = await this.normalizer({ scoreboard, standings, transactions, roster, availablePlayers }, { week });
    const review = weeklyService.previewSnapshot({ ...snapshot, source: 'yahoo-transient' }, { expectedWeek: week });
    return {
      review,
      provenance: {
        provider: 'Yahoo Fantasy',
        ingestion: 'transient-memory-only',
        rawPayloadPersisted: false,
        normalizedReviewPersisted: false,
        observedAt: new Date().toISOString()
      }
    };
  }
}

module.exports = { YahooTransientWeeklyAdapter };
