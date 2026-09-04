'use strict';

const SOURCE_WEIGHTS = Object.freeze({ fantasyPros: 0.675, tank01: 0.325 });
const SUPPORTED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const NFL_DEFENSE_LIMIT = 32;
const POSITION_PROJECTION_BASELINES = Object.freeze({
  QB: 320,
  RB: 235,
  WR: 220,
  TE: 165,
  K: 135,
  DEF: 125
});

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizePosition(value) {
  const position = String(value || '').toUpperCase();
  return position === 'DST' || position === 'D/ST' ? 'DEF' : position;
}

function positiveNumber(value) {
  const number = value === null || value === undefined || value === '' ? Number.NaN : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function yahooId(player) {
  const explicit = player?.yahooId;
  if (explicit !== undefined && explicit !== null && explicit !== '') return String(explicit);
  const key = String(player?.yahooPlayerKey || '');
  if (!key) return null;
  return key.includes('.p.') ? key.split('.p.').at(-1) : key;
}

function identityKey(player) {
  return `${normalizeName(player?.name)}|${normalizePosition(player?.position)}`;
}

function evidenceIndex(rows = []) {
  const byYahooId = new Map();
  const byIdentity = new Map();
  const byName = new Map();
  const ambiguousYahooIds = new Set();
  const ambiguousIdentities = new Set();
  const yahooIdCounts = new Map();
  const identityCounts = new Map();
  for (const row of rows) {
    const id = yahooId(row);
    const key = identityKey(row);
    if (id) yahooIdCounts.set(id, (yahooIdCounts.get(id) || 0) + 1);
    if (!key.startsWith('|')) identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
  }
  for (const [id, count] of yahooIdCounts) if (count > 1) ambiguousYahooIds.add(id);
  for (const [key, count] of identityCounts) if (count > 1) ambiguousIdentities.add(key);
  for (const row of rows) {
    const id = yahooId(row);
    const key = identityKey(row);
    if ((id && ambiguousYahooIds.has(id)) || ambiguousIdentities.has(key)) continue;
    if (id) byYahooId.set(id, row);
    if (!key.startsWith('|')) byIdentity.set(key, row);
    const name = normalizeName(row.name);
    if (name) {
      const values = byName.get(name) || [];
      values.push(row);
      byName.set(name, values);
    }
  }
  return { byYahooId, byIdentity, byName, ambiguousYahooIds, ambiguousIdentities };
}

function matchEvidence(player, index) {
  const id = yahooId(player);
  if (id && index.byYahooId.has(id)) return index.byYahooId.get(id);
  const exact = index.byIdentity.get(identityKey(player));
  if (exact) return exact;
  const named = index.byName.get(normalizeName(player.name)) || [];
  return named.length === 1 ? named[0] : null;
}

function positionalScores(rows, rankOf) {
  const output = new Map();
  const groups = rows.reduce((result, row) => {
    const position = normalizePosition(row.position);
    if (position) (result[position] ||= []).push(row);
    return result;
  }, {});
  for (const group of Object.values(groups)) {
    const ranked = group.filter((row) => Number.isFinite(rankOf(row))).sort((a, b) => rankOf(a) - rankOf(b));
    ranked.forEach((row, index) => output.set(row, ranked.length === 1 ? 1 : 1 - index / (ranked.length - 1)));
  }
  return output;
}

function draftRank(player, fallback) {
  const value = Number(player?.expertRank ?? player?.adp);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function projectedFromNeighbors(player, index, group, known) {
  const rank = draftRank(player, index + 1);
  const before = [...known].reverse().find((item) => item.rank <= rank) || null;
  const after = known.find((item) => item.rank >= rank) || null;
  if (before && after && before !== after && after.rank !== before.rank) {
    const progress = (rank - before.rank) / (after.rank - before.rank);
    return before.points + (after.points - before.points) * progress;
  }
  if (before) return before.points * (0.985 ** Math.max(0, rank - before.rank));
  if (after) return after.points * (1.015 ** Math.max(0, after.rank - rank));
  const baseline = POSITION_PROJECTION_BASELINES[player.position] || 150;
  return baseline * (0.97 ** index);
}

function ensureDraftProjections(players = []) {
  const output = players.map((player) => ({ ...player }));
  const groups = output.reduce((result, player) => {
    if (SUPPORTED_POSITIONS.has(player.position)) (result[player.position] ||= []).push(player);
    return result;
  }, {});
  let imputed = 0;
  let provided = 0;
  for (const group of Object.values(groups)) {
    group.sort((left, right) => draftRank(left, Number.MAX_SAFE_INTEGER) - draftRank(right, Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name));
    const known = group.map((player, index) => ({
      player,
      rank: draftRank(player, index + 1),
      points: Number(player.projectedPoints)
    })).filter((item) => Number.isFinite(item.points) && item.points > 0);
    group.forEach((player, index) => {
      let projectedPoints = positiveNumber(player.projectedPoints);
      const hasProjection = projectedPoints != null;
      if (hasProjection) provided += 1;
      else {
        projectedPoints = Math.max(1, projectedFromNeighbors(player, index, group, known));
        imputed += 1;
      }
      const spread = Math.max(12, projectedPoints * 0.16);
      player.projectedPoints = Math.round(projectedPoints * 100) / 100;
      player.floor = finiteNumber(player.floor) ?? Math.max(0, Math.round((projectedPoints - spread) * 100) / 100);
      player.ceiling = finiteNumber(player.ceiling) ?? Math.round((projectedPoints + spread) * 100) / 100;
      player.projectionImputed = !hasProjection;
      if (!hasProjection) player.projectionSource = known.length ? 'rank-interpolation' : 'rank-baseline';
    });
  }
  return {
    players: output,
    coverage: {
      provided,
      imputed,
      total: output.length,
      providedRatio: output.length ? Math.round((provided / output.length) * 10_000) / 10_000 : 0
    }
  };
}

function buildSleeperDefenseDepthPlayers(existingPlayers, sleeperIdentityPlayers, sleeperPlayers = [], sleeper = {}) {
  const identityIndex = evidenceIndex(sleeperIdentityPlayers);
  const trendIndex = evidenceIndex(sleeperPlayers);
  const defenses = existingPlayers.filter((player) => normalizePosition(player.position) === 'DEF');
  const seenYahooIds = new Set(existingPlayers.map(yahooId).filter(Boolean));
  const seenIdentities = new Set(existingPlayers.map(identityKey).filter((key) => !key.startsWith('|')));
  const seenTeams = new Set(defenses.map((player) => String(player.team || '').toUpperCase()).filter((team) => team && team !== 'FA'));
  const output = [];
  const candidates = [...sleeperIdentityPlayers]
    .filter((player) => normalizePosition(player.position) === 'DEF')
    .sort((left, right) => String(left.team || '').localeCompare(String(right.team || '')) || String(left.name || '').localeCompare(String(right.name || '')));
  for (const candidate of candidates) {
    if (defenses.length + output.length >= NFL_DEFENSE_LIMIT) break;
    const id = yahooId(candidate);
    const identity = identityKey(candidate);
    const team = String(candidate.team || '').toUpperCase();
    if (!id || !/^\d+$/.test(id) || !/^[A-Z]{2,3}$/.test(team) || team === 'FA') continue;
    if (identityIndex.ambiguousYahooIds.has(id) || identityIndex.ambiguousIdentities.has(identity)) continue;
    if (seenYahooIds.has(id) || seenIdentities.has(identity) || seenTeams.has(team)) continue;
    const trend = matchEvidence(candidate, trendIndex);
    output.push({
      id: `sleeper:${candidate.sleeperId || id}`,
      name: String(candidate.name),
      position: 'DEF',
      team,
      yahooPlayerKey: id,
      expertRank: null,
      adp: null,
      tier: 99,
      byeWeek: null,
      injuryStatus: null,
      risk: 0.35,
      projectedPoints: null,
      projectionSource: 'missing',
      evidenceRole: 'sleeper-identity-depth-fallback',
      sourceConsensus: 0.1,
      sourceRanks: {
        fantasyPros: null,
        fantasyProsNormalized: null,
        tank01: null,
        tank01Normalized: null
      },
      tank01Projection: null,
      sourceDisagreementSlots: null,
      sourceDisagreement: false,
      sleeperTrend: trend ? {
        direction: trend.direction,
        adds: trend.adds,
        drops: trend.drops,
        net: trend.net,
        lookbackHours: sleeper.lookbackHours || 24,
        attribution: sleeper.attribution || 'Sleeper'
      } : null
    });
    seenYahooIds.add(id);
    seenIdentities.add(identity);
    seenTeams.add(team);
  }
  return output;
}

function reconcilePlayerEvidence(primaryPool, { tank01 = null, sleeper = null, errors = [] } = {}) {
  const primaryPlayers = primaryPool.players || [];
  const tankPlayers = tank01?.players || [];
  const sleeperPlayers = sleeper?.players || [];
  const sleeperIdentityPlayers = sleeper?.identityPlayers || sleeperPlayers;
  const tankIndex = evidenceIndex(tankPlayers);
  const sleeperIndex = evidenceIndex(sleeperPlayers);
  const sleeperIdentityIndex = evidenceIndex(sleeperIdentityPlayers);
  const primaryPositionScores = positionalScores(primaryPlayers, (player) => Number(player.expertRank ?? player.adp));
  const tankPositionScores = positionalScores(tankPlayers, (player) => Number(player.rank));
  let tankMatched = 0;
  let sleeperMatched = 0;
  let sleeperCrosswalkMatched = 0;
  const matchedTankRows = new Set();

  const primaryReconciled = primaryPlayers.map((player) => {
    const tankPlayer = matchEvidence(player, tankIndex);
    const sleeperPlayer = matchEvidence(player, sleeperIndex);
    const sleeperIdentity = matchEvidence(player, sleeperIdentityIndex);
    const fantasyProsNormalized = primaryPositionScores.get(player) ?? 0.5;
    const tank01Normalized = tankPlayer ? tankPositionScores.get(tankPlayer) ?? 0.5 : null;
    const sourceConsensus = tank01Normalized == null
      ? fantasyProsNormalized
      : fantasyProsNormalized * SOURCE_WEIGHTS.fantasyPros + tank01Normalized * SOURCE_WEIGHTS.tank01;
    if (tankPlayer) {
      tankMatched += 1;
      matchedTankRows.add(tankPlayer);
    }
    if (sleeperPlayer) sleeperMatched += 1;
    if (sleeperIdentity?.yahooId) sleeperCrosswalkMatched += 1;
    const primaryRank = Number(player.expertRank ?? player.adp);
    const secondaryRank = Number(tankPlayer?.rank);
    const disagreementSlots = Number.isFinite(primaryRank) && Number.isFinite(secondaryRank)
      ? Math.abs(primaryRank - secondaryRank)
      : null;
    return {
      ...player,
      yahooPlayerKey: player.yahooPlayerKey || (sleeperIdentity?.yahooId ? String(sleeperIdentity.yahooId) : null),
      sourceConsensus: Math.round(sourceConsensus * 1000) / 1000,
      sourceRanks: {
        fantasyPros: Number.isFinite(primaryRank) ? primaryRank : null,
        fantasyProsNormalized: Math.round(fantasyProsNormalized * 1000) / 1000,
        tank01: Number.isFinite(secondaryRank) ? secondaryRank : null,
        tank01Normalized: tank01Normalized == null ? null : Math.round(tank01Normalized * 1000) / 1000
      },
      tank01Projection: Number.isFinite(tankPlayer?.projectedPoints) ? tankPlayer.projectedPoints : null,
      sourceDisagreementSlots: disagreementSlots,
      sourceDisagreement: disagreementSlots != null && disagreementSlots >= 12,
      projectedPoints: positiveNumber(player.projectedPoints)
        ?? positiveNumber(tankPlayer?.projectedPoints),
      projectionSource: positiveNumber(player.projectedPoints) != null
        ? player.projectionSource || 'fantasypros-api'
        : positiveNumber(tankPlayer?.projectedPoints) != null ? 'tank01-api' : 'missing',
      sleeperTrend: sleeperPlayer ? {
        direction: sleeperPlayer.direction,
        adds: sleeperPlayer.adds,
        drops: sleeperPlayer.drops,
        net: sleeperPlayer.net,
        lookbackHours: sleeper?.lookbackHours || 24,
        attribution: sleeper.attribution || 'Sleeper'
      } : null
    };
  });

  // A limited FantasyPros projection response must not cap the identity or
  // reconciliation pool. Tank01 supplies late-round ADP candidates while the
  // cached Sleeper player map supplies their Yahoo identities. These rows are
  // explicitly marked as secondary fallback evidence.
  const seenYahooIds = new Set(primaryReconciled.map(yahooId).filter(Boolean));
  const fallbackPlayers = [];
  for (const tankPlayer of tankPlayers) {
    if (matchedTankRows.has(tankPlayer) || !SUPPORTED_POSITIONS.has(normalizePosition(tankPlayer.position))) continue;
    const sleeperIdentity = matchEvidence(tankPlayer, sleeperIdentityIndex);
    const fallbackYahooId = yahooId(sleeperIdentity);
    if (!fallbackYahooId || seenYahooIds.has(fallbackYahooId)) continue;
    const sleeperPlayer = matchEvidence(tankPlayer, sleeperIndex);
    const position = normalizePosition(tankPlayer.position);
    const rank = Number(tankPlayer.rank);
    fallbackPlayers.push({
      id: tankPlayer.tank01Id ? `tank01:${tankPlayer.tank01Id}` : `secondary:${identityKey(tankPlayer)}`,
      name: String(tankPlayer.name),
      position,
      team: String(tankPlayer.team || sleeperIdentity?.team || 'FA').toUpperCase(),
      yahooPlayerKey: fallbackYahooId,
      expertRank: null,
      adp: Number.isFinite(rank) ? rank : null,
      tier: 99,
      byeWeek: null,
      injuryStatus: null,
      risk: 0.3,
      projectedPoints: positiveNumber(tankPlayer.projectedPoints),
      projectionSource: positiveNumber(tankPlayer.projectedPoints) != null ? 'tank01-api' : 'missing',
      evidenceRole: 'secondary-fallback',
      sourceConsensus: tankPositionScores.get(tankPlayer) ?? 0.25,
      sourceRanks: {
        fantasyPros: null,
        fantasyProsNormalized: null,
        tank01: Number.isFinite(rank) ? rank : null,
        tank01Normalized: tankPositionScores.get(tankPlayer) ?? null
      },
      tank01Projection: positiveNumber(tankPlayer.projectedPoints),
      sourceDisagreementSlots: null,
      sourceDisagreement: false,
      sleeperTrend: sleeperPlayer ? {
        direction: sleeperPlayer.direction,
        adds: sleeperPlayer.adds,
        drops: sleeperPlayer.drops,
        net: sleeperPlayer.net,
        lookbackHours: sleeper?.lookbackHours || 24,
        attribution: sleeper.attribution || 'Sleeper'
      } : null
    });
    seenYahooIds.add(fallbackYahooId);
  }
  // FantasyPros can return only ten D/ST rows, which is insufficient for
  // leagues that start two defenses. The daily-cached Sleeper identity map can
  // safely supply the remaining current NFL team defenses and their numeric
  // Yahoo IDs. They remain explicitly unranked fallback evidence and receive
  // deterministic projections after every ranked/provider-backed defense.
  const sleeperDefenseDepthPlayers = buildSleeperDefenseDepthPlayers(
    [...primaryReconciled, ...fallbackPlayers],
    sleeperIdentityPlayers,
    sleeperPlayers,
    sleeper || {}
  );
  const completed = ensureDraftProjections([...primaryReconciled, ...fallbackPlayers, ...sleeperDefenseDepthPlayers]);
  const players = completed.players;

  const activeSources = ['fantasypros'];
  if (tankPlayers.length) activeSources.push('tank01');
  if (sleeperPlayers.length || sleeperCrosswalkMatched || sleeperDefenseDepthPlayers.length) activeSources.push('sleeper');
  const warnings = [
    ['tank01', tankIndex],
    ['sleeper', sleeperIndex],
    ['sleeper-crosswalk', sleeperIdentityIndex]
  ].flatMap(([provider, index]) => {
    const ambiguousYahooIds = [...index.ambiguousYahooIds].sort();
    const ambiguousIdentities = [...index.ambiguousIdentities].sort();
    if (!ambiguousYahooIds.length && !ambiguousIdentities.length) return [];
    return [{
      provider,
      code: 'AMBIGUOUS_PLAYER_EVIDENCE',
      message: `${provider} evidence contains duplicate player identities; ambiguous rows were excluded`,
      ambiguousYahooIds,
      ambiguousIdentities
    }];
  });
  return {
    ...primaryPool,
    source: activeSources.join('+'),
    players,
    sourceEvidence: {
      algorithm: 'reconciled-sources-v1',
      configuredWeights: SOURCE_WEIGHTS,
      effectiveWeights: tankPlayers.length ? SOURCE_WEIGHTS : { fantasyPros: 1, tank01: 0 },
      sleeperRole: 'market tie-breaker only',
      yahooRole: 'league scoring and player availability are authoritative filters',
      coverage: {
        primaryPlayers: primaryPlayers.length,
        totalPlayers: players.length,
        tank01Matched: tankMatched,
        secondaryFallbackPlayers: fallbackPlayers.length,
        sleeperDefenseDepthPlayers: sleeperDefenseDepthPlayers.length,
        sleeperMatched,
        sleeperCrosswalkMatched,
        ambiguousTank01: tankIndex.ambiguousYahooIds.size + tankIndex.ambiguousIdentities.size,
        ambiguousSleeper: sleeperIndex.ambiguousYahooIds.size + sleeperIndex.ambiguousIdentities.size
      },
      fetchedAt: {
        fantasyPros: primaryPool.fetchedAt || null,
        tank01: tank01?.fetchedAt || null,
        sleeper: sleeper?.fetchedAt || null
      },
      projectionCoverage: completed.coverage,
      warnings,
      errors: errors.map((error) => ({
        provider: error.provider,
        code: error.code || null,
        message: String(error.message || error)
      }))
    }
  };
}

module.exports = {
  SOURCE_WEIGHTS,
  buildSleeperDefenseDepthPlayers,
  evidenceIndex,
  identityKey,
  matchEvidence,
  normalizeName,
  positionalScores,
  ensureDraftProjections,
  reconcilePlayerEvidence,
  yahooId
};
