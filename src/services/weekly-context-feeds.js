'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scorePlayerStats } = require('../domain/weekly-management');
const { normalizeTeam } = require('../domain/player-snapshot');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const BASE = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player';
const round = n => Math.round(n * 100) / 100;
const keyName = s => String(s || '').toLowerCase().replace(/\b(jr|sr)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
const num = n => Number.isFinite(Number(n)) ? Number(n) : 0;

// CSV releases contain quoted URLs, commas and embedded newlines.
function parseCsv(text) {
  const records = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (c === '\n') { records.push(row); row = []; }
    } else value += c;
  }
  if (quoted) throw new Error('Incomplete nflverse CSV');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); records.push(row); }
  const headers = records.shift() || [];
  for (const field of ['season', 'week', 'season_type', 'game_id', 'opponent_team', 'position', 'passing_yards', 'rushing_yards', 'receiving_yards']) {
    if (!headers.includes(field)) throw new Error(`nflverse missing ${field}`);
  }
  return records.filter(r => r.length === headers.length).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function playerStats(r) {
  return {
    passingYards: num(r.passing_yards), passingTouchdowns: num(r.passing_tds), interceptions: num(r.passing_interceptions),
    rushingYards: num(r.rushing_yards), rushingTouchdowns: num(r.rushing_tds), receptions: num(r.receptions),
    receivingYards: num(r.receiving_yards), receivingTouchdowns: num(r.receiving_tds),
    fumblesLost: num(r.sack_fumbles_lost) + num(r.rushing_fumbles_lost) + num(r.receiving_fumbles_lost),
    twoPointConversions: num(r.passing_2pt_conversions) + num(r.rushing_2pt_conversions) + num(r.receiving_2pt_conversions)
  };
}

function defenseRatings(rows, { season, week, league, observedAt }) {
  const games = new Map(), seen = new Set();
  for (const r of rows) {
    const year = num(r.season), w = num(r.week), team = normalizeTeam(r.opponent_team);
    if (r.season_type !== 'REG' || ![season - 1, season].includes(year) || w < 1 || w > 18 || (year === season && w >= week) || !r.game_id || !team) continue;
    const gameKey = `${year}:${r.game_id}:${team}`;
    if (!games.has(gameKey)) games.set(gameKey, { year, week: w, team, points: Object.fromEntries(POSITIONS.map(p => [p, 0])) });
    const identity = `${gameKey}:${r.player_id}`;
    if (!POSITIONS.includes(r.position) || seen.has(identity)) continue;
    seen.add(identity);
    games.get(gameKey).points[r.position] += scorePlayerStats(playerStats(r), league);
  }
  const ratings = [];
  for (const position of POSITIONS) {
    const all = [...games.values()];
    const means = Object.fromEntries([season - 1, season].map(year => {
      const sample = all.filter(g => g.year === year);
      return [year, sample.length ? sample.reduce((s, g) => s + g.points[position], 0) / sample.length : null];
    }));
    const grouped = [];
    for (const team of new Set(all.map(g => g.team))) {
      const current = all.filter(g => g.team === team && g.year === season);
      const prior = all.filter(g => g.team === team && g.year === season - 1);
      if (!current.length && !prior.length) continue;
      const avg = sample => sample.reduce((s, g) => s + g.points[position], 0) / sample.length;
      // Four pseudo-games of prior-year evidence; shrink that prior toward average.
      const priorRatio = prior.length && means[season - 1] > 0 ? avg(prior) / means[season - 1] : 1;
      const baseline = 1 + (priorRatio - 1) * prior.length / (prior.length + 8);
      const currentRatio = current.length && means[season] > 0 ? avg(current) / means[season] : 1;
      const ratio = (currentRatio * current.length + baseline * 4) / (current.length + 4);
      grouped.push({ opponent: team, position, source: 'nflverse', observedAt, season, throughWeek: week - 1,
        currentGames: current.length, priorGames: prior.length, sampleGames: current.length,
        pointsAllowedPerGame: current.length ? round(avg(current)) : null,
        priorPointsAllowedPerGame: prior.length ? round(avg(prior)) : null,
        pointsAllowedRatio: round(ratio), confidence: current.length < 4 ? 'low' : current.length < 8 ? 'moderate' : 'higher',
        scoringReceptionPoints: num(league.scoring?.offense?.reception),
        method: 'League-scored offensive production allowed by position; prior season shrunk toward average and blended as four games. Not opponent-adjusted; special-teams scores excluded. Context only.',
        sourceUrl: 'https://nflreadr.nflverse.com/articles/dictionary_player_stats.html' });
    }
    grouped.sort((a, b) => b.pointsAllowedRatio - a.pointsAllowedRatio || a.opponent.localeCompare(b.opponent));
    grouped.forEach(r => { r.rank = 1 + grouped.filter(other => other.pointsAllowedRatio > r.pointsAllowedRatio).length; r.teamCount = grouped.length; r.rankConvention = '1 = easiest for the offensive position'; });
    ratings.push(...grouped);
  }
  return ratings;
}

