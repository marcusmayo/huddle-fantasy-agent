'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const baseLeague = require('../config/leagues/yahoo-example.json');
const basePool = require('../config/fixtures/demo-players.json');
const {pickOwner}=require('../src/domain/league');
const {scoringFingerprint}=require('../src/domain/league-projections');

function fixture() {
  let clock = new Date('2026-09-09T00:00:00Z');
  const league = structuredClone(baseLeague);
  league.provenance = { yahooLeagueKey: 'nfl.l.153454', yahooTeamKey: 'nfl.l.153454.t.2' };
  const playerPool = structuredClone(basePool);
  playerPool.players.forEach((p, i) => { p.yahooPlayerKey = `nfl.p.${100+i}`; });
  const store = new MemoryStateStore();
  const args = { league, playerPool, store, now: () => clock };
  const drafts = new DraftService(args);
  const session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  const plan = (overrides = {}) => {
    const card = drafts.recommendation(session.id);
    const player = card.preferred.player;
    const yahooPlayerId = player.yahooPlayerKey.split('.p.').at(-1);
    return { type: 'plan', eventId: 'opening-plan', overallPick: 1, classification: 'huddle',
      recommendationId: card.recommendationId, playerId: player.id, playerName: player.name, yahooPlayerId,
      yahooObservation: { observedAt: clock.toISOString(), overallPick: 1, completedPicks: 0, secondsLeft: 60,
        onClock: true, yahooPlayerId, leagueKey: league.provenance.yahooLeagueKey, teamKey: league.provenance.yahooTeamKey }, ...overrides };
  };
  return { drafts, session, args, playerPool, store, plan, advance: ms => { clock = new Date(clock.getTime()+ms); } };
}

test('recommendation history deduplicates reads and preserves the original pool through change and restart', () => {
  const f = fixture(); const first = f.drafts.recommendation(f.session.id);
  const original = f.drafts.exportDecisionAudit(f.session.id);
  assert.equal(f.drafts.recommendation(f.session.id).recommendationId, first.recommendationId);
  assert.equal(f.drafts.decisionSummary(f.session.id).recommendationSnapshots, 1);
  f.playerPool.players[0].projectedPoints += 100;
  const second = f.drafts.recommendation(f.session.id);
  assert.notEqual(second.poolRevision, first.poolRevision);
  const restored = new DraftService(f.args).exportDecisionAudit(f.session.id);
  assert.deepEqual(restored.recommendations[0], original.recommendations[0]);
  assert.deepEqual(restored.pools[first.poolRevision], original.pools[first.poolRevision]);
  assert.equal(restored.integrityVerified, true);
});

test('plans require exact turn, current pool, selected Yahoo identity and current league/team observation', () => {
  const f = fixture(); const input = f.plan();
  const reject = (value, code) => assert.throws(() => f.drafts.recordDecision(f.session.id, value), error => error.code === code);
  reject({ ...input, overallPick: 2 }, 'DECISION_WRONG_TURN');
  reject({ ...input, yahooObservation: { ...input.yahooObservation, leagueKey: 'nfl.l.other' } }, 'DECISION_LEAGUE_MISMATCH');
  reject({ ...input, yahooObservation: { ...input.yahooObservation, teamKey: 'nfl.l.153454.t.4' } }, 'DECISION_TEAM_MISMATCH');
  reject({ ...input, yahooObservation: { ...input.yahooObservation, secondsLeft: 0 } }, 'DECISION_CLOCK_EXPIRED');
  f.advance(6000); reject(input, 'DECISION_YAHOO_OBSERVATION_REQUIRED');
  f.playerPool.players[0].projectedPoints += 100;
  reject(input, 'DECISION_STALE_RECOMMENDATION');
  assert.equal(f.drafts.decisionSummary(f.session.id).events.length, 0);
});

