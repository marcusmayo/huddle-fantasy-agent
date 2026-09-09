'use strict';

const crypto = require('node:crypto');
const { extractPlayers } = require('../providers/yahoo-weekly-normalizer');
const { qualifyYahooPlayerKey } = require('../providers/yahoo');
const { normalizeTeam } = require('../domain/player-snapshot');
const { scoringFingerprint } = require('../domain/league-projections');
const { ensureDraftProjections, yahooId } = require('./player-evidence');
const { publishPlayerPool } = require('./player-pool-store');
const { mergedHealthFields } = require('../domain/draft-health');

function scope(entry) {
  return JSON.stringify([entry.yahooLeagueKey, entry.yahooTeamKey, entry.config.provenance?.season,
    entry.config.teamCount, entry.config.roster, scoringFingerprint(entry.config)]);
}

function coverageStatus(runtime, entry, now = new Date()) {
  const report = runtime.playerPool.yahooDraftCoverage?.[entry.id];
  const age = report ? now.getTime() - Date.parse(report.observedAt) : Infinity;
  const maximumAge = Math.min(36, Number(runtime.operationsMaximumEvidenceAgeHours) || 36) * 3600000;
  const ids = report?.candidateYahooIds || [], rows = new Map();
  for (const player of runtime.playerPool.players || []) {
    const id = yahooId(player); if (id) rows.set(id, [...(rows.get(id) || []), player]);
  }
  const currentlyMapped = ids.filter(id => rows.get(id)?.length === 1
    && rows.get(id)[0].position === report?.candidatePositions?.[id]).length;
  const valid = Boolean(report?.schemaVersion === 1 && report.scope === scope(entry)
    && Number(report.season) === Number(entry.config.provenance?.season || runtime.season) && age >= 0 && age < maximumAge
    && ids.length > 0 && new Set(ids).size === ids.length && ids.length === report.observedPlayers
    && currentlyMapped === ids.length && report.stopReason !== 'repeated-page');
  return { ...(report || {}), currentlyMapped, valid, ageHours: Number.isFinite(age) ? Math.round(age / 360000) / 10 : null,
    reason: !report ? 'Yahoo candidate window has not been checked' : !valid ? 'Yahoo candidate window is expired, changed or incomplete' : null };
}

function persistPool(runtime, next = runtime.playerPool) {
  publishPlayerPool(runtime, next);
  return Boolean(runtime.playerSnapshotFile);
}

