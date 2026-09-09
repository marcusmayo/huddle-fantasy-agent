'use strict';
const crypto = require('node:crypto');
const { yahooId } = require('../services/player-evidence');
const { pickOwner } = require('./league');
const { isFreshObservation, CLOCK_SKEW_ALLOWANCE_MS } = require('./observation-time');

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);

function rankingPlayer(player) {
  const fields = ['id', 'name', 'position', 'team', 'yahooPlayerKey', 'expertRank', 'adp', 'tier', 'byeWeek', 'injuryStatus', 'risk',
    'projectedPoints', 'floor', 'ceiling', 'rangeEstimated', 'projectionImputed', 'projectionSource', 'projectionLeagueId',
    'projectionScoringFingerprint', 'projectionScoringVerified', 'projectionScoringWarning', 'sourceConsensus', 'sourceRanks',
    'sleeperTrend', 'sourceDisagreement', 'yahooEvidenceObservedAt', 'yahooEvidenceSeason', 'injuryObservedAt', 'injurySource',
    'byeSource', 'byeObservedAt', 'teamSource', 'teamObservedAt', 'projectionSeason', 'projectionPeriod'];
  return Object.fromEntries(fields.filter(field => player[field] !== undefined).map(field => [field, structuredClone(player[field])]));
}

function choiceSnapshot(choice) {
  return choice ? { player: rankingPlayer(choice.player), score: choice.score, why: structuredClone(choice.why || []),
    rosterContribution: structuredClone(choice.rosterContribution || null), rosterFeasible: choice.rosterFeasible,
    waitProbability: choice.waitProbability, waitEstimateCalibrated: false } : null;
}

function appendEvent(events, event) {
  const record = { ...event, sequence: events.length + 1, previousHash: events.at(-1)?.hash || null };
  record.hash = digest(record);
  events.push(record);
  return record;
}

function verifyEvents(events) {
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    const { hash, ...body } = event;
    if (body.sequence !== index + 1 || body.previousHash !== previousHash || digest(body) !== hash) return false;
    previousHash = hash;
  }
  return true;
}

function validatePlan({ input, session, league, snapshot, recommendationId, poolRevision, now }) {
  const overallPick = Number(input.overallPick);
  if (session.status !== 'active') fail('DRAFT_SESSION_COMPLETED', 'A completed draft cannot receive a new selection plan');
  if (overallPick !== session.picks.length + 1 || pickOwner(overallPick, league.teamCount) !== session.draftSlot) fail('DECISION_WRONG_TURN', 'The plan must match the current owned turn');
  const classification = input.classification;
  if (!['huddle', 'audible', 'fallback', 'user'].includes(classification)) fail('INVALID_DECISION_CLASSIFICATION', 'Classify the selection as Huddle, audible, fallback or user');
  const reason = clean(input.reason, 1200);
  if (classification !== 'huddle' && reason.length < 8) fail('DECISION_REASON_REQUIRED', 'Record why this choice differs or uses a fallback');
  if (classification !== 'fallback' && classification !== 'user') {
    if (!snapshot || snapshot.id !== recommendationId || snapshot.sessionId !== session.id || snapshot.overallPick !== overallPick
      || snapshot.poolRevision !== poolRevision || snapshot.reconciledPicks !== session.picks.length) fail('DECISION_STALE_RECOMMENDATION', 'Refresh and review the exact-turn recommendation before selecting');
  }
  const playerId = clean(input.playerId, 120);
  const selectedYahooId = clean(input.yahooPlayerId, 24);
  if (!playerId && !/^\d+$/.test(selectedYahooId)) fail('DECISION_PLAYER_REQUIRED', 'Select an exact player identity');
  if (session.sourceMode === 'yahoo' && !/^\d+$/.test(selectedYahooId)) fail('DECISION_YAHOO_ID_REQUIRED', 'A live decision requires the observed numeric Yahoo player ID');
  if (classification === 'huddle') {
    const preferred = snapshot?.preferred?.player;
    const preferredYahooId = yahooId(preferred);
    if (!preferred || (selectedYahooId ? selectedYahooId !== preferredYahooId : playerId !== preferred.id)) fail('DECISION_NOT_HUDDLE_CHOICE', 'This player differs from Huddle; record an audible and its reason');
  }
  if (classification === 'audible' && (selectedYahooId ? selectedYahooId === yahooId(snapshot?.preferred?.player) : playerId === snapshot?.preferred?.player.id)) fail('DECISION_AUDIBLE_SAME_PLAYER', 'Following the preferred player is a Huddle choice, not an audible');
  const observation = input.yahooObservation;
  if (session.sourceMode === 'yahoo') {
    const age = now.getTime() - Date.parse(observation?.observedAt);
    if (!observation || !isFreshObservation(observation.observedAt, now.getTime())
      || Number(observation.overallPick) !== overallPick || Number(observation.completedPicks) !== session.picks.length
      || observation.yahooPlayerId !== selectedYahooId || !observation.onClock) fail('DECISION_YAHOO_OBSERVATION_REQUIRED', 'A fresh Yahoo observation must confirm the current turn, board and selected ID');
    if (!Number.isFinite(Number(observation.secondsLeft)) || Number(observation.secondsLeft) * 1000 <= Math.max(0, age) + CLOCK_SKEW_ALLOWANCE_MS) fail('DECISION_CLOCK_EXPIRED', 'Yahoo must still have time remaining after observation age and clock uncertainty');
    if (league.provenance?.yahooLeagueKey && observation.leagueKey !== league.provenance.yahooLeagueKey) fail('DECISION_LEAGUE_MISMATCH', 'Yahoo observation belongs to a different league');
    if (league.provenance?.yahooTeamKey && observation.teamKey !== league.provenance.yahooTeamKey) fail('DECISION_TEAM_MISMATCH', 'Yahoo observation belongs to a different fantasy team');
  }
  return {
    type: 'plan', overallPick, classification, reason,
    playerId: playerId || null, yahooPlayerId: selectedYahooId || null, playerName: clean(input.playerName, 100),
    recommendationId: snapshot?.id || null, poolRevision: snapshot?.poolRevision || poolRevision,
    recommendedPlayer: snapshot?.preferred?.player.name || null,
    observedAt: now.toISOString(),
    yahooObservation: observation ? { observedAt: clean(observation.observedAt, 40), overallPick: Number(observation.overallPick),
      completedPicks: Number(observation.completedPicks), secondsLeft: Number(observation.secondsLeft), onClock: Boolean(observation.onClock),
      yahooPlayerId: selectedYahooId, leagueKey: clean(observation.leagueKey, 80), teamKey: clean(observation.teamKey, 80) } : null,
    executor: { name: clean(input.executor?.name || 'operator', 80), model: clean(input.executor?.model, 80), effort: clean(input.executor?.effort, 40),
      mode: input.executor?.mode==='computer-use'?'computer-use':'operator',controllerId:clean(input.executor?.controllerId,120),controllerRunId:clean(input.executor?.controllerRunId,120), contextSource: 'reported-by-operator' }
  };
}

module.exports = { digest, rankingPlayer, choiceSnapshot, appendEvent, verifyEvents, validatePlan };
