'use strict';
const { JsonStateStore } = require('../storage/json-state-store');
const { yahooId, ensureDraftProjections } = require('./player-evidence');
const { normalizeTeam } = require('../domain/player-snapshot');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const numberId = player => /^\d+$/.test(yahooId(player) || '') ? yahooId(player) : null;
const yahooFields = ['yahooPlayerKey', 'yahooEvidenceObservedAt', 'yahooEvidenceSeason', 'yahooObservedOrder',
  'yahooObservedProjection', 'team', 'teamSource', 'teamObservedAt', 'byeWeek', 'byeSource', 'byeObservedAt'];
const injuryFields = ['injuryStatus', 'injurySource', 'injuryObservedAt'];

// Save the complete next view before publishing it to services that share the
// existing object. Serialization makes disk and memory the same normalized view.
function publishPlayerPool(runtime, next) {
  const normalized = JSON.parse(JSON.stringify({ ...next, evidenceSchemaVersion: 1 }));
  if (runtime.playerSnapshotFile) new JsonStateStore(runtime.playerSnapshotFile).save(normalized);
  for (const key of Object.keys(runtime.playerPool)) if (!(key in normalized)) delete runtime.playerPool[key];
  Object.assign(runtime.playerPool, normalized);
  return runtime.playerPool;
}

function indexPlayers(players) {
  const byId = new Map(), byYahoo = new Map();
  for (const player of players) {
    if (!player.id || byId.has(player.id)) fail('PLAYER_POOL_ID_CONFLICT', 'Player evidence contains a missing or duplicate local identity');
    byId.set(player.id, player);
    const numeric = numberId(player);
    if (numeric && byYahoo.has(numeric)) fail('PLAYER_POOL_ID_CONFLICT', `Player evidence contains duplicate Yahoo ID ${numeric}`);
    if (numeric) byYahoo.set(numeric, player);
  }
  return { byId, byYahoo };
}

// A new ranking-provider response must not delete the separately observed Yahoo
// universe. Join by numeric Yahoo ID or an unchanged local ID, never by name.
function mergeProviderPool(runtime, incoming) {
  const season = Number(incoming.season), expectedSeason = Number(runtime.season);
  if (!Number.isInteger(season) || season !== expectedSeason) fail('PLAYER_POOL_SEASON_MISMATCH', 'Player refresh does not match the configured season');
  const current = runtime.playerPool, old = indexPlayers(current.players || []);
  indexPlayers(incoming.players || []);
  const reports = Object.fromEntries(Object.entries(current.yahooDraftCoverage || {}).filter(([, report]) => Number(report.season) === season));
  const reportIds = new Set(Object.values(reports).flatMap(report => report.candidateYahooIds || []));
  const hasYahooEvidence = player => Number(player.yahooEvidenceSeason) === season
    || (player.yahooEvidenceSeason == null && reportIds.has(numberId(player)));
  const retained = new Set();
  const players = (incoming.players || []).map(row => {
    const prior = old.byYahoo.get(numberId(row)) || old.byId.get(row.id);
    if (!prior) return { ...row };
    if (prior.position !== row.position || (numberId(prior) && numberId(row) && numberId(prior) !== numberId(row))) {
      fail('PLAYER_POOL_ID_CONFLICT', 'A refreshed identity conflicts with its previously observed player');
    }
    if (!hasYahooEvidence(prior)) return { ...row };
    retained.add(prior.id);
    const merged = { ...row, id: prior.id };
    for (const field of yahooFields) {
      if (field === 'team' && !normalizeTeam(prior.team)) continue;
      if (['byeWeek', 'byeSource', 'byeObservedAt'].includes(field) && !(Number.isInteger(prior.byeWeek) && prior.byeWeek >= 1 && prior.byeWeek <= 18)) continue;
      if (prior[field] !== undefined) merged[field] = structuredClone(prior[field]);
    }
    // A genuinely newer, dated injury observation wins; provider refresh time
    // alone is not an injury-news timestamp.
    const incomingInjuryAt = Date.parse(row.injuryObservedAt), priorInjuryAt = Date.parse(prior.injuryObservedAt);
    if (!Number.isFinite(incomingInjuryAt) || (Number.isFinite(priorInjuryAt) && incomingInjuryAt <= priorInjuryAt)) {
      for (const field of injuryFields) if (prior[field] !== undefined) merged[field] = prior[field];
    }
    return merged;
  });
  let carried = 0;
  for (const prior of current.players || []) {
    if (retained.has(prior.id) || !hasYahooEvidence(prior)) continue;
    // Keep Yahoo identities and sourced details. Re-estimate missing ranking
    // values against the new pool instead of relabelling old totals as fresh.
    const player = { id: prior.id, name: prior.name, position: prior.position, expertRank: null, adp: null,
      tier: 99, risk: .4, projectedPoints: null, floor: null, ceiling: null,
      projectionSource: 'missing', sourceConsensus: .05, evidenceRole: 'yahoo-retained-candidate' };
    for (const field of [...yahooFields, ...injuryFields]) if (prior[field] !== undefined) player[field] = structuredClone(prior[field]);
    players.push(player); carried++;
  }
  indexPlayers(players);
  const completed = ensureDraftProjections(players);
  const yahooCount = completed.players.filter(hasYahooEvidence).length;
  const source = String(incoming.source || 'player-evidence');
  return { ...incoming, players: completed.players, complete: Boolean(incoming.complete && !completed.coverage.imputed),
    source: yahooCount && !source.split('+').includes('yahoo') ? `${source}+yahoo` : source,
    yahooDraftCoverage: reports, projectionCoverage: completed.coverage,
    sourceEvidence: { ...incoming.sourceEvidence,
      coverage: { ...incoming.sourceEvidence?.coverage, totalPlayers: completed.players.length, retainedYahooCandidates: carried },
      fetchedAt: { ...incoming.sourceEvidence?.fetchedAt, yahoo: current.sourceEvidence?.fetchedAt?.yahoo || null },
      projectionCoverage: completed.coverage } };
}

module.exports = { publishPlayerPool, mergeProviderPool };