test('audibles need a reason and a recorded submission cannot be blindly retried after uncertainty', () => {
  const f = fixture(); const input = f.plan();
  assert.throws(()=>f.drafts.recordDecision(f.session.id,{...input,classification:'audible',reason:'This is still the preferred player.'}),{code:'DECISION_AUDIBLE_SAME_PLAYER'});
  const other = f.playerPool.players.find(p => p.id !== input.playerId);
  const alternate = { ...input, playerId: other.id, playerName: other.name, yahooPlayerId: other.yahooPlayerKey.split('.p.').at(-1) };
  alternate.yahooObservation = { ...input.yahooObservation, yahooPlayerId: alternate.yahooPlayerId };
  assert.throws(() => f.drafts.recordDecision(f.session.id, alternate), { code: 'DECISION_NOT_HUDDLE_CHOICE' });
  alternate.classification = 'audible';
  assert.throws(() => f.drafts.recordDecision(f.session.id, alternate), { code: 'DECISION_REASON_REQUIRED' });
  alternate.reason = 'Current Yahoo evidence changes the choice.';
  const saved = f.drafts.recordDecision(f.session.id, alternate);
  const start = { type: 'submit-started', eventId: 'submit-1', planId: saved.event.hash };
  f.drafts.recordDecision(f.session.id, start);
  assert.equal(f.drafts.recordDecision(f.session.id, start).applied, false);
  f.drafts.recordDecision(f.session.id, { type: 'submit-uncertain', eventId: 'uncertain', planId: saved.event.hash });
  assert.throws(() => f.drafts.recordDecision(f.session.id, { ...start, eventId: 'retry-2' }), { code: 'DECISION_SUBMISSION_ALREADY_STARTED' });
});

test('an aged clock, abandoned plan, or superseded choice cannot authorize a click',()=>{
  const f=fixture(),input=f.plan();
  f.advance(3000);
  assert.throws(()=>f.drafts.recordDecision(f.session.id,{...input,yahooObservation:{...input.yahooObservation,secondsLeft:2}}),{code:'DECISION_CLOCK_EXPIRED'});
  const first=f.drafts.recordDecision(f.session.id,f.plan()).event;
  f.drafts.recordDecision(f.session.id,f.plan({eventId:'revised-plan'}));
  assert.throws(()=>f.drafts.recordDecision(f.session.id,{type:'submit-started',eventId:'old-plan-click',planId:first.hash}),{code:'DECISION_PLAN_SUPERSEDED'});
  const second=f.drafts.decisionSummary(f.session.id).latestPlan;
  f.drafts.recordDecision(f.session.id,{type:'abandoned',eventId:'cancelled-choice',planId:second.hash});
  assert.throws(()=>f.drafts.recordDecision(f.session.id,{type:'submit-started',eventId:'cancelled-click',planId:second.hash}),{code:'DECISION_PLAN_ABANDONED'});
});

test('failed durable writes roll back a plan and accepted picks retain truthful attribution', () => {
  const f = fixture(); const input = f.plan(); const save = f.store.save.bind(f.store);
  f.store.save = () => { throw new Error('disk unavailable'); };
  assert.throws(() => f.drafts.recordDecision(f.session.id, input), /disk unavailable/);
  assert.equal(f.drafts.decisionSummary(f.session.id).events.length, 0);
  f.store.save = save;
  f.drafts.recordDecision(f.session.id, input);
  const other = f.playerPool.players.find(p => p.id !== input.playerId);
  f.drafts.recordPick(f.session.id, { eventId: 'yahoo-accepted-1', playerId: other.id, yahooPlayerKey: other.yahooPlayerKey, isMine: true, source: 'yahoo' });
  const accepted = f.drafts.decisionSummary(f.session.id).lastAccepted;
  assert.equal(accepted.classification, 'unattributed');
  assert.equal(accepted.verification, 'different-player-accepted');
  assert.equal(new DraftService(f.args).decisionSummary(f.session.id).integrityVerified, true);
});

test('tampered recommendation evidence or decision events fail integrity checks', () => {
  const f = fixture(); f.drafts.recordDecision(f.session.id, f.plan());
  const audit = f.drafts.state.draftAudit;
  const revision = audit.recommendations[f.session.id][0].poolRevision;
  delete audit.pools[revision];
  assert.equal(f.drafts.decisionSummary(f.session.id).integrityVerified, false);
  audit.events[f.session.id][0].reason = 'Altered after the fact';
  assert.throws(() => f.drafts.recordDecision(f.session.id, { eventId: 'new-event' }), { code: 'DECISION_AUDIT_CORRUPT' });
});

