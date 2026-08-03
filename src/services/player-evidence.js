'use strict';

const SOURCE_WEIGHTS = Object.freeze({ fantasyPros: 0.675, tank01: 0.325 });

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

function yahooId(player) {
  const explicit = player?.yahooId;
  if (explicit !== undefined && explicit !== null && explicit !== '') return String(explicit);
  const key = String(player?.yahooPlayerKey || '');
  return key.includes('.p.') ? key.split('.p.').at(-1) : null;
}

function identityKey(player) {
  return `${normalizeName(player?.name)}|${normalizePosition(player?.position)}`;
}

function evidenceIndex(rows = []) {
  const byYahooId = new Map();
  const byIdentity = new Map();
  const byName = new Map();
  for (const row of rows) {
    const id = yahooId(row);
    if (id) byYahooId.set(id, row);
    const key = identityKey(row);
    if (!key.startsWith('|')) byIdentity.set(key, row);
    const name = normalizeName(row.name);
    if (name) {
      const values = byName.get(name) || [];
      values.push(row);
      byName.set(name, values);
    }
  }
  return { byYahooId, byIdentity, byName };
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

function reconcilePlayerEvidence(primaryPool, { tank01 = null, sleeper = null, errors = [] } = {}) {
  const primaryPlayers = primaryPool.players || [];
  const tankPlayers = tank01?.players || [];
  const sleeperPlayers = sleeper?.players || [];
  const tankIndex = evidenceIndex(tankPlayers);
  const sleeperIndex = evidenceIndex(sleeperPlayers);
  const primaryPositionScores = positionalScores(primaryPlayers, (player) => Number(player.expertRank ?? player.adp));
  const tankPositionScores = positionalScores(tankPlayers, (player) => Number(player.rank));
  let tankMatched = 0;
  let sleeperMatched = 0;

  const players = primaryPlayers.map((player) => {
    const tankPlayer = matchEvidence(player, tankIndex);
    const sleeperPlayer = matchEvidence(player, sleeperIndex);
    const fantasyProsNormalized = primaryPositionScores.get(player) ?? 0.5;
    const tank01Normalized = tankPlayer ? tankPositionScores.get(tankPlayer) ?? 0.5 : null;
    const sourceConsensus = tank01Normalized == null
      ? fantasyProsNormalized
      : fantasyProsNormalized * SOURCE_WEIGHTS.fantasyPros + tank01Normalized * SOURCE_WEIGHTS.tank01;
    if (tankPlayer) tankMatched += 1;
    if (sleeperPlayer) sleeperMatched += 1;
    const primaryRank = Number(player.expertRank ?? player.adp);
    const secondaryRank = Number(tankPlayer?.rank);
    const disagreementSlots = Number.isFinite(primaryRank) && Number.isFinite(secondaryRank)
      ? Math.abs(primaryRank - secondaryRank)
      : null;
    return {
      ...player,
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

  const activeSources = ['fantasypros'];
  if (tankPlayers.length) activeSources.push('tank01');
  if (sleeperPlayers.length) activeSources.push('sleeper');
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
        tank01Matched: tankMatched,
        sleeperMatched
      },
      fetchedAt: {
        fantasyPros: primaryPool.fetchedAt || null,
        tank01: tank01?.fetchedAt || null,
        sleeper: sleeper?.fetchedAt || null
      },
      errors: errors.map((error) => ({ provider: error.provider, message: String(error.message || error) }))
    }
  };
}

module.exports = {
  SOURCE_WEIGHTS,
  evidenceIndex,
  identityKey,
  matchEvidence,
  normalizeName,
  positionalScores,
  reconcilePlayerEvidence,
  yahooId
};
