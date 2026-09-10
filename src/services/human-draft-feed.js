'use strict';
const crypto = require('node:crypto');
const { pickOwner } = require('../domain/league');
const { digest, appendEvent } = require('../domain/decision-audit');
const { isFreshObservation } = require('../domain/observation-time');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const MINIMUM_MS = 10000, UNCERTAINTY_MS = 2000, FRESH_MS = 5000;

// Observation authority is deliberately separate from pick-execution leases.
class HumanDraftFeed {
  constructor(drafts) { this.drafts = drafts; this.connections = new Map(); }
  history(id) { return this.drafts.state.sessions[id].humanDelivery ||= { enabled: false, turns: {} }; }
  save(id, event, update) {
    const d = this.drafts, session = d.state.sessions[id], old = structuredClone(session.humanDelivery);
    const events = d.state.draftAudit.events[id] ||= [], length = events.length;
    if (!d.decisionSummary(id).integrityVerified) fail('FEED_AUDIT_INVALID', 'Draft history needs review');
    update(this.history(id));
    appendEvent(events, { ...event, eventId: crypto.randomUUID(), observedAt: d.currentIso() });
    try { d.persist(); } catch (e) { session.humanDelivery = old; events.splice(length); throw e; }
  }
  pair(id, { clockSeconds }) {
    const d = this.drafts, session = d.getSession(id), p = d.league.provenance;
    if (session.sourceMode !== 'yahoo' || session.status !== 'active' || !p?.yahooLeagueKey || !p?.yahooTeamKey)
      fail('HUMAN_FEED_SESSION_REQUIRED', 'Open an active Yahoo draft with verified league and team');
    if (!Number.isFinite(clockSeconds) || clockSeconds <= 12 || clockSeconds > 3600)
      fail('HUMAN_CLOCK_UNSUPPORTED', 'The clock must leave ten seconds plus observation time; use more than 12 seconds');
    if (d.controllers.status(id).active) fail('HUMAN_EXECUTOR_ACTIVE', 'Stop automated execution before connecting the human draft feed');
    const connection = { token: crypto.randomBytes(32).toString('hex'), observation: null, recent: new Map(), error: null };
    this.save(id, { type: 'human-feed-paired', clockSeconds }, h => { h.enabled = true; h.clockSeconds = clockSeconds; });
    this.connections.set(id, connection);
    return { token: connection.token, roomPath: `/draftclient/f1/${p.yahooLeagueKey.split('.l.').at(-1)}/${p.yahooTeamKey.split('.t.').at(-1)}`,
      leagueKey: p.yahooLeagueKey, teamKey: p.yahooTeamKey, draftSlot: session.draftSlot, totalPicks: session.totalPicks,
      teamCount: d.league.teamCount, minimumSelectionSeconds: 10 };
  }
  authorize(id, token) {
    const c = this.connections.get(id);
    if (!c || typeof token !== 'string' || token.length !== c.token.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(c.token)))
      fail('HUMAN_FEED_PAIR_REQUIRED', 'Reconnect the read-only companion to this Huddle session');
    return c;
  }
  observe(id, input, token) {
    const c = this.authorize(id, token), d = this.drafts;
    try {
      const session = d.getSession(id), p = d.league.provenance, o = input.observation;
      if (!o || !isFreshObservation(o.observedAt, d.now().getTime())) fail('HUMAN_FEED_STALE', 'Draft observation is stale');
      if (o.leagueKey !== p.yahooLeagueKey || o.teamKey !== p.yahooTeamKey || o.draftSlot !== session.draftSlot)
        fail('HUMAN_FEED_ROOM_MISMATCH', 'The companion is observing another draft');
      if (!Number.isInteger(o.completedPicks) || o.completedPicks < session.picks.length || o.completedPicks > session.totalPicks
        || o.overallPick !== o.completedPicks + 1 || !['waiting', 'drafting', 'completed'].includes(o.phase)
        || (o.phase === 'completed') !== (o.completedPicks === session.totalPicks)
        || (o.phase === 'waiting' && o.completedPicks !== 0)) fail('HUMAN_FEED_BOARD_INVALID', 'The draft board is incomplete or inconsistent');
      if (o.phase === 'drafting' && (!(o.secondsLeft > 0) || !Number.isFinite(o.secondsLeft)
        || o.onClock !== (pickOwner(o.overallPick, d.league.teamCount) === session.draftSlot)))
        fail('HUMAN_FEED_CLOCK_INVALID', 'The current turn and clock cannot be verified');
      if (input.picks) {
        if (input.picks.length !== o.completedPicks) fail('HUMAN_FEED_BOARD_INCOMPLETE', 'The complete draft results are not available');
        d.reconcileBrowserResults(id, { ...o, picks: input.picks });
      } else if (session.picks.length !== o.completedPicks) fail('HUMAN_FEED_BOARD_INCOMPLETE', 'Waiting for complete draft results');
      // A complete board can also arrive from the independent authenticated API poller.
      const history = this.history(id);
      for (let pick = 1; pick <= o.completedPicks; pick++) {
        if (pickOwner(pick, d.league.teamCount) !== session.draftSlot || history.turns[pick]?.closed) continue;
        const previous = history.turns[pick];
        const passed = previous?.delivered === true && !previous?.failed;
        this.save(id, { type: 'human-delivery-closed', overallPick: pick, passed }, h => {
          h.turns[pick] = { ...h.turns[pick], closed: true, failed: !passed, reason: passed ? null : h.turns[pick]?.reason || 'No verified timely visible recommendation' };
        });
      }
      c.observation = structuredClone(o); c.observationId = digest(o); c.error = null;
      c.recent.set(c.observationId, structuredClone(o));
      for (const [key, value] of c.recent) if (d.now().getTime()-Date.parse(value.observedAt)>5000) c.recent.delete(key);
      const usable = o.secondsLeft * 1000 - Math.max(0, d.now().getTime() - Date.parse(o.observedAt)) - UNCERTAINTY_MS;
      if (o.phase === 'drafting' && o.onClock && usable < MINIMUM_MS && !history.turns[o.overallPick]?.delivered && !history.turns[o.overallPick]?.failed)
        this.save(id, { type: 'human-delivery-missed', overallPick: o.overallPick }, h => {
          h.turns[o.overallPick] = { ...h.turns[o.overallPick], failed: true, reason: 'Recommendation not visibly delivered with ten seconds remaining' };
        });
      return this.status(id);
    } catch (e) { c.error = e.message; throw e; }
  }
  status(id) {
    const session = this.drafts.getSession(id), h = session.humanDelivery;
    if (!h?.enabled) return null;
    const c = this.connections.get(id), age = this.drafts.now().getTime() - Date.parse(c?.observation?.observedAt);
    const modeVerified=c?.observation?.phase==='completed' || (c?.observation?.manualModeKnown===true && c?.observation?.autodraft===false);
    const fresh = Boolean(modeVerified && c && !c.error && age >= -1000 && age <= FRESH_MS && c.observation.completedPicks === session.picks.length);
    return { enabled: true, connected: Boolean(c), fresh, observation: c?.observation || null, observationId: c?.observationId || null,
      minimumSelectionMs: MINIMUM_MS, uncertaintyMs: UNCERTAINTY_MS, freshMs: FRESH_MS,
      reason: !c ? 'Reconnect the read-only companion' : c.error || (!modeVerified ? 'Yahoo manual mode is unverified or autodraft is active' : !fresh ? 'Draft feed is stale' : 'Read-only draft feed connected'),
      turns: structuredClone(h.turns), failedPicks: Object.entries(h.turns).filter(([, t]) => t.failed).map(([p]) => Number(p)) };
  }
  delivered(id, input) {
    const d = this.drafts, c = this.connections.get(id), session = d.getSession(id), o = c?.recent.get(input.observationId);
    if (!this.status(id)?.fresh || !o?.onClock || o.phase !== 'drafting' || o.completedPicks!==session.picks.length || !isFreshObservation(o.observedAt,d.now().getTime()))
      fail('HUMAN_DELIVERY_STALE', 'A fresh matching human draft observation is required');
    const card = d.recommendation(id), choices = [card.preferred, card.alternatives.safe, card.alternatives.upside];
    const expected = choices.map(x => x?.player?.id);
    if (input.recommendationId !== card.recommendationId || expected.some(x => !x) || JSON.stringify(input.playerIds) !== JSON.stringify(expected)
      || input.visible !== true || input.overallPick !== o.overallPick)
      fail('HUMAN_DELIVERY_MISMATCH', 'Verify the current recommendation and both alternatives are visible');
    const renderedAt = Date.parse(input.renderedAt), now = d.now().getTime();
    if (!Number.isFinite(renderedAt) || renderedAt > now + 1000 || renderedAt < Date.parse(o.observedAt) - 1000 || now - renderedAt > 5000)
      fail('HUMAN_DELIVERY_TIME_INVALID', 'The rendered recommendation timestamp is not fresh');
    const remainingMs = Math.min(Number(input.remainingMs), o.secondsLeft * 1000 - Math.max(0, renderedAt - Date.parse(o.observedAt)) - UNCERTAINTY_MS);
    if (!Number.isFinite(remainingMs) || remainingMs < 0) fail('HUMAN_DELIVERY_TIME_INVALID', 'The selection reserve is invalid');
    const old = this.history(id).turns[o.overallPick];
    if (old?.revisions?.includes(card.recommendationId)) return { applied: false, turn: old };
    const timely = remainingMs >= MINIMUM_MS;
    this.save(id, { type: 'human-recommendation-visible', overallPick: o.overallPick, recommendationId: card.recommendationId,
      renderedAt: input.renderedAt, remainingMs, timely, playerIds: expected, observation: o }, h => {
      h.turns[o.overallPick] = { ...old, delivered: old?.delivered || timely, failed: Boolean(old?.failed || !timely),
        reason: old?.reason || (timely ? null : 'Visible recommendation arrived with less than ten seconds remaining'),
        minimumRemainingMs: Math.min(old?.minimumRemainingMs ?? Infinity, remainingMs), revisions: [...(old?.revisions || []), card.recommendationId] };
    });
    return { applied: true, turn: this.history(id).turns[o.overallPick] };
  }
}
module.exports = { HumanDraftFeed };
