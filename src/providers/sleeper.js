'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizePosition(value) {
  const position = String(value || '').toUpperCase();
  return position === 'DST' || position === 'D/ST' ? 'DEF' : position;
}

function playerName(player) {
  return String(player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(' ') || '').trim();
}

function normalizeSleeperTrends({ playerMap = {}, adds = [], drops = [] } = {}) {
  const addCounts = new Map(adds.map((row) => [String(row.player_id), Number(row.count) || 0]));
  const dropCounts = new Map(drops.map((row) => [String(row.player_id), Number(row.count) || 0]));
  const ids = new Set([...addCounts.keys(), ...dropCounts.keys()]);
  return [...ids].map((id) => {
    const player = playerMap[id] || {};
    const addsCount = addCounts.get(id) || 0;
    const dropsCount = dropCounts.get(id) || 0;
    const direction = addsCount === dropsCount ? 'neutral' : addsCount > dropsCount ? 'rising' : 'falling';
    return {
      sleeperId: id,
      yahooId: player.yahoo_id == null ? null : String(player.yahoo_id),
      fantasyDataId: player.fantasy_data_id == null ? null : String(player.fantasy_data_id),
      name: playerName(player),
      position: normalizePosition(player.position || player.fantasy_positions?.[0]),
      team: String(player.team || 'FA').toUpperCase(),
      direction,
      adds: addsCount,
      drops: dropsCount,
      net: addsCount - dropsCount
    };
  }).filter((row) => row.name && row.position);
}

class SleeperClient {
  constructor({
    enabled = String(process.env.HUDDLE_SLEEPER_TRENDS_ENABLED || 'true').toLowerCase() !== 'false',
    baseUrl = process.env.SLEEPER_BASE_URL || 'https://api.sleeper.app/v1',
    cacheDir = './data/sleeper-cache',
    playerCacheTtlMs = 24 * 60 * 60 * 1000,
    trendCacheTtlMs = 6 * 60 * 60 * 1000,
    lookbackHours = Number(process.env.SLEEPER_TREND_LOOKBACK_HOURS || 24),
    trendLimit = Number(process.env.SLEEPER_TREND_LIMIT || 100),
    fetchImpl = global.fetch
  } = {}) {
    this.enabled = Boolean(enabled);
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cacheDir = path.resolve(cacheDir);
    this.playerCacheTtlMs = Math.max(24 * 60 * 60 * 1000, Number(playerCacheTtlMs) || 24 * 60 * 60 * 1000);
    this.trendCacheTtlMs = Math.max(60 * 60 * 1000, Number(trendCacheTtlMs) || 6 * 60 * 60 * 1000);
    this.lookbackHours = Math.max(1, Math.min(168, Number(lookbackHours) || 24));
    this.trendLimit = Math.max(25, Math.min(250, Number(trendLimit) || 100));
    this.fetch = fetchImpl;
  }

  get configured() {
    return this.enabled;
  }

  cachePath(key) {
    return path.join(this.cacheDir, `${key}.json`);
  }

  freshCache(cachePath, ttlMs) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return Date.now() - Date.parse(cached.cachedAt) < ttlMs ? cached : null;
    } catch {
      return null;
    }
  }

  async request(pathname, { cacheKey, ttlMs, force = false } = {}) {
    const cachePath = this.cachePath(cacheKey);
    if (!force) {
      const cached = this.freshCache(cachePath, ttlMs);
      if (cached) return { payload: cached.payload, cachedAt: cached.cachedAt, cacheHit: true };
    }
    const response = await this.fetch(`${this.baseUrl}${pathname}`, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error(`Sleeper request failed (${response.status})`);
      error.code = 'SLEEPER_REQUEST_FAILED';
      throw error;
    }
    const value = { payload: await response.json(), cachedAt: new Date().toISOString(), cacheHit: false };
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return value;
  }

  async loadDraftEvidence({ force = false } = {}) {
    if (!this.enabled) return { source: 'sleeper-api', enabled: false, players: [] };
    const query = `lookback_hours=${this.lookbackHours}&limit=${this.trendLimit}`;
    const [playerMap, adds, drops] = await Promise.all([
      // Sleeper explicitly asks consumers to cache this ~5 MB map and call it no more than daily.
      this.request('/players/nfl', { cacheKey: 'players-nfl', ttlMs: this.playerCacheTtlMs, force: false }),
      this.request(`/players/nfl/trending/add?${query}`, { cacheKey: `trending-add-${this.lookbackHours}-${this.trendLimit}`, ttlMs: this.trendCacheTtlMs, force }),
      this.request(`/players/nfl/trending/drop?${query}`, { cacheKey: `trending-drop-${this.lookbackHours}-${this.trendLimit}`, ttlMs: this.trendCacheTtlMs, force })
    ]);
    return {
      source: 'sleeper-api',
      enabled: true,
      fetchedAt: new Date().toISOString(),
      cacheHit: playerMap.cacheHit && adds.cacheHit && drops.cacheHit,
      lookbackHours: this.lookbackHours,
      attribution: 'Sleeper',
      players: normalizeSleeperTrends({ playerMap: playerMap.payload, adds: adds.payload, drops: drops.payload })
    };
  }
}

module.exports = { SleeperClient, normalizeSleeperTrends, playerName };
