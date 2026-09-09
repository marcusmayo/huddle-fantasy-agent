'use strict';

const POLICY = 'dated-designation-v1';
const MAX_AGE_MS = 36 * 3600000;
const penalties = { IR: .35, OUT: .35, PUP: .35, NFI: .35, SUSP: .35, D: .22, Q: .08, NONE: 0 };
const clean = (value, limit = 120) => String(value ?? '').trim().slice(0, limit);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function designation(value) {
  const text = clean(value, 32).toUpperCase();
  return ({ '': 'NONE', O: 'OUT', QUESTIONABLE: 'Q', DOUBTFUL: 'D', SUSPENDED: 'SUSP', HEALTHY: 'NONE', 'NO DESIGNATION': 'NONE' })[text] || text;
}
function observation(raw, season) {
  if (!raw || !['designation', 'practice', 'role'].includes(raw.kind) || raw.value == null) return null;
  if (Number(raw.season) !== Number(season)) return null;
  const value = raw.kind === 'designation' ? designation(raw.value) : clean(raw.value);
  if (!value) return null;
  let url = null;
  try { const parsed = new URL(raw.url); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.origin + parsed.pathname; } catch {}
  return { kind: raw.kind, value, season: Number(season), source: clean(raw.source) || null,
    invalidDate: Boolean(raw.invalidDate || (raw.publishedAt != null && !iso(raw.publishedAt)) || (raw.observedAt != null && !iso(raw.observedAt))),
    publishedAt: iso(raw.publishedAt), observedAt: iso(raw.observedAt), url, summary: clean(raw.summary, 500) || null };
}
const effectiveAt = item => { const value = Date.parse(item.publishedAt || item.observedAt); return Number.isFinite(value) ? value : -Infinity; };
const usableAt = (item, clock) => !item.invalidDate && (item.observedAt == null || Date.parse(item.observedAt) <= clock + 1000)
  && (item.publishedAt == null || Date.parse(item.publishedAt) <= clock + 1000)
  && !(item.publishedAt && item.observedAt && Date.parse(item.publishedAt) > Date.parse(item.observedAt) + 1000);
function compare(a, b) {
  return effectiveAt(b) - effectiveAt(a) || (penalties[b.value] || 0) - (penalties[a.value] || 0)
    || String(a.source).localeCompare(String(b.source)) || a.value.localeCompare(b.value);
}

function observations(player, season) {
  const raw = Array.isArray(player?.draftHealth?.observations) ? [...player.draftHealth.observations] : [];
  if (player?.injuryStatus != null && player.injuryStatusKnown !== false) raw.push({ kind: 'designation', value: player.injuryStatus,
    source: player.injurySource, publishedAt: player.injuryUpdatedAt, observedAt: player.injuryObservedAt,
    season: player.injurySeason ?? player.yahooEvidenceSeason ?? season });
  return raw.map(item => observation(item, season)).filter(Boolean);
}

function mergeDraftHealth(players, { season, now = new Date() } = {}) {
  const unique = new Map();
  const clock = new Date(now).getTime();
  for (const player of players.filter(Boolean)) for (const item of observations(player, season)) {
    // Refetching an article preserves its publication date. A current designation
    // without a report date is a dated observation, not a newly published story.
    const key = JSON.stringify([item.kind, item.source, item.publishedAt || item.observedAt, item.value, item.url, item.summary]);
    const prior = unique.get(key);
    const later = Number.isFinite(Date.parse(item.observedAt)) && (!prior?.observedAt || Date.parse(item.observedAt) > Date.parse(prior.observedAt));
    if (!prior || (usableAt(item, clock) && (!usableAt(prior, clock) || later))) unique.set(key, item);
  }
  const all = [...unique.values()].sort(compare);
  // Retain each evidence kind independently so frequent designation reads do not erase a role review.
  return { schemaVersion: 1, season: Number(season), observations: ['designation', 'practice', 'role']
    .flatMap(kind => all.filter(item => item.kind === kind).slice(0, 12)) };
}

function reviewDraftHealth(player, { season, now = new Date() } = {}) {
  const clock = new Date(now).getTime();
  const all = observations(player, season);
  const eligible = item => usableAt(item, clock);
  const latest = kind => all.filter(item => item.kind === kind && eligible(item)).sort(compare)[0] || null;
  const current = latest('designation'), practice = latest('practice'), role = latest('role');
  const fresh = item => Boolean(item?.source && item.observedAt && Number.isFinite(effectiveAt(item)) && clock - effectiveAt(item) <= MAX_AGE_MS
    && (item.kind === 'designation' || item.publishedAt));
  const conflicting = Boolean(current && all.some(item => item.kind === 'designation' && eligible(item)
    && effectiveAt(item) === effectiveAt(current) && item.value !== current.value));
  const known = Boolean(current && Object.hasOwn(penalties, current.value));
  const state = !known ? 'unknown' : conflicting ? 'conflicting' : fresh(current) ? 'current' : 'stale-or-undated';
  const designationLabel = !current ? 'Designation unknown' : current.value === 'NONE' ? 'No designation reported' : current.value;
  return { policy: POLICY, designation: current, practice, role, state, reviewRequired: state !== 'current',
    practiceCurrent: fresh(practice), roleCurrent: fresh(role), conflicting,
    penalty: current ? penalties[current.value] || 0 : 0,
    label: `${designationLabel} · ${state === 'current' ? 'dated evidence' : 'review needed'}`,
    summary: `${designationLabel}; ${state === 'current' ? 'dated designation' : 'designation needs review'}. Practice: ${fresh(practice) ? practice.value : 'unverified'}. Role: ${fresh(role) ? role.value : 'unverified'}.`,
    limitation: 'Designation penalty is an uncalibrated draft heuristic. Practice and role reports are retained separately; they do not prove availability or automatically change season projections.' };
}

function mergedHealthFields(players, { season, now = new Date() } = {}) {
  const draftHealth = mergeDraftHealth(players, { season, now });
  const current = reviewDraftHealth({ draftHealth }, { season, now }).designation;
  return { draftHealth, ...(current ? { injuryStatus: current.value === 'NONE' ? '' : current.value, injuryStatusKnown: true,
    injurySource: current.source, injuryUpdatedAt: current.publishedAt, injuryObservedAt: current.observedAt, injurySeason: Number(season) } : {}) };
}

function validateHealthObservations(input, { season, now = new Date() }) {
  const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_HEALTH_REVIEW' }); };
  if (!Array.isArray(input) || input.length < 1 || input.length > 12) invalid('Supply one to twelve sourced designation, practice or role observations');
  return input.map(raw => {
    const value = observation(raw, season), clock = new Date(now).getTime();
    if (!value || value.invalidDate || !value.source || !value.observedAt || Date.parse(value.observedAt) > clock + 1000
      || (value.publishedAt && Date.parse(value.publishedAt) > Date.parse(value.observedAt) + 1000)) invalid('Each observation needs the matching season, source and valid nonfuture dates');
    if (value.kind !== 'designation' && (!value.publishedAt || !value.url)) invalid('Practice and role reports need a publication date and public source URL');
    if (value.kind === 'designation' && !Object.hasOwn(penalties, value.value)) invalid('Use an explicit supported designation; missing status is unknown');
    return value;
  });
}

module.exports = { POLICY, MAX_AGE_MS, designation, mergeDraftHealth, mergedHealthFields, reviewDraftHealth, validateHealthObservations };
