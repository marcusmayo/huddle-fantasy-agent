'use strict';

const { extractYahooLeagues } = require('./yahoo-normalizer');
const { pickOwner } = require('../domain/league');

const DEFAULT_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

function qualifyYahooPlayerKey(playerKey, leagueKey) {
  const rawPlayerKey = String(playerKey || '').trim();
  const rawLeagueKey = String(leagueKey || '').trim();
  const gameKey = rawLeagueKey.includes('.l.') ? rawLeagueKey.split('.l.')[0] : '';
  const playerId = rawPlayerKey.includes('.p.') ? rawPlayerKey.split('.p.').at(-1) : rawPlayerKey;
  if (!gameKey || !/^\d+$/.test(playerId)) return null;
  return `${gameKey}.p.${playerId}`;
}

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

function recursivelyFindScalars(value, key, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) recursivelyFindScalars(item, key, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  if (Object.prototype.hasOwnProperty.call(value, key)
    && ['string', 'number', 'boolean'].includes(typeof value[key])) output.push(value[key]);
  for (const child of Object.values(value)) recursivelyFindScalars(child, key, output);
  return output;
}

function extractYahooPlayer(payload, expectedPlayerKey) {
  const first = (key) => recursivelyFindScalars(payload, key)[0];
  const yahooPlayerKey = String(first('player_key') || expectedPlayerKey || '').trim();
  if (!yahooPlayerKey) return null;
  const rawPosition = String(first('display_position') || first('position') || '').toUpperCase();
  const position = rawPosition === 'DST' || rawPosition === 'D/ST' ? 'DEF' : rawPosition;
  const fullName = first('full');
  const firstName = first('first');
  const lastName = first('last');
  const name = String(fullName || [firstName, lastName].filter(Boolean).join(' ') || '').trim();
  return {
    yahooPlayerKey,
    name: name || null,
    position: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(position) ? position : null,
    team: String(first('editorial_team_abbr') || 'FA').toUpperCase()
  };
}

