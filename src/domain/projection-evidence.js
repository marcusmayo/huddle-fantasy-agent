'use strict';
// Persist the normalized calculation and source receipt, never the raw provider
// page or arbitrary fields attached to a player record.
function projectionDerivationSnapshot(input) {
  if (!input || input.method !== 'yahoo-season-known-deltas-v1') return undefined;
  const result = { method: input.method };
  for (const field of ['sourcePoints', 'estimatedPoints']) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) return undefined;
    result[field] = input[field];
  }
  for (const field of ['sourceSettingsHash', 'targetScoringFingerprint']) {
    if (!/^[a-f0-9]{64}$/.test(input[field] || '')) return undefined;
    result[field] = input[field];
  }
  if (!/^\d+$/.test(input.sourceLeagueId || '') || !Number.isFinite(Date.parse(input.observedAt))) return undefined;
  result.sourceLeagueId = String(input.sourceLeagueId);
  result.observedAt = new Date(input.observedAt).toISOString();
  result.unresolvedWeeklyTruncation = input.unresolvedWeeklyTruncation === true;
  if (!Array.isArray(input.adjustments) || input.adjustments.length > 33 || !Array.isArray(input.missing)) return undefined;
  result.adjustments = [];
  for (const item of input.adjustments) {
    if (typeof item.stat !== 'string' || !item.stat || item.stat.length > 100) return undefined;
    const row = { stat: item.stat };
    for (const field of ['sourceRule', 'targetRule', 'observed', 'delta']) {
      if (['observed', 'delta'].includes(field) && item[field] === null) row[field] = null;
      else if (typeof item[field] === 'number' && Number.isFinite(item[field])) row[field] = item[field];
      else return undefined;
    }
    result.adjustments.push(row);
  }
  result.missing = result.adjustments.filter(row => row.observed === null).map(row => row.stat);
  return result;
}
module.exports = { projectionDerivationSnapshot };
