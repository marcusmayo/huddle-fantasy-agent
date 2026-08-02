'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
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
    yahooPlayerKey: raw.yahoo_player_key || raw.yahooPlayerKey || null,
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

function projectionPoints(raw) {
  return firstNumber(
    raw.fpts,
    raw.fantasy_points,
    raw.fantasyPoints,
    raw.projected_points,
    raw.stats?.fpts,
    raw.stats?.fantasy_points
  );
}

class FantasyProsClient {
  constructor({
    apiKey = process.env.FANTASYPROS_API_KEY,
    baseUrl = process.env.FANTASYPROS_BASE_URL || 'https://api.fantasypros.com/public/v2/json',
    cacheDir = './data/fantasypros-cache',
    cacheTtlMs = 6 * 60 * 60 * 1000,
    fetchImpl = global.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cacheDir = path.resolve(cacheDir);
    this.cacheTtlMs = cacheTtlMs;
    this.fetch = fetchImpl;
  }

  async loadDraftPool({ season, scoring = 'PPR', force = false } = {}) {
    if (!season) throw new Error('season is required');
    const batches = await Promise.all(POSITIONS.map(async (position) => {
      const [rankings, projections] = await Promise.all([
        this.request(`/nfl/${season}/consensus-rankings`, { position, scoring }, { force }),
        this.request(`/nfl/${season}/projections`, { position, scoring }, { force })
      ]);
      return { position, rankings, projections };
    }));

    const players = [];
    let complete = true;
    for (const batch of batches) {
      complete &&= !batch.rankings.truncated && !batch.projections.truncated;
      const projectionById = new Map(responsePlayers(batch.projections.payload).map((raw) => [
        String(raw.player_id || raw.playerId || raw.id), raw
      ]));
      for (const raw of responsePlayers(batch.rankings.payload)) {
        const player = normalizeRankedPlayer(raw, batch.position);
        if (!player) continue;
        const projection = projectionById.get(player.fantasyProsId) || {};
        const projectedPoints = projectionPoints(projection);
        if (!Number.isFinite(projectedPoints)) continue;
        const spread = Math.max(12, projectedPoints * 0.16);
        players.push({
          ...player,
          projectedPoints,
          floor: firstNumber(projection.floor, projection.fpts_floor) ?? projectedPoints - spread,
          ceiling: firstNumber(projection.ceiling, projection.fpts_ceiling) ?? projectedPoints + spread
        });
      }
    }
    return {
      source: 'fantasypros-api',
      season,
      complete,
      fetchedAt: new Date().toISOString(),
      players
    };
  }

  async request(endpoint, params, { force = false } = {}) {
    if (!this.apiKey) {
      const error = new Error('FANTASYPROS_API_KEY is not configured');
      error.code = 'FANTASYPROS_KEY_MISSING';
      throw error;
    }
    const query = new URLSearchParams(params);
    const url = `${this.baseUrl}${endpoint}?${query}`;
    const cacheKey = Buffer.from(url).toString('base64url');
    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);
    if (!force && fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Date.now() - Date.parse(cached.cachedAt) < this.cacheTtlMs) {
        const safeCached = { ...cached, payload: stripPlayerImageFields(cached.payload), cacheHit: true };
        fs.writeFileSync(cachePath, `${JSON.stringify(safeCached)}\n`, { mode: 0o600 });
        return safeCached;
      }
    }

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
  isTruncated,
  normalizeRankedPlayer,
  responsePlayers,
  stripPlayerImageFields
};
