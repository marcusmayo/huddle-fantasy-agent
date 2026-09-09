'use strict';
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { draftedRosterSize, pickOwner, nextUserPick } = require('../../src/domain/league');
const { scoringFingerprint } = require('../../src/domain/league-projections');
const { optimizeLineup } = require('../../src/domain/weekly-management');
const { noise } = require('./fixtures');
const manifest = require('./manifest.json');
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = players => players.reduce((result, player) => { result[player.position] = (result[player.position] || 0) + 1; return result; }, {});
const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const round = value => Math.round(value * 1000) / 1000;

function validateFixture(fixture) {
  const { league, basis, players } = fixture || {};
  const fail = message => { throw new Error(`Incomparable benchmark input: ${message}`); };
  if (!league || !basis || !Array.isArray(players) || !['synthetic', 'sourced'].includes(fixture.kind)) fail('league, basis, kind and players required');
  if (league.teamCount !== 6 || !Number.isInteger(fixture.seed)) fail('six-team room and integer scenario seed required');
  if (basis.period !== 'season' || !Number.isInteger(basis.season) || !basis.source || !basis.version
    || !Number.isFinite(Date.parse(basis.observedAt)) || basis.scoringFingerprint !== scoringFingerprint(league)) fail('one dated season/scoring/source version required');
  if (!fixture.adpBasis?.source || !fixture.adpBasis?.format || !Number.isFinite(Date.parse(fixture.adpBasis.observedAt))) fail('ADP source, format and observation date required');
  const ids = new Set(), yahooIds = new Set();
  for (const player of players) {
    const yahooId = String(player.yahooPlayerKey || '').split('.p.').at(-1);
    if (!player.id || ids.has(player.id) || !/^[1-9]\d*$/.test(yahooId) || yahooIds.has(yahooId) || !POSITIONS.includes(player.position)) fail('unique local/numeric identities and supported positions required');
    ids.add(player.id); yahooIds.add(yahooId);
    if (!Number.isFinite(player.projectedPoints) || player.projectedPoints <= 0 || !Number.isFinite(player.adp) || player.adp <= 0) fail(`finite positive value and ADP required for ${player.id}`);
    if (!Number.isInteger(player.byeWeek) || player.byeWeek < 1 || player.byeWeek > 18) fail(`bye is unknown for ${player.id}`);
    if (player.projectionScoringVerified !== true || player.projectionLeagueId !== league.id || player.projectionImputed === true
      || player.projectionScoringFingerprint !== basis.scoringFingerprint || player.projectionSeason !== basis.season
      || player.projectionPeriod !== basis.period || digest(player.projectionBasis) !== digest(basis)) fail(`mixed or estimated projection basis for ${player.id}`);
  }
  if (players.length < draftedRosterSize(league.roster) * league.teamCount) fail('pool cannot fill the room');
  return digest(fixture);
}
function stateFor(fixture, seat) {
  return { league: fixture.league, players: fixture.players, available: fixture.players, picks: [],
    teams: Array.from({ length: fixture.league.teamCount }, () => []), seat, now: fixture.basis.observedAt };
}
function legalChoices(state, seat, baseline) {
  const mine = count(state.teams[seat - 1]), availableByPosition = count(state.available);
  const allowed = new Set(POSITIONS.filter(position => baseline.assessRosterConstraint({ position }, mine, state.league, { availableByPosition }).feasible));
  return state.available.filter(player => allowed.has(player.position));
}
function advance(state, player, baseline) {
  const overallPick = state.picks.length + 1, seat = pickOwner(overallPick, state.league.teamCount);
  if (!player || !legalChoices(state, seat, baseline).some(row => row.id === player.id)) throw new Error(`Illegal or unavailable choice at ${overallPick}`);
  const teams = [...state.teams]; teams[seat - 1] = [...teams[seat - 1], player];
  return { ...state, teams, available: state.available.filter(row => row.id !== player.id),
    picks: [...state.picks, { ...player, playerId: player.id, overallPick, isMine: seat === state.seat }] };
}
function nextTurn(state) {
  const overall = nextUserPick(state.picks.length + 1, state.league.teamCount, state.seat, false);
  return overall <= draftedRosterSize(state.league.roster) * state.league.teamCount ? overall : null;
}
function opponentChoice(state, baseline, behavior, seed, forecast = false) {
  const overall = state.picks.length + 1, seat = pickOwner(overall, state.league.teamCount);
  const choices = legalChoices(state, seat, baseline), mine = count(state.teams[seat - 1]);
  const filledBefore = baseline.maximumStarterAssignments(mine, state.league.roster);
  const fillsByPosition = Object.fromEntries(POSITIONS.map(position => [position,
    baseline.maximumStarterAssignments({ ...mine, [position]: (mine[position] || 0) + 1 }, state.league.roster) > filledBefore]));
  const score = player => {
    const fills = fillsByPosition[player.position];
    const jitter = forecast ? 0 : (noise(seed, behavior, overall, seat, player.id) - .5) * 24;
    let value = -player.adp + jitter;
    if (behavior === 'balanced') value += fills ? 32 : -18;
    if (behavior === 'qb-run' && player.position === 'QB' && (mine.QB || 0) < Number(state.league.roster.QB || 0)
      && overall >= state.league.teamCount * 2) value += 95;
    return value;
  };
  return choices.map(player => ({ player, value: score(player) })).sort((a, b) => b.value - a.value || a.player.id.localeCompare(b.player.id))[0]?.player;
}
function shortlist(choices, extra = []) {
  const selected = new Map(extra.filter(Boolean).map(player => [player.id, player]));
  for (const position of POSITIONS) {
    const group = choices.filter(player => player.position === position);
    const byPoints = [...group].sort((a, b) => b.projectedPoints - a.projectedPoints || a.id.localeCompare(b.id));
    for (const player of byPoints.slice(0, manifest.candidate.perPositionShortlist)) selected.set(player.id, player);
    // Include a different bye when the two strongest choices share one.
    const differentBye = byPoints.find(player => player.byeWeek !== byPoints[0]?.byeWeek);
    if (differentBye) selected.set(differentBye.id, differentBye);
  }
  return [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Experimental only: no application imports this policy. It sees current
// available players and opponent rosters, never the realized future or seed.
function compareNextTurn(state, baseline, forced = null) {
  const candidates = shortlist(legalChoices(state, state.seat, baseline), [forced]);
  const target = nextTurn(state), owned = state.teams[state.seat - 1];
  const baselines = baseline.replacementBaselines(state.available, state.league, state.picks);
  const before = baseline.rosterValue(owned, state.league, baselines).total;
  const rows = candidates.map(player => {
    const scenarios = manifest.candidate.forecastBehaviors.map(behavior => {
      let branch = advance(state, player, baseline);
      while (target && branch.picks.length + 1 < target) {
        const other = opponentChoice(branch, baseline, behavior, 0, true);
        if (!other) return { behavior, nextPlayer: null, gain: -1e9, failed: true };
        branch = advance(branch, other, baseline);
      }
      const secondChoices = target ? shortlist(legalChoices(branch, state.seat, baseline)) : [null];
      const options = secondChoices.map(second => ({ second,
        gain: baseline.rosterValue([...owned, player, ...(second ? [second] : [])], state.league, baselines).total - before }));
      options.sort((a, b) => b.gain - a.gain || String(a.second?.id).localeCompare(String(b.second?.id)));
      const best = options[0];
      return { behavior, nextPlayer: best?.second?.id || null, gain: best ? round(best.gain) : -1e9, failed: !best };
    });
    return { player, meanGain: mean(scenarios.map(row => row.gain)), worstGain: Math.min(...scenarios.map(row => row.gain)), scenarios };
  }).sort((a, b) => b.meanGain - a.meanGain || b.worstGain - a.worstGain || a.player.adp - b.player.adp || a.player.id.localeCompare(b.player.id));
  return { policy: manifest.candidate.version, target, candidateCount: candidates.length, preferred: rows[0]?.player || null, rows,
    basis: 'Two-choice gain using frozen replacement estimates and the existing bench heuristic. Equal assumed opponent scenarios, not survival probabilities; bounded shortlist, not an exhaustive optimum.' };
}
function choose(state, baseline, policy) {
  const choices = legalChoices(state, state.seat, baseline);
  if (policy === 'adp') return { player: [...choices].sort((a, b) => a.adp - b.adp || a.id.localeCompare(b.id))[0] };
  if (policy === 'projection') return { player: [...choices].sort((a, b) => b.projectedPoints - a.projectedPoints || a.id.localeCompare(b.id))[0] };
  if (policy === 'next-turn') { const comparison = compareNextTurn(state, baseline); return { player: comparison.preferred, comparison }; }
  if (policy !== 'frozen-huddle') throw new Error(`Unknown policy ${policy}`);
  const board = baseline.scoreAvailablePlayers({ players: state.players, picks: state.picks, league: state.league,
    draftSlot: state.seat, now: new Date(state.now), season: Number(state.league.provenance?.season || 2026) });
  return { player: board.find(row => row.rosterFeasible)?.player };
}
function evaluateRoster(players, league, baseline) {
  const normal = optimizeLineup(players, league.roster, 'projectedPoints');
  const missing = normal.assignments.filter(row => !row.player).map(row => `${row.slot}:${row.slotIndex}`);
  const positions = count(players), maximums = baseline.defaultPositionMaximums(league);
  const exceeds = Object.entries(positions).filter(([position, total]) => total > maximums[position]).map(([position]) => position);
  const weekly = manifest.evaluationWeeks.map(week => {
    const lineup = players.some(player => player.byeWeek === week)
      ? optimizeLineup(players.filter(player => player.byeWeek !== week), league.roster, 'projectedPoints') : normal;
    return { week, points: lineup.total / 17, loss: Math.max(0, normal.total - lineup.total) / 17,
      missing: lineup.assignments.filter(row => !row.player).map(row => `${row.slot}:${row.slotIndex}`) };
  });
  return { complete: players.length === draftedRosterSize(league.roster) && !missing.length && !exceeds.length,
    drafted: players.length, positions, missingStarters: missing, positionMaximumViolations: exceeds,
    normalStartingLineupSeasonTotal: normal.total,
    uniformWeekLineupPoints: round(weekly.reduce((sum, row) => sum + row.points, 0)),
    byePointLoss: round(weekly.reduce((sum, row) => sum + row.loss, 0)),
    byeSlotGaps: weekly.reduce((sum, row) => sum + row.missing.length, 0),
    byeWeeks: weekly.filter(row => row.loss > 0 || row.missing.length).map(row => ({ ...row, points: round(row.points), loss: round(row.loss) })),
    basis: 'Independent lineup optimizer; uniform season points / 17 over fantasy weeks 1-17, excluding byes, owned replacements only. No injury, matchup, waiver or season-outcome forecast.' };
}
function runDraft(fixture, baseline, { seat, behavior, policy, audit = true } = {}) {
  const inputHash = validateFixture(fixture);
  let state = stateFor(fixture, seat), pending = null;
  const decisions = [], failures = [], calibration = Array.from({ length: 5 }, () => ({ n: 0, prediction: 0, survived: 0, squaredError: 0 }));
  const total = draftedRosterSize(state.league.roster) * state.league.teamCount;
  while (state.picks.length < total) {
    const overall = state.picks.length + 1, owner = pickOwner(overall, state.league.teamCount);
    let player;
    if (owner === seat) {
      if (pending) {
        const remaining = new Set(state.available.map(row => row.id));
        for (const probe of pending) {
          const actual = Number(remaining.has(probe.id)), bin = calibration[Math.min(4, Math.floor(probe.p * 5))];
          bin.n++; bin.prediction += probe.p; bin.survived += actual; bin.squaredError += (probe.p - actual) ** 2;
        }
      }
      const start = performance.now(), chosen = choose(state, baseline, policy);
      const durationMs = performance.now() - start;
      player = chosen.player;
      if (!player) { failures.push({ overall, code: 'NO_LEGAL_CHOICE' }); break; }
      const ownTurn = decisions.length + 1;
      let comparison = chosen.comparison;
      if (audit && manifest.auditOwnTurns.includes(ownTurn)) comparison ||= compareNextTurn(state, baseline, player);
      const selectedRow = comparison?.rows.find(row => row.player.id === player.id);
      decisions.push({ overall, ownTurn, playerId: player.id, position: player.position, adp: player.adp, adpReach: round(player.adp - overall),
        durationMs: round(durationMs), deadlineMiss: durationMs > manifest.candidate.deadlineMs,
        ...(audit && manifest.auditOwnTurns.includes(ownTurn) && comparison ? {
          opportunity: { nextTurn: comparison.target, preferred: comparison.preferred?.id,
            forecastPairGap: selectedRow ? round(comparison.rows[0].meanGain - selectedRow.meanGain) : null,
            candidateCount: comparison.candidateCount, rows: comparison.rows.map(row => ({ player: row.player.id, position: row.player.position,
              meanGain: round(row.meanGain), scenarios: row.scenarios })), basis: comparison.basis } } : {}) });
      const next = nextTurn(state);
      pending = next ? state.available.filter(row => row.id !== player.id).map(row => ({ id: row.id, p: baseline.availabilityAtPick(row.adp, next) })) : null;
    } else player = opponentChoice(state, baseline, behavior, fixture.seed);
    if (!player) { failures.push({ overall, code: 'OPPONENT_NO_LEGAL_CHOICE' }); break; }
    state = advance(state, player, baseline);
  }
  if (digest(fixture) !== inputHash) throw new Error('A policy mutated the common fixture');
  const metrics = evaluateRoster(state.teams[seat - 1], state.league, baseline);
  return { key: `${fixture.split}:${fixture.seed}:${behavior}:${seat}`, inputHash, split: fixture.split, kind: fixture.kind, seed: fixture.seed, behavior, seat, policy,
    completedPicks: state.picks.length, uniquePicks: new Set(state.picks.map(row => row.playerId)).size, failures,
    metrics, decisions, calibration, draftedPlayers: state.teams[seat - 1].map(player => player.id),
    allRostersComplete: state.teams.every(team => evaluateRoster(team, state.league, baseline).complete) };
}
function releaseGate(runs) {
  const held = runs.filter(run => run.split === 'held-out'), current = held.filter(run => run.policy === 'frozen-huddle');
  const expected = manifest.heldOutSeeds.flatMap(seed => manifest.opponents.flatMap(behavior =>
    Array.from({ length: 6 }, (_, index) => `held-out:${seed}:${behavior}:${index + 1}`)));
  const completeMatrix = held.length === expected.length * manifest.policies.length
    && expected.every(key => manifest.policies.every(policy => held.filter(run => run.key === key && run.policy === policy).length === 1));
  const pairs = current.map(run => [run, held.find(row => row.key === run.key && row.policy === 'next-turn')]);
  const completePairs = pairs.length > 0 && pairs.every(([base, candidate]) => candidate && base.inputHash === candidate.inputHash);
  const gains = completePairs ? pairs.map(([base, candidate]) => (candidate.metrics.uniformWeekLineupPoints / base.metrics.uniformWeekLineupPoints - 1) * 100) : [];
  const groups = new Map();
  if (completePairs) pairs.forEach(([base], index) => { const key = `${base.seat}:${base.behavior}`; const group = groups.get(key) || []; group.push(gains[index]); groups.set(key, group); });
  const additionalIncomplete = completePairs ? pairs.filter(([base, candidate]) => base.metrics.complete && !base.failures.length
    && (!candidate.metrics.complete || !!candidate.failures.length)).length : null;
  const deadlineMisses = held.filter(row => row.policy === 'next-turn').flatMap(row => row.decisions).filter(row => row.deadlineMiss).length;
  const checks = { completeMatrix, completePairs, meanGain: completePairs && mean(gains) >= manifest.releaseCriteria.minimumMeanHeldOutGainPercent,
    noSeatBehaviorRegressionBeyondLimit: completePairs && [...groups.values()].every(values => mean(values) >= manifest.releaseCriteria.minimumSeatBehaviorGainPercent),
    noAdditionalIncompleteRosters: completePairs && additionalIncomplete <= 0, computeDeadline: completePairs && deadlineMisses === 0,
    roomIntegrity: completeMatrix && held.every(row => row.allRostersComplete && row.completedPicks === 120 && row.uniquePicks === 120 && !row.failures.length),
    independentSourcedInputs: completePairs && held.every(row => row.kind === 'sourced'),
    actualBrowserTimingAccepted: false };
  return { released: false, eligible: Object.values(checks).every(Boolean), checks, heldOutPairs: pairs.length,
    meanGainPercent: gains.length ? round(mean(gains)) : null, additionalIncompleteRosters: additionalIncomplete, deadlineMisses,
    groups: [...groups].map(([key, values]) => ({ key, gainPercent: round(mean(values)), n: values.length })),
    reason: 'Offline output never changes the active policy. Synthetic or unaccepted browser timing cannot authorize a scoring release.' };
}
module.exports = { digest, count, mean, round, validateFixture, stateFor, legalChoices, advance, nextTurn, opponentChoice,
  shortlist, compareNextTurn, choose, evaluateRoster, runDraft, releaseGate };