function safeLink(link) {
  try { const url = new URL(link); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

function normalizeNews(body, observedAt, now) {
  const seen = new Set();
  return (Array.isArray(body) ? body : []).flatMap(r => {
    const url = safeLink(r.link || r.url), title = String(r.title || '').trim();
    if (!url || !title || seen.has(url + title)) return [];
    seen.add(url + title);
    const rawDate = r.publishedAt || r.pubDate || r.published || r.date;
    const ms = rawDate ? Date.parse(rawDate) : NaN;
    if (rawDate && (!Number.isFinite(ms) || now.getTime() - ms < -300000 || now.getTime() - ms > 72 * 3600000)) return [];
    const name = String(r.playerName || title.split(':')[0]);
    return [{ playerName: name, source: 'Tank01', publisher: new URL(url).hostname, summary: title.slice(0, 800), url,
      publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null, observedAt,
      dateStatus: Number.isFinite(ms) ? 'published' : 'Publication date unavailable; retrieved from current feed' }];
  });
}

class WeeklyContextFeeds {
  constructor({ tank01Client, cacheDir = './data/weekly-context-cache', fetchImpl = global.fetch, now = () => new Date() } = {}) {
    this.tank = tank01Client; this.cacheDir = path.resolve(cacheDir); this.fetch = fetchImpl; this.now = now; this.pending = new Map();
  }
  async cached(key, ttl, loader) {
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      const filename = path.join(this.cacheDir, `${key}.json`);
      try { const c = JSON.parse(fs.readFileSync(filename, 'utf8')); const age = this.now() - Date.parse(c.observedAt); if (age >= 0 && age < ttl) return c; } catch {}
      const body = await loader(); const result = { body, observedAt: this.now().toISOString() };
      fs.mkdirSync(this.cacheDir, { recursive: true }); fs.writeFileSync(filename, JSON.stringify(result), { mode: 0o600 }); return result;
    })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  async load({ season, week, league }) {
    const warnings = [];
    const capture = async (name, fn) => { try { return await fn(); } catch (e) { warnings.push(`${name}: ${e.code || e.message}`); return null; } };
    const [news, current, prior] = await Promise.all([
      capture('Tank01 news', () => this.cached('tank01-news', 6 * 3600000, async () => {
        if (!this.tank?.configured) throw new Error('not configured');
        this.tank.reserveRequest();
        const url = new URL(`${this.tank.baseUrl}/getNFLNews`); url.searchParams.set('fantasyNews', 'true'); url.searchParams.set('maxItems', '100');
        const r = await this.tank.fetch(url, { headers: { 'x-rapidapi-key': this.tank.apiKey, 'x-rapidapi-host': this.tank.host }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const p = await r.json(); if (Number(p.statusCode) !== 200 || !Array.isArray(p.body)) throw new Error('unexpected news response'); return p.body;
      })),
      ...[season, season - 1].map(year => capture(`nflverse ${year}`, () => this.cached(`nflverse-${year}`, (year === season ? 6 : 168) * 3600000, async () => {
        const r = await this.fetch(`${BASE}/stats_player_week_${year}.csv`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows = parseCsv(await r.text());
        if (!rows.length || rows.some(row => num(row.season) !== year)) throw new Error('empty or wrong-season statistics');
        return rows;
      })))
    ]);
    const ratings = defenseRatings([...(current?.body || []), ...(prior?.body || [])], { season, week, league, observedAt: current?.observedAt || prior?.observedAt });
    if (!current?.body.some(r => r.season_type === 'REG' && num(r.week) === week - 1) && week > 1) warnings.push(`nflverse has no completed Week ${week - 1} statistics; ratings may rely on older evidence.`);
    const articles = news ? normalizeNews(news.body, news.observedAt, this.now()) : [];
    if (articles.some(n => !n.publishedAt)) warnings.push('Tank01 news includes undated headlines. Retrieval time is shown separately; publication time is not invented.');
    const quota = this.tank?.quotaStatus?.();
    if (quota) warnings.push(`Tank01 local request budget: ${quota.estimatedRemaining}/${quota.budget} remaining this month; shared by projections, schedule and news. Feeds stop at the limit.`);
    return { ratings, news: articles, warnings, observedAt: news?.observedAt, statisticsObservedAt: current?.observedAt || prior?.observedAt };
  }
}

function newsForPlayer(player, news, players) {
  const key = keyName(player.name);
  if (players.filter(p => keyName(p.name) === key).length !== 1) return [];
  return news.filter(n => keyName(n.playerName) === key).slice(0, 5);
}

module.exports = { WeeklyContextFeeds, parseCsv, playerStats, defenseRatings, normalizeNews, newsForPlayer, safeLink };