test('event-only audit history and pool snapshots expire durably without changing accepted pick order', () => {
  const f = fixture(); f.drafts.recordDecision(f.session.id, f.plan());
  const second = f.drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  const p = f.playerPool.players[0];
  f.drafts.recordPick(second.id, { eventId: 'unplanned-receipt', playerId: p.id, yahooPlayerKey: p.yahooPlayerKey, isMine: true });
  assert.equal(f.drafts.decisionSummary(second.id).lastAccepted.verification, 'accepted-without-plan');
  f.advance(31*24*60*60*1000);
  const restored = new DraftService(f.args);
  assert.equal(restored.decisionSummary(f.session.id).events.length, 0);
  assert.equal(restored.decisionSummary(second.id).events.length, 0);
  assert.equal(restored.getSession(second.id).picks.length, 1);
  const again = new DraftService(f.args);
  assert.deepEqual(again.state.draftAudit.pools, {});
  assert.deepEqual(again.state.draftAudit.recommendations, {});
  assert.deepEqual(again.state.draftAudit.events, {});
});

test('DR live-mode 120-pick replay retains twenty exact-turn plans, submission starts and accepted IDs after restart', () => {
  let time=Date.parse('2026-09-09T00:00:00Z');
  const league={...structuredClone(baseLeague),platform:'yahoo',roster:{QB:2,WR:4,RB:3,TE:1,'W/T':1,'W/R':1,K:1,DEF:2,BN:5,IR:2},
    provenance:{yahooLeagueKey:'nfl.l.replay',yahooTeamKey:'nfl.l.replay.t.1'}};
  const positions=['QB','RB','WR','TE','RB','WR','DEF','K'];
  const players=Array.from({length:320},(_,i)=>({id:`p${i}`,yahooPlayerKey:`nfl.p.${1000+i}`,name:`Replay Player ${i}`,position:positions[i%8],team:'SEA',byeWeek:5+i%10,
    expertRank:i+1,adp:i+1,projectedPoints:400-i*.8,floor:300-i*.5,ceiling:450-i*.8,projectionLeagueId:league.id,
    projectionScoringFingerprint:scoringFingerprint(league),projectionScoringVerified:true,projectionSource:'synthetic-same-input-replay'}));
  const args={league,playerPool:{players,source:'synthetic-live-mode-replay',complete:true,season:2026},store:new MemoryStateStore(),now:()=>new Date(time)};
  const drafts=new DraftService(args),session=drafts.createSession({draftSlot:1,sourceMode:'yahoo'});
  for(let overall=1;overall<=120;overall++){
    time+=1000;
    const mine=pickOwner(overall,6)===1;
    const drafted=new Set(drafts.getSession(session.id).picks.map(p=>p.playerId));
    let player=players.find(p=>!drafted.has(p.id));
    if(mine){
      const card=drafts.recommendation(session.id);assert.ok(card.preferred,`Missing recommendation ${overall}`);
      player=players.find(p=>p.id===card.preferred.player.id);
      const yahooPlayerId=player.yahooPlayerKey.split('.p.')[1];
      const plan=drafts.recordDecision(session.id,{type:'plan',eventId:`plan-${overall}`,overallPick:overall,classification:'huddle',recommendationId:card.recommendationId,
        playerId:player.id,playerName:player.name,yahooPlayerId,yahooObservation:{observedAt:new Date(time).toISOString(),overallPick:overall,completedPicks:overall-1,secondsLeft:60,onClock:true,leagueKey:league.provenance.yahooLeagueKey,teamKey:league.provenance.yahooTeamKey,yahooPlayerId}});
      drafts.recordDecision(session.id,{type:'submit-started',eventId:`submit-${overall}`,planId:plan.event.hash});
    }
    drafts.recordPick(session.id,{overallPick:overall,eventId:`receipt-${overall}`,playerId:player.id,yahooPlayerKey:player.yahooPlayerKey,isMine:mine,source:'replayed-yahoo-result'});
  }
  const restored=new DraftService(args),audit=restored.exportDecisionAudit(session.id);
  assert.equal(audit.session.status,'completed');assert.equal(audit.session.picks.length,120);
  assert.equal(audit.events.filter(e=>e.type==='plan').length,20);assert.equal(audit.events.filter(e=>e.type==='submit-started').length,20);
  const receipts=audit.events.filter(e=>e.type==='accepted');assert.equal(receipts.length,20);
  assert.equal(receipts[0].overallPick,1);assert.equal(receipts.at(-1).overallPick,120);
  assert.ok(receipts.every(e=>e.verification==='matched-plan'&&e.classification==='huddle'));
  assert.equal(audit.integrityVerified,true);assert.equal(audit.recommendations.length,20);
  assert.ok(audit.recommendations.every(s=>s.reconciledPicks===s.overallPick-1&&s.preferred&&s.alternatives));
});
