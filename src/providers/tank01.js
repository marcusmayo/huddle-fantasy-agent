'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function unwrapBody(payload) {
  let body = payload?.body ?? payload?.data ?? payload;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return []; }
  }
  return body;
}

function responseRows(payload) {
  const body = unwrapBody(payload);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.players)) return body.players;
  if (Array.isArray(body?.adp)) return body.adp;
  if (body && typeof body === 'object') return Object.values(body).filter((item) => item && typeof item === 'object');
  return [];
}

function normalizePosition(value) {
  const position = String(value || '').toUpperCase();
  return position === 'DST' || position === 'D/ST' ? 'DEF' : position;
}

function normalizeTank01Players(payload) {
  return responseRows(payload).map((raw, index) => {
    const name = raw.longName || raw.playerName || raw.name || raw.fullName;
    const position = normalizePosition(raw.pos || raw.position || raw.playerPosition);
    if (!name || !position) return null;
    return {
      tank01Id: String(raw.playerID || raw.playerId || raw.id || ''),
      name: String(name),
      position,
      team: String(raw.team || raw.teamAbv || raw.teamID || 'FA').toUpperCase(),
      rank: firstNumber(raw.overallRank, raw.rank, raw.adpRank, raw.overallADP, raw.adp) ?? index + 1,
      projectedPoints: firstNumber(
        raw.projectedPoints,
        raw.fantasyPoints,
        raw.fantasyPts,
        raw.totalFantasyPoints,
        raw.fpts
      )
    };
  }).filter(Boolean);
}

function scoringToAdpType(scoring) {
  const value = String(scoring || 'PPR').toUpperCase();
  if (value === 'HALF' || value === 'HALF_PPR' || value === 'HALFPPR') return 'halfPPR';
  if (value === 'STD' || value === 'STANDARD' || value === 'NON_PPR') return 'standard';
  return 'PPR';
}

class Tank01Client {
  constructor({
    apiKey = process.env.TANK01_API_KEY || process.env.RAPIDAPI_KEY,
    host = process.env.TANK01_API_HOST || DEFAULT_HOST,
    baseUrl = process.env.TANK01_BASE_URL,
    adpPath = process.env.TANK01_ADP_PATH || '/getNFLADP',
    cacheDir = './data/tank01-cache',
    cacheTtlMs = 24 * 60 * 60 * 1000,
    monthlyRequestBudget = Number(process.env.TANK01_MONTHLY_REQUEST_BUDGET || 40),
    fetchImpl = global.fetch
  } = {}) {
    this.apiKey = apiKey;
    this.host = host;
    this.baseUrl = String(baseUrl || `https://${host}`).replace(/\/$/, '');
    this.adpPath = adpPath.startsWith('/') ? adpPath : `/${adpPath}`;
    this.cacheDir = path.resolve(cacheDir);
    this.cacheTtlMs = Math.max(6 * 60 * 60 * 1000, Number(cacheTtlMs) || 24 * 60 * 60 * 1000);
    this.monthlyRequestBudget = Math.max(1, Number(monthlyRequestBudget) || 40);
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  usagePath(date = new Date()) {
    return path.join(this.cacheDir, `.request-usage-${date.toISOString().slice(0, 7)}.json`);
  }

  quotaStatus(date = new Date()) {
    let used = 0;
    try { used = Number(JSON.parse(fs.readFileSync(this.usagePath(date), 'utf8')).used) || 0; } catch { used = 0; }
    return {
      budget: this.monthlyRequestBudget,
      estimatedUsed: used,
      estimatedRemaining: Math.max(0, this.monthlyRequestBudget - used),
      period: date.toISOString().slice(0, 7),
      scope: 'local-estimate'
    };
  }

  reserveRequest() {
    const quota = this.quotaStatus();
    if (quota.estimatedRemaining < 1) {
      const error = new Error(`Tank01 local monthly budget exhausted (${quota.estimatedUsed}/${quota.budget})`);
      error.code = 'TANK01_BUDGET_EXHAUSTED';
      error.details = quota;
      throw error;
    }
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(this.usagePath(), `${JSON.stringify({ used: quota.estimatedUsed + 1, updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  }

  cachePath(adpType) {
    return path.join(this.cacheDir, `adp-${adpType}.json`);
  }

  freshCache(cachePath) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return Date.now() - Date.parse(cached.cachedAt) < this.cacheTtlMs ? cached : null;
    } catch {
      return null;
    }
  }

  async loadDraftEvidence({ scoring = 'PPR', force = false } = {}) {
    if (!this.configured) {
      const error = new Error('TANK01_API_KEY is not configured');
      error.code = 'TANK01_KEY_MISSING';
      throw error;
    }
    const adpType = scoringToAdpType(scoring);
    const cachePath = this.cachePath(adpType);
    if (!force) {
      const cached = this.freshCache(cachePath);
      if (cached) return { ...cached, cacheHit: true };
    }
    this.reserveRequest();
    const url = new URL(`${this.baseUrl}${this.adpPath}`);
    url.searchParams.set('adpType', adpType);
    const response = await this.fetch(url, {
      headers: {
        accept: 'application/json',
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': this.host
      }
    });
    if (!response.ok) {
      const error = new Error(`Tank01 request failed (${response.status})`);
      error.code = 'TANK01_REQUEST_FAILED';
      throw error;
    }
    const players = normalizeTank01Players(await response.json());
    if (!players.length) {
      const error = new Error('Tank01 returned no usable ADP or projection rows');
      error.code = 'TANK01_EMPTY_RESPONSE';
      throw error;
    }
    const value = {
      source: 'tank01-api',
      scoring: adpType,
      fetchedAt: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
      cacheHit: false,
      players
    };
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return value;
  }
}

module.exports = {
  DEFAULT_HOST,
  Tank01Client,
  normalizeTank01Players,
  responseRows,
  scoringToAdpType
};
