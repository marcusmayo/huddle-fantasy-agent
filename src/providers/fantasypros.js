'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
// Rankings and projections are position-specific. The metadata request supplies
// canonical external IDs (including Yahoo) for every ranked player.
const REQUESTS_PER_FULL_SYNC = POSITIONS.length * 2 + 1;
const IMAGE_FIELD_RE = /(avatar|headshot|image|photo|picture|portrait)/i;

function stripPlayerImageFields(value) {
  if (Array.isArray(value)) return value.map(stripPlayerImageFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !IMAGE_FIELD_RE.test(key))
    .map(([key, child]) => [key, stripPlayerImageFields(child)]));
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function responsePlayers(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.players)) return payload.players;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.players)) return payload.data.players;
  return [];
}

function isTruncated(payload, responseHeaders = {}) {
  const header = String(responseHeaders['x-response-truncated'] || responseHeaders['x-truncated'] || '').toLowerCase();
  return payload?.truncated === true
    || payload?.meta?.truncated === true
    || Boolean(payload?.pagination?.next)
    || header === 'true'
    || header === '1';
}

function normalizeRankedPlayer(raw, position) {
  const id = raw.player_id || raw.playerId || raw.id;
  const name = raw.player_name || raw.playerName || raw.name;
  if (!id || !name) return null;
  return {
    id: `fantasypros:${id}`,
    fantasyProsId: String(id),
    // FantasyPros ranking responses expose Yahoo's numeric player identity as
    // `player_yahoo_id`; some integrations instead provide a full player key.
    // The Yahoo draft poller accepts either representation and compares the
    // numeric suffix when Yahoo returns a season-qualified key.
    yahooPlayerKey: firstString(
      raw.yahoo_player_key,
      raw.yahooPlayerKey,
      raw.player_yahoo_id,
      raw.yahoo_player_id,
      raw.yahoo_id,
      raw.yahooId
    ),
    name,
    position: position === 'DST' ? 'DEF' : (raw.player_position_id || raw.position || position),
    team: raw.player_team_id || raw.team || 'FA',
    expertRank: firstNumber(raw.rank_ecr, raw.ecr, raw.rank, raw.overall_rank),
    adp: firstNumber(raw.rank_adp, raw.adp, raw.adp_overall),
    tier: firstNumber(raw.tier) || 99,
    byeWeek: firstNumber(raw.bye_week, raw.bye),
    injuryStatus: raw.injury_status || raw.injuryStatus || null,
    risk: firstNumber(raw.risk, raw.risk_score) ?? 0.2
  };
}

function projectionPlayerId(raw) {
  return raw?.fpid || raw?.player_id || raw?.playerId || raw?.id || null;
}

function metadataPlayerId(raw) {
  return raw?.player_id || raw?.playerId || raw?.fpid || raw?.id || null;
}

function projectionStats(raw) {
  if (Array.isArray(raw?.stats)) return raw.stats[0] || {};
  if (raw?.stats && typeof raw.stats === 'object') return raw.stats;
  return raw || {};
}

function projectionPoints(raw, scoring = 'PPR') {
  const stats = projectionStats(raw);
  const scoringKey = String(scoring).toUpperCase();
  const preferred = scoringKey === 'HALF' ? stats.points_half
    : scoringKey === 'PPR' ? stats.points_ppr
      : stats.points;
  return firstNumber(
    preferred,
    stats.points,
    stats.points_ppr,
    stats.points_half,
    stats.fpts,
    stats.fantasy_points,
    stats.fantasyPoints,
    stats.projected_points
  );
}