async function refreshYahooDraftEvidence({ runtime, entry, client, now = () => new Date() }) {
  if (typeof client.availablePlayers !== 'function') throw Object.assign(new Error('Yahoo candidate reads are unavailable'), { code: 'YAHOO_CANDIDATES_UNAVAILABLE' });
  const requestedScope = scope(entry), leagueKey = entry.yahooLeagueKey, season = entry.config.provenance?.season || runtime.season;
  const maximum = Math.max(25, Math.min(1000, Number(runtime.yahooDraftMaximumCandidates) || 500));
  const pageSize = Math.min(25, maximum);
  const observed = new Map();
  let start = 0;
  let pages = 0;
  let stopReason = 'window-limit';
  // An empty page establishes exhaustion. A short page may be a server-side
  // cap, so advancing uses the received count, never the requested count.
  while (start < maximum) {
    const payload = await client.availablePlayers(leagueKey, {
      start, count: Math.min(pageSize, maximum - start), status: 'A', sort: 'OR', season
    });
    pages++;
    const rows = extractPlayers(payload, { available: true });
    if (!rows.length) { stopReason = 'exhausted'; break; }
    let newIds = 0;
    for (const candidate of rows) {
      const key = qualifyYahooPlayerKey(candidate.yahooPlayerKey, leagueKey);
      if (!key || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(candidate.position)) continue;
      const id = yahooId({ yahooPlayerKey: key });
      if (!observed.has(id)) newIds++;
      observed.set(id, { ...candidate, yahooPlayerKey: key, windowOrder: start + rows.indexOf(candidate) + 1 });
    }
    start += rows.length;
    if (!newIds) { stopReason = 'repeated-page'; break; }
  }
  if (!observed.size) throw Object.assign(new Error('Yahoo returned no usable candidates; the old window is not certified'), { code: 'YAHOO_CANDIDATES_EMPTY' });
  if (stopReason === 'repeated-page') throw Object.assign(new Error('Yahoo repeated a candidate page; coverage is not verified'), { code: 'YAHOO_CANDIDATES_REPEATED_PAGE' });
  if (scope(entry) !== requestedScope || (entry.config.provenance?.season || runtime.season) !== season) {
    throw Object.assign(new Error('League settings changed during the Yahoo candidate read; refresh the new scope'), { code: 'YAHOO_CANDIDATE_SCOPE_CHANGED' });
  }

  const observedAt = now().toISOString();
  const original = runtime.playerPool;
  const players = structuredClone(original.players || []);
  const byYahooId = new Map();
  for (const player of players) {
    const id = yahooId(player);
    if (!id) continue;
    if (byYahooId.has(id)) throw Object.assign(new Error(`Conflicting loaded Yahoo player ID ${id}`), { code: 'YAHOO_CANDIDATE_ID_CONFLICT' });
    byYahooId.set(id, player);
  }
  const conflicts = [];
  let added = 0;
  let enriched = 0;
  for (const [id, candidate] of observed) {
    let player = byYahooId.get(id);
    if (player && player.position !== candidate.position) {
      throw Object.assign(new Error(`Yahoo position conflicts for player ID ${id}`), { code: 'YAHOO_CANDIDATE_POSITION_CONFLICT' });
    }
    if (!player) {
      player = { id: `yahoo:${candidate.yahooPlayerKey}`, yahooPlayerKey: candidate.yahooPlayerKey, name: candidate.name,
        position: candidate.position, team: 'FA', expertRank: null, adp: null, tier: 99, risk: .4,
        projectedPoints: null, projectionSource: 'missing', evidenceRole: 'yahoo-candidate-window', sourceConsensus: .05 };
      players.push(player); byYahooId.set(id, player); added++;
    } else enriched++;
    const team = normalizeTeam(candidate.nflTeam);
    if (team && normalizeTeam(player.team) && normalizeTeam(player.team) !== team) conflicts.push({ yahooPlayerId: id, field: 'team', old: player.team, observed: team, resolvedBy: 'current-yahoo-observation' });
    if (team) { player.team = team; player.teamSource = 'yahoo-candidate-window'; player.teamObservedAt = observedAt; }
    if (Number.isInteger(candidate.byeWeek) && candidate.byeWeek >= 1 && candidate.byeWeek <= 18) {
      player.byeWeek = candidate.byeWeek; player.byeSource = 'yahoo-candidate-window'; player.byeObservedAt = observedAt;
    }
    if (candidate.injuryStatusKnown) Object.assign(player, mergedHealthFields([player, {
      injuryStatus: candidate.injuryStatus, injurySource: 'yahoo-current-designation', injuryObservedAt: observedAt,
      injurySeason: Number(season)
    }], { season: Number(season), now: new Date(observedAt) }));
    player.yahooPlayerKey = candidate.yahooPlayerKey;
    player.yahooObservedOrder = candidate.windowOrder;
    // A bare projected total may be weekly or use a different scoring basis.
    // Preserve it separately; never blend it silently into season projections.
    if (candidate.projectedPoints != null) player.yahooObservedProjection = {
      value: candidate.projectedPoints, period: 'unverified', leagueKey: entry.yahooLeagueKey, observedAt
    };
    player.yahooEvidenceObservedAt = observedAt;
    player.yahooEvidenceSeason = entry.config.provenance?.season || runtime.season;
  }
  const completed = ensureDraftProjections(players);
  const candidateIds = [...observed.keys()];
  const loaded = new Set(completed.players.map(yahooId).filter(Boolean));
  const mapped = candidateIds.filter(id => loaded.has(id)).length;
  const report = {
    schemaVersion: 1,
    scope: scope(entry), leagueKey: entry.yahooLeagueKey, season: entry.config.provenance?.season || runtime.season,
    observedAt, observedPlayers: observed.size, mappedPlayers: mapped, added, enriched, pages, maximumCandidates: maximum,
    sort: 'Yahoo overall rank', stopReason, entireAvailableUniverseRead: stopReason === 'exhausted',
    candidateYahooIds: candidateIds, conflicts,
    candidatePositions: Object.fromEntries([...observed].map(([id, candidate]) => [id, candidate.position])),
    coverageMeaning: 'Mapping of the observed Yahoo candidate window; not a claim about all NFL players or projection quality.',
    revision: crypto.createHash('sha256').update(JSON.stringify([...observed.values()])).digest('hex')
  };
  const next = { ...original, players: completed.players,
    source: String(original.source || 'player-evidence').split('+').includes('yahoo') ? original.source : `${original.source || 'player-evidence'}+yahoo`,
    yahooDraftCoverage: { ...original.yahooDraftCoverage, [entry.id]: report },
    projectionCoverage: completed.coverage };
  // Persist before publishing the new in-memory view, so a failed save cannot
  // certify a pool that will disappear on restart.
  publishPlayerPool(runtime, next);
  return { ...report, candidateYahooIds: undefined, normalizedEvidencePersisted: Boolean(runtime.playerSnapshotFile), rawPayloadPersisted: false };
}

module.exports = { coverageStatus, refreshYahooDraftEvidence, persistPool };
