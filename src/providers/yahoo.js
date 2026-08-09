'use strict';

const DEFAULT_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

function recursivelyFindDraftResults(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) recursivelyFindDraftResults(item, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  if (value.draft_result) recursivelyFindDraftResults(value.draft_result, output);
  const pick = value.pick ?? value.overall_pick;
  const playerKey = value.player_key ?? value.playerKey;
  if (pick !== undefined && playerKey) {
    output.push({
      overallPick: Number(pick),
      round: value.round ? Number(value.round) : null,
      teamKey: value.team_key || value.teamKey || null,
      yahooPlayerKey: String(playerKey)
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'draft_result') recursivelyFindDraftResults(child, output);
  }
  return output;
}

function extractDraftResults(payload) {
  const unique = new Map();
  for (const result of recursivelyFindDraftResults(payload)) unique.set(result.overallPick, result);
  return [...unique.values()].sort((a, b) => a.overallPick - b.overallPick);
}

class YahooReadOnlyClient {
  constructor({ accessToken, baseUrl = DEFAULT_BASE_URL, fetchImpl = global.fetch } = {}) {
    this.accessToken = accessToken;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async leagueSettings(leagueKey) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/settings`);
  }

  async teams(leagueKey) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/teams`);
  }

  async draftResults(leagueKey) {
    const payload = await this.get(`/league/${encodeURIComponent(leagueKey)}/draftresults`);
    return { payload, picks: extractDraftResults(payload) };
  }

  async scoreboard(leagueKey, week) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/scoreboard;week=${Number(week)}`);
  }

  async standings(leagueKey) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/standings`);
  }

  async transactions(leagueKey, { start = 0, count = 100 } = {}) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/transactions;start=${Number(start)};count=${Number(count)}`);
  }

  async roster(teamKey, week) {
    return this.get(`/team/${encodeURIComponent(teamKey)}/roster;week=${Number(week)}`);
  }

  async availablePlayers(leagueKey, { start = 0, count = 100, status = 'A' } = {}) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/players;status=${encodeURIComponent(status)};start=${Number(start)};count=${Number(count)}`);
  }

  async get(endpoint) {
    if (!this.accessToken) {
      const error = new Error('Yahoo access token is not configured');
      error.code = 'YAHOO_TOKEN_MISSING';
      throw error;
    }
    const response = await this.fetch(`${this.baseUrl}${endpoint}?format=json`, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' }
    });
    if (!response.ok) {
      const error = new Error(`Yahoo request failed (${response.status})`);
      error.code = 'YAHOO_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
}

class YahooDraftPoller {
  constructor({ client, leagueKey, sessionId, draftService, playerPool, targetTeamKey, intervalMs = 5000, onStatus = () => {} }) {
    this.client = client;
    this.leagueKey = leagueKey;
    this.sessionId = sessionId;
    this.draftService = draftService;
    this.targetTeamKey = targetTeamKey;
    this.intervalMs = Math.max(2500, intervalMs);
    this.onStatus = onStatus;
    this.playerByYahooKey = new Map(
      playerPool.players.filter((player) => player.yahooPlayerKey).map((player) => [player.yahooPlayerKey, player])
    );
    this.timer = null;
    this.running = false;
  }

  async syncOnce() {
    const { picks } = await this.client.draftResults(this.leagueKey);
    const session = this.draftService.getSession(this.sessionId);
    for (const pick of picks.filter((item) => item.overallPick > session.picks.length)) {
      const player = this.playerByYahooKey.get(pick.yahooPlayerKey);
      if (!player) {
        this.onStatus({ level: 'warning', code: 'UNRESOLVED_PLAYER', pick });
        break;
      }
      this.draftService.recordPick(this.sessionId, {
        eventId: `yahoo:${this.leagueKey}:${pick.overallPick}`,
        overallPick: pick.overallPick,
        playerId: player.id,
        teamId: pick.teamKey,
        isMine: pick.teamKey === this.targetTeamKey,
        source: 'yahoo'
      });
    }
    this.onStatus({ level: 'info', code: 'SYNCED', observedPicks: picks.length });
    return this.draftService.getSession(this.sessionId);
  }

  start() {
    if (this.timer) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.syncOnce();
      } catch (error) {
        this.onStatus({ level: 'error', code: error.code || 'SYNC_FAILED', message: error.message });
      } finally {
        if (this.running) this.timer = setTimeout(tick, this.intervalMs);
      }
    };
    tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { DEFAULT_BASE_URL, YahooDraftPoller, YahooReadOnlyClient, extractDraftResults };