class FantasyProsClient {
  constructor({
    apiKey = process.env.FANTASYPROS_API_KEY,
    baseUrl = process.env.FANTASYPROS_BASE_URL || 'https://api.fantasypros.com/public/v2/json',
    cacheDir = './data/fantasypros-cache',
    cacheTtlMs = 6 * 60 * 60 * 1000,
    dailyRequestBudget = Number(process.env.FANTASYPROS_DAILY_REQUEST_BUDGET || 24),
    fetchImpl = global.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cacheDir = path.resolve(cacheDir);
    this.cacheTtlMs = cacheTtlMs;
    this.dailyRequestBudget = Math.max(REQUESTS_PER_FULL_SYNC, Number(dailyRequestBudget) || 24);
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  usagePath(date = new Date()) {
    const day = date.toISOString().slice(0, 10);
    return path.join(this.cacheDir, `.request-usage-${day}.json`);
  }

  quotaStatus(date = new Date()) {
    const usagePath = this.usagePath(date);
    let used = 0;
    if (fs.existsSync(usagePath)) {
      try { used = Number(JSON.parse(fs.readFileSync(usagePath, 'utf8')).used) || 0; } catch { used = 0; }
    }
    return {
      budget: this.dailyRequestBudget,
      estimatedUsed: used,
      estimatedRemaining: Math.max(0, this.dailyRequestBudget - used),
      fullSyncCost: REQUESTS_PER_FULL_SYNC,
      resetsOn: date.toISOString().slice(0, 10),
      scope: 'local-estimate'
    };
  }

  reserveRequest() {
    const quota = this.quotaStatus();
    if (quota.estimatedRemaining < 1) {
      const error = new Error(`FantasyPros local daily budget exhausted (${quota.estimatedUsed}/${quota.budget})`);
      error.code = 'FANTASYPROS_BUDGET_EXHAUSTED';
      error.details = quota;
      throw error;
    }
    const usagePath = this.usagePath();
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(usagePath, `${JSON.stringify({ used: quota.estimatedUsed + 1, updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  }

  requestDescriptor(endpoint, params) {
    const query = new URLSearchParams(params);
    const url = `${this.baseUrl}${endpoint}?${query}`;
    const cacheKey = Buffer.from(url).toString('base64url');
    return { url, cachePath: path.join(this.cacheDir, `${cacheKey}.json`) };
  }

  freshCache(cachePath) {
    if (!fs.existsSync(cachePath)) return null;
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return Date.now() - Date.parse(cached.cachedAt) < this.cacheTtlMs ? cached : null;
    } catch {
      return null;
    }
  }

  async loadDraftPool({ season, scoring = 'PPR', force = false } = {}) {
    if (!season) throw new Error('season is required');
    const plan = [
      this.requestDescriptor('/nfl/players', {}),
      ...POSITIONS.flatMap((position) => [
      this.requestDescriptor(`/nfl/${season}/consensus-rankings`, { position, scoring, week: 0 }),
      this.requestDescriptor(`/nfl/${season}/projections`, { position, week: 0 })
      ])
    ];
    const requiredRequests = force ? plan.length : plan.filter((item) => !this.freshCache(item.cachePath)).length;
    const quota = this.quotaStatus();
    if (requiredRequests > quota.estimatedRemaining) {
      const error = new Error(`FantasyPros refresh needs ${requiredRequests} requests but only ${quota.estimatedRemaining} remain in Huddle's daily budget`);
      error.code = 'FANTASYPROS_BUDGET_EXHAUSTED';
      error.details = { ...quota, requiredRequests };
      throw error;
    }
    const [metadata, batches] = await Promise.all([
      this.request('/nfl/players', {}, { force }),
      Promise.all(POSITIONS.map(async (position) => {
      const [rankings, projections] = await Promise.all([
        this.request(`/nfl/${season}/consensus-rankings`, { position, scoring, week: 0 }, { force }),
        this.request(`/nfl/${season}/projections`, { position, week: 0 }, { force })
      ]);
      return { position, rankings, projections };
      }))
    ]);

    const metadataById = new Map(responsePlayers(metadata.payload)
      .map((raw) => [metadataPlayerId(raw), raw])
      .filter(([id]) => id)
      .map(([id, raw]) => [String(id), raw]));

    const players = [];
    let complete = !metadata.truncated;
    let projectedPlayers = 0;
    for (const batch of batches) {
      complete &&= !batch.rankings.truncated && !batch.projections.truncated;
      const projectionById = new Map(responsePlayers(batch.projections.payload)
        .map((raw) => [projectionPlayerId(raw), raw])
        .filter(([id]) => id)
        .map(([id, raw]) => [String(id), raw]));
      for (const raw of responsePlayers(batch.rankings.payload)) {
        const rawId = raw?.player_id || raw?.playerId || raw?.id;
        const player = normalizeRankedPlayer({ ...(metadataById.get(String(rawId)) || {}), ...raw }, batch.position);
        if (!player) continue;
        const projection = projectionById.get(player.fantasyProsId) || {};
        const projectedPoints = projectionPoints(projection, scoring);
        if (Number.isFinite(projectedPoints)) projectedPlayers += 1;
        const spread = Number.isFinite(projectedPoints) ? Math.max(12, projectedPoints * 0.16) : null;
        players.push({
          ...player,
          projectedPoints,
          floor: Number.isFinite(projectedPoints)
            ? firstNumber(projection.floor, projection.fpts_floor) ?? projectedPoints - spread
            : null,
          ceiling: Number.isFinite(projectedPoints)
            ? firstNumber(projection.ceiling, projection.fpts_ceiling) ?? projectedPoints + spread
            : null,
          projectionSource: Number.isFinite(projectedPoints) ? 'fantasypros-api' : 'missing'
        });
      }
    }
    const uniquePlayers = [...new Map(players.map((player) => [player.id, player])).values()];
    complete &&= projectedPlayers === uniquePlayers.length;
    return {
      source: 'fantasypros-api',
      season,
      complete,
      fetchedAt: new Date().toISOString(),
      projectionCoverage: {
        projected: projectedPlayers,
        ranked: uniquePlayers.length,
        coverage: uniquePlayers.length ? Math.round((projectedPlayers / uniquePlayers.length) * 10_000) / 10_000 : 0
      },
      players: uniquePlayers
    };
  }

  async request(endpoint, params, { force = false } = {}) {
    if (!this.apiKey) {
      const error = new Error('FANTASYPROS_API_KEY is not configured');
      error.code = 'FANTASYPROS_KEY_MISSING';
      throw error;
    }
    const { url, cachePath } = this.requestDescriptor(endpoint, params);
    if (!force) {
      const cached = this.freshCache(cachePath);
      if (cached) {
        const safeCached = { ...cached, payload: stripPlayerImageFields(cached.payload), cacheHit: true };
        fs.writeFileSync(cachePath, `${JSON.stringify(safeCached)}\n`, { mode: 0o600 });
        return safeCached;
      }
    }

    this.reserveRequest();
    const response = await this.fetch(url, { headers: { 'x-api-key': this.apiKey, accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error(`FantasyPros request failed (${response.status})`);
      error.code = 'FANTASYPROS_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    const payload = stripPlayerImageFields(await response.json());
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const value = {
      payload,
      truncated: isTruncated(payload, responseHeaders),
      cachedAt: new Date().toISOString(),
      cacheHit: false
    };
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return value;
  }
}

module.exports = {
  FantasyProsClient,
  POSITIONS,
  REQUESTS_PER_FULL_SYNC,
  isTruncated,
  normalizeRankedPlayer,
  metadataPlayerId,
  projectionPlayerId,
  projectionPoints,
  responsePlayers,
  stripPlayerImageFields
};
