'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scorePlayerStats } = require('../domain/weekly-management');
const { normalizeTeam } = require('../domain/player-snapshot');
const { newsForPlayer } = require('./weekly-context-feeds');
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const nameKey = value => String(value || '').toLowerCase().replace(/\b(jr|sr)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
const pos = value => ({ DST: 'DEF', 'D/ST': 'DEF', PK: 'K' }[value] || value);
const round = value => Math.round(value * 100) / 100;

function mapStats(raw, mapping) {
  return Object.fromEntries(Object.entries(mapping).flatMap(([key, value]) => number(raw[value]) == null ? [] : [[key, number(raw[value])]]));
}

function tankPlayers(body) {
  const players = Object.values(body.playerProjections || {}).map(raw => ({
    name: raw.longName, position: pos(raw.pos), team: normalizeTeam(raw.team),
    stats: {
      ...mapStats(raw.Passing || {}, { passingYards: 'passYds', passingTouchdowns: 'passTD', interceptions: 'int' }),
      ...mapStats(raw.Rushing || {}, { rushingYards: 'rushYds', rushingTouchdowns: 'rushTD' }),
      ...mapStats(raw.Receiving || {}, { receptions: 'receptions', receivingYards: 'recYds', receivingTouchdowns: 'recTD' }),
      ...mapStats(raw, { fumblesLost: 'fumblesLost', twoPointConversions: 'twoPointConversion' })
    },
    kicking: raw.Kicking || null
  }));
  return players.concat(Object.values(body.teamDefenseProjections || {}).map(raw => ({
    name: raw.teamAbv, team: normalizeTeam(raw.teamAbv), position: 'DEF',
    stats: mapStats(raw, { sacks: 'sacks', defensiveInterceptions: 'interceptions', fumbleRecoveries: 'fumbleRecoveries',
      defensiveTouchdowns: 'defTD', safeties: 'safeties', blockedKicks: 'blockKick',
      kickoffOrPuntReturnTouchdowns: 'returnTD', pointsAllowed: 'ptsAgainst' })
  })));
}

function fantasyProsPlayers(payload) {
  return (payload.players || []).map(raw => ({
    name: raw.name || raw.player_name, position: pos(raw.position_id || raw.position), team: normalizeTeam(raw.team_id || raw.team),
    stats: mapStats(Array.isArray(raw.stats) ? raw.stats[0] : raw.stats || {}, {
      passingYards: 'pass_yds', passingTouchdowns: 'pass_tds', interceptions: 'pass_ints',
      rushingYards: 'rush_yds', rushingTouchdowns: 'rush_tds', receptions: 'rec_rec', receivingYards: 'rec_yds',
      receivingTouchdowns: 'rec_tds', fumblesLost: 'fumbles', twoPointConversions: '2pt_tds', returnTouchdowns: 'ret_tds',
      sacks: 'def_sack', defensiveInterceptions: 'def_int', defensiveTouchdowns: 'def_td', pointsAllowed: 'def_pa',
      safeties: 'def_safety', fumbleRecoveries: 'def_fr', kickoffOrPuntReturnTouchdowns: 'def_retd'
    }),
    kicking: (raw.position_id || raw.position) === 'K' ? { fgMade: raw.stats?.fg, xpMade: raw.stats?.xpt } : null
  }));
}

function findPlayer(player, rows) {
  const matches = rows.filter(row => row.position === player.position && normalizeTeam(row.team) === normalizeTeam(player.nflTeam)
    && (player.position === 'DEF' || nameKey(row.name) === nameKey(player.name)));
  return matches.length === 1 ? matches[0] : null;
}

class WeeklyEvidenceService {
  constructor({ tank01Client, fantasyProsClient, sleeperClient, contextFeeds, now = () => new Date() } = {}) {
    this.tank = tank01Client; this.fp = fantasyProsClient; this.sleeper = sleeperClient; this.now = now;
    this.inflight = new Map();
    this.contextFeeds = contextFeeds;
  }

  async tankRequest(endpoint, season, week) {
    if (!this.tank?.configured) throw new Error('Tank01 is not configured');
    const cachePath = path.join(this.tank.cacheDir, `weekly-${endpoint}-${season}-${week}.json`);
    let cached;
    try { cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
    const cacheAge = this.now().getTime() - Date.parse(cached?.observedAt);
    if (cached && cacheAge >= -300000 && cacheAge < 6 * 3600000) return cached;
    this.tank.reserveRequest();
    const url = new URL(`${this.tank.baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries({ season, week, seasonType: 'reg' })) url.searchParams.set(key, value);
    const response = await this.tank.fetch(url, { headers: { 'x-rapidapi-key': this.tank.apiKey, 'x-rapidapi-host': this.tank.host }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Tank01 ${endpoint} failed (${response.status})`);
    const payload = await response.json();
    if (Number(payload.statusCode) !== 200 || !payload.body) throw new Error(`Tank01 ${endpoint} returned no usable data`);
    const result = { body: payload.body, observedAt: this.now().toISOString() };
    fs.mkdirSync(this.tank.cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result), { mode: 0o600 });
    return result;
  }

  async load(season, week) {
    const key = `${season}:${week}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = this.loadSources(season, week);
    this.inflight.set(key, pending);
    try { return await pending; } finally { this.inflight.delete(key); }
  }

  async loadSources(season, week) {
    const warnings = [], sources = [], schedules = [];
    const capture = async (name, fn) => { try { return await fn(); } catch (error) { warnings.push(`${name}: ${error.code || error.message}`); return null; } };
    const [tank, schedule, trends] = await Promise.all([
      capture('Tank01 projections', () => this.tankRequest('getNFLProjections', season, week)),
      capture('Tank01 schedule', () => this.tankRequest('getNFLGamesForWeek', season, week)),
      capture('Sleeper trends', () => this.sleeper?.configured ? this.sleeper.loadDraftEvidence() : null)
    ]);
    if (tank) {
      if (Number(tank.body.season) === season && Number(tank.body.week) === week) sources.push({ source: 'tank01', observedAt: tank.observedAt, players: tankPlayers(tank.body) });
      else warnings.push('Tank01 projection period did not match the requested season/week.');
    }
    for (const game of schedule?.body || []) {
      if (Number(game.season) !== season || Number(String(game.gameWeek).replace(/\D/g, '')) !== week) continue;
      schedules.push({ home: normalizeTeam(game.home), away: normalizeTeam(game.away), kickoff: number(game.gameTime_epoch) * 1000, status: String(game.gameStatusCode), observedAt: schedule.observedAt });
    }
    if (this.fp?.configured) for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      const result = await capture(`FantasyPros ${position}`, () => this.fp.request(`/nfl/${season}/projections`, { position, week }));
      if (!result) continue;
      if (Number(result.payload?.season) !== season || Number(result.payload?.week) !== week) { warnings.push(`FantasyPros ${position}: wrong projection period.`); continue; }
      if (result.truncated || result.payload.public_api_limited) warnings.push(`FantasyPros ${position}: API plan supplies a limited player set.`);
      sources.push({ source: 'fantasyPros', observedAt: result.cachedAt, players: fantasyProsPlayers(result.payload) });
    }
    return { sources, schedules, warnings, trends: trends?.players || [] };
  }

  async enrich(snapshot, league) {
    const { sources, schedules, warnings, trends = [] } = await this.load(Number(snapshot.season), Number(snapshot.week));
    let extra = { ratings: [], news: [], warnings: [] };
    if (this.contextFeeds) {
      try { extra = await this.contextFeeds.load({ season: Number(snapshot.season), week: Number(snapshot.week), league }); }
      catch (error) { extra.warnings.push(`Weekly context feeds: ${error.message}`); }
    }
    const players = [...snapshot.roster, ...snapshot.availablePlayers];
    const enrich = player => {
      const game = schedules.find(game => [game.home, game.away].includes(normalizeTeam(player.nflTeam)));
      const projections = [];
      for (const source of sources) {
        const age = this.now().getTime() - Date.parse(source.observedAt);
        if (!Number.isFinite(age) || age < -300000 || age > 86400000) continue;
        const row = findPlayer(player, source.players);
        if (!row) continue;
        if (player.position === 'K') {
          const fields = Object.entries(league.scoring?.kicking || {}).filter(([key]) => key.startsWith('fieldGoal')).map(([, value]) => Number(value));
          const fg = number(row.kicking?.fgMade), xp = number(row.kicking?.xpMade);
          if (fg == null || xp == null || !fields.length) continue;
          const pat = xp * Number(league.scoring.kicking.pointAfterAttemptMade || 0);
          projections.push({ source: source.source, points: round(fg * Math.min(...fields) + pat), upperPoints: round(fg * Math.max(...fields) + pat), updatedAt: source.observedAt,
            limitation: 'Field-goal distance splits unavailable; conservative lower bound with scoring range.' });
        } else if (Object.keys(row.stats).length) {
          const stats = { ...row.stats };
          // A projected mean is not a realized score distribution. Round only
          // the points-allowed bucket and disclose that approximation.
          if (stats.pointsAllowed != null) stats.pointsAllowed = Math.round(stats.pointsAllowed);
          projections.push({ source: source.source, points: scorePlayerStats(stats, league), updatedAt: source.observedAt,
            limitation: player.position === 'DEF' ? 'Points-allowed bonus uses rounded projected points allowed, not a full outcome distribution.' : null });
        }
      }
      const fp = projections.find(row => row.source === 'fantasyPros'), tank = projections.find(row => row.source === 'tank01');
      const points = fp && tank ? round(fp.points * 0.675 + tank.points * 0.325) : projections[0]?.points ?? player.projectedPoints;
      const updatedAt = projections.map(row => row.updatedAt).sort()[0] || snapshot.observedAt;
      const opponent = game ? game.home === normalizeTeam(player.nflTeam) ? game.away : game.home : null;
      const gameStarted = Boolean(game && (['1', '2'].includes(game.status) || game.kickoff > 0 && game.kickoff <= this.now().getTime()));
      const trend = findPlayer(player, trends);
      const projectionUpperPoints = fp && tank && fp.upperPoints != null && tank.upperPoints != null
        ? round(fp.upperPoints * 0.675 + tank.upperPoints * 0.325) : projections[0]?.upperPoints ?? points;
      return { ...player, projectedPoints: points, projectionUpperPoints, gameStarted, projectionSources: projections,
        projectionLimitations: [...new Set(projections.map(row => row.limitation).filter(Boolean))],
        sleeperTrend: trend || null,
        sourceCoverage: { fantasyPros: Boolean(fp), tank01: Boolean(tank), sleeper: Boolean(trend) },
        weeklyContext: { ...player.weeklyContext, season: snapshot.season, week: snapshot.week, source: 'weekly-provider-reconciliation', observedAt: this.now().toISOString(), opponent,
          defense: extra.ratings.find(r => r.opponent === opponent && r.position === player.position) || null,
          news: newsForPlayer(player, extra.news, players),
          projection: points == null ? null : { points, updatedAt, source: projections.map(row => row.source).join(' + ') || 'Yahoo import', includes: ['matchup'], contextNeutral: false } }
      };
    };
    snapshot.roster = snapshot.roster.map(enrich);
    snapshot.availablePlayers = snapshot.availablePlayers.map(enrich);
    snapshot.reconciliation = { warnings: [...warnings, ...extra.warnings], projectionSources: [...new Set(sources.map(row => row.source))],
      newsArticles: extra.news.length, defensiveRatings: extra.ratings.length, newsObservedAt: extra.observedAt || null,
      statisticsObservedAt: extra.statisticsObservedAt || null,
      rosterProjected: snapshot.roster.filter(row => row.projectedPoints != null).length, rosterCount: snapshot.roster.length,
      availableProjected: snapshot.availablePlayers.filter(row => row.projectedPoints != null).length,
      scheduleGames: schedules.length, method: 'League-scored weekly statistics; FantasyPros 67.5% / Tank01 32.5% when both match; otherwise single source. No preseason extrapolation.' };
    return snapshot;
  }
}

module.exports = { WeeklyEvidenceService, tankPlayers, fantasyProsPlayers, findPlayer };