class YahooReadOnlyClient {
  constructor({
    accessToken,
    tokenProvider,
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = global.fetch,
    maxAttempts = 3,
    baseDelayMs = 250,
    requestTimeoutMs = 10_000,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.accessToken = accessToken;
    this.tokenProvider = tokenProvider;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.maxAttempts = Math.max(1, Math.min(5, Number(maxAttempts) || 3));
    this.baseDelayMs = Math.max(0, Number(baseDelayMs) || 0);
    this.requestTimeoutMs = Math.max(1_000, Number(requestTimeoutMs) || 10_000);
    this.sleep = sleep;
  }

  async leagueSettings(leagueKey) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/settings`);
  }

  async userNflLeagues() {
    const payload = await this.get('/users;use_login=1/games;game_codes=nfl/leagues;out=teams');
    return extractYahooLeagues(payload);
  }

  async teams(leagueKey) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/teams`);
  }

  async draftResults(leagueKey) {
    const payload = await this.get(`/league/${encodeURIComponent(leagueKey)}/draftresults`);
    return { payload, picks: extractDraftResults(payload) };
  }

  async player(playerKey) {
    const payload = await this.get(`/player/${encodeURIComponent(playerKey)}`);
    return extractYahooPlayer(payload, playerKey);
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

  async availablePlayers(leagueKey, { start = 0, count = 100, status = 'A', position = null } = {}) {
    const filters = [`status=${encodeURIComponent(status)}`];
    if (position) filters.push(`position=${encodeURIComponent(position)}`);
    filters.push(`start=${Number(start)}`, `count=${Number(count)}`);
    return this.get(`/league/${encodeURIComponent(leagueKey)}/players;${filters.join(';')}`);
  }

  async get(endpoint) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${endpoint}${separator}format=json`;
    let lastError;
    let attempts = 0;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      attempts = attempt;
      const token = this.tokenProvider ? await this.tokenProvider() : this.accessToken;
      if (!token) {
        const error = new Error('Yahoo access token is not configured');
        error.code = 'YAHOO_TOKEN_MISSING';
        throw error;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      let response;
      try {
        response = await this.fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: controller.signal
        });
      } catch (cause) {
        lastError = new Error(cause?.name === 'AbortError' ? 'Yahoo request timed out' : 'Yahoo request failed');
        lastError.code = cause?.name === 'AbortError' ? 'YAHOO_REQUEST_TIMEOUT' : 'YAHOO_REQUEST_FAILED';
        lastError.cause = cause;
      } finally {
        clearTimeout(timeout);
      }
      if (response?.ok) return response.json();
      if (response) {
        lastError = new Error(`Yahoo request failed (${response.status})`);
        lastError.code = response.status === 429 ? 'YAHOO_RATE_LIMITED' : 'YAHOO_REQUEST_FAILED';
        lastError.status = response.status;
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        lastError.retryAfterMs = Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1_000) : null;
      }
      const retryable = !response || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === this.maxAttempts) break;
      const backoff = lastError.retryAfterMs ?? this.baseDelayMs * (2 ** (attempt - 1));
      await this.sleep(backoff);
    }
    lastError.attempts = attempts;
    throw lastError;
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
    this.playerByYahooId = new Map(
      playerPool.players
        .map((player) => [String(player.yahooPlayerKey || '').split('.p.').at(-1), player])
        .filter(([id]) => id && id !== 'undefined')
    );
    this.playerByIdentity = new Map(
      playerPool.players.map((player) => [
        `${String(player.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${player.position}`,
        player
      ])
    );
    this.timer = null;
    this.running = false;
  }

  async syncOnce() {
    const { picks } = await this.client.draftResults(this.leagueKey);
    const session = this.draftService.getSession(this.sessionId);
    const unresolvedPicks = [];
    for (const pick of picks.filter((item) => item.overallPick > session.picks.length)) {
      let player = this.playerByYahooKey.get(pick.yahooPlayerKey)
        || this.playerByYahooId.get(String(pick.yahooPlayerKey).split('.p.').at(-1));
      let externalPlayer = null;
      if (!player) {
        try {
          externalPlayer = typeof this.client.player === 'function'
            ? await this.client.player(pick.yahooPlayerKey)
            : null;
          const identity = externalPlayer?.name && externalPlayer?.position
            ? `${externalPlayer.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${externalPlayer.position}`
            : null;
          player = identity ? this.playerByIdentity.get(identity) : null;
        } catch (error) {
          this.onStatus({
            level: 'warning',
            code: 'YAHOO_PLAYER_LOOKUP_FAILED',
            message: error.message,
            pick
          });
        }
        if (!player && (!externalPlayer?.name || !externalPlayer?.position)) {
          unresolvedPicks.push(pick.overallPick);
          this.onStatus({
            level: 'warning',
            code: 'UNRESOLVED_PLAYER_RECORDED',
            message: `Yahoo pick ${pick.overallPick} was recorded by player key so later picks can continue syncing`,
            pick
          });
        } else if (!player) {
          this.onStatus({ level: 'info', code: 'PLAYER_RESOLVED_FROM_YAHOO', pick });
        }
      }
      const isMine = pick.teamKey === this.targetTeamKey;
      if (isMine) {
        const observedSlot = pickOwner(pick.overallPick, this.draftService.league.teamCount);
        if (observedSlot !== this.draftService.getSession(this.sessionId).draftSlot) {
          this.draftService.updateDraftSlot(this.sessionId, observedSlot, { source: 'yahoo-draft-result' });
          this.onStatus({ level: 'info', code: 'DRAFT_SLOT_RECONCILED', draftSlot: observedSlot });
        }
      }
      this.draftService.recordPick(this.sessionId, {
        eventId: `yahoo:${this.leagueKey}:${pick.overallPick}`,
        overallPick: pick.overallPick,
        playerId: player?.id,
        externalPlayer: player ? null : { ...(externalPlayer || {}), yahooPlayerKey: pick.yahooPlayerKey },
        yahooPlayerKey: pick.yahooPlayerKey,
        teamId: pick.teamKey,
        isMine,
        source: 'yahoo'
      });
    }
    const saved = this.draftService.getSession(this.sessionId);
    const persistentUnresolvedPicks = saved.picks
      .filter((pick) => pick.resolutionStatus === 'unresolved-yahoo')
      .map((pick) => pick.overallPick);
    this.onStatus({
      level: 'info',
      code: 'SYNCED',
      observedPicks: picks.length,
      unresolvedPicks: [...new Set([...persistentUnresolvedPicks, ...unresolvedPicks])].sort((a, b) => a - b)
    });
    if (saved.status === 'completed') {
      this.stop();
      this.onStatus({ level: 'info', code: 'DRAFT_COMPLETED', observedPicks: picks.length });
    }
    return saved;
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

module.exports = {
  DEFAULT_BASE_URL,
  YahooDraftPoller,
  YahooReadOnlyClient,
  extractDraftResults,
  extractYahooPlayer,
  qualifyYahooPlayerKey
};
