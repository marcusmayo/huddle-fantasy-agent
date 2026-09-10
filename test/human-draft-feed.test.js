'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DraftService}=require('../src/services/draft-service');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {pickOwner}=require('../src/domain/league');
const {scoringFingerprint}=require('../src/domain/league-projections');
const {viewModel}=require('../public/draft-view-model');
function fixture(full=false){
  let time=Date.parse('2026-09-09T14:00:00Z');
  const league={...require('../config/leagues/yahoo-example.json'),teamCount:full?6:8,
    roster:full?{QB:2,WR:4,RB:3,TE:1,'W/T':1,'W/R':1,K:1,DEF:2,BN:5,IR:2}:{QB:1,RB:2,WR:2,TE:1,'R/W/T':1,K:1,DEF:1,BN:6},
    provenance:{yahooLeagueKey:'nfl.l.123',yahooTeamKey:'nfl.l.123.t.2'}};
  const players=Array.from({length:240},(_,i)=>({id:`p${i}`,yahooPlayerKey:`nfl.p.${1000+i}`,name:`Player ${i}`,position:['QB','RB','WR','TE','RB','WR','DEF','K'][i%8],team:'SEA',byeWeek:5+i%10,
    expertRank:i+1,adp:i+1,projectedPoints:400-i,floor:300-i*.5,ceiling:450-i,projectionLeagueId:league.id,projectionScoringFingerprint:scoringFingerprint(league),projectionScoringVerified:true,projectionSource:'test'}));
  const store=new MemoryStateStore(),args={league,playerPool:{players,source:'test',complete:true,season:2026},store,now:()=>new Date(time)};
  let d=new DraftService(args);const session=d.createSession({draftSlot:full?1:8,sourceMode:'yahoo'}),id=session.id,picks=[];
  const pair=()=>d.humanFeed.pair(id,{clockSeconds:full?70:30});let config=pair();
  const observation=(seconds=30)=>({manualModeKnown:true,autodraft:false,observedAt:new Date(time).toISOString(),phase:picks.length===120?'completed':'drafting',overallPick:picks.length+1,completedPicks:picks.length,secondsLeft:seconds,
    onClock:picks.length<120&&pickOwner(picks.length+1,league.teamCount)===session.draftSlot,...league.provenance,leagueKey:league.provenance.yahooLeagueKey,teamKey:league.provenance.yahooTeamKey,draftSlot:session.draftSlot});
  const observe=(seconds=30)=>d.humanFeed.observe(id,{observation:observation(seconds),picks},config.token);
  const visible=(patch={})=>{const w=d.workspace(id);return d.humanFeed.delivered(id,{observationId:w.humanFeed.observationId,recommendationId:w.card.recommendationId,overallPick:picks.length+1,
    playerIds:[w.card.preferred,w.card.alternatives.safe,w.card.alternatives.upside].map(c=>c?.player.id),visible:true,renderedAt:new Date(time).toISOString(),remainingMs:w.humanFeed.observation.secondsLeft*1000-2000,...patch});};
  const add=()=>{const mine=pickOwner(picks.length+1,league.teamCount)===session.draftSlot;
    const p=mine?d.recommendation(id).preferred.player:players.find(p=>!picks.some(x=>x.yahooPlayerId===p.yahooPlayerKey.split('.p.')[1]));
    picks.push({overallPick:picks.length+1,yahooPlayerId:p.yahooPlayerKey.split('.p.')[1],name:p.name,position:p.position,team:p.team,isMine:mine});};
  return {get d(){return d;},id,players,league,picks,config,observation,observe,visible,add,pair,bump:ms=>time+=ms,now:()=>time,
    restart(){d=new DraftService(args);},reconnect(){config=pair();}};
}
for(const full of [false,true])test(`human feed delivers every owned turn at ${full?70:30}s without any executor`,()=>{
  const f=fixture(full),expected=full?20:15;
  for(let i=0;i<120;i++){f.observe(full?70:30);if(f.observation().onClock){f.visible();f.visible();}f.add();f.bump(400);}
  f.observe();const w=f.d.workspace(f.id),turns=Object.values(w.humanFeed.turns);
  assert.equal(turns.length,expected);assert.equal(turns.filter(t=>t.delivered&&!t.failed).length,expected);assert.equal(w.session.picks.length,120);
  assert.deepEqual(w.humanFeed.failedPicks,[]);assert.equal(w.controller.active,false);assert.equal(w.controller.controllerId,null);
  assert.equal(w.decisions.events.filter(e=>e.type==='human-recommendation-visible').length,expected);
  assert.equal(w.decisions.events.filter(e=>e.type==='submit-started').length,0);
  f.restart();assert.equal(f.d.decisionSummary(f.id).integrityVerified,true);assert.equal(f.d.humanFeed.status(f.id).connected,false);
});
test('late delivery is permanent even when later clock observations increase',()=>{
  const f=fixture(true);f.observe(10);f.visible();f.observe(70);f.visible();
  assert.deepEqual(f.d.humanFeed.status(f.id).failedPicks,[1]);f.add();f.observe();assert.equal(f.d.humanFeed.status(f.id).turns[1].failed,true);
});
test('exact ten-second reserve passes; clipped, wrong and stale render receipts do not',()=>{
  const f=fixture(true);f.observe(12);
  assert.throws(()=>f.visible({visible:false}),{code:'HUMAN_DELIVERY_MISMATCH'});
  assert.throws(()=>f.visible({playerIds:['wrong']}),{code:'HUMAN_DELIVERY_MISMATCH'});
  f.visible();assert.equal(f.d.humanFeed.status(f.id).turns[1].minimumRemainingMs,10000);
  f.bump(5001);assert.throws(()=>f.visible(),{code:'HUMAN_DELIVERY_STALE'});
});
test('old response for same board can acknowledge a render while newer observations arrive',()=>{
  const f=fixture(true);f.observe();const old=f.d.workspace(f.id).humanFeed.observationId;f.bump(500);f.observe(29);
  f.visible({observationId:old,remainingMs:28000});assert.equal(f.d.humanFeed.status(f.id).turns[1].delivered,true);
});
test('missing owned turn and missing source board are visible failures, never healthy feed',()=>{
  const f=fixture(true);f.add();
  assert.throws(()=>f.d.humanFeed.observe(f.id,{observation:f.observation()},f.config.token),{code:'HUMAN_FEED_BOARD_INCOMPLETE'});
  assert.equal(f.d.humanFeed.status(f.id).fresh,false);f.observe();assert.deepEqual(f.d.humanFeed.status(f.id).failedPicks,[1]);
});
test('pairing is scoped, rejects short clocks, and restart never resurrects feed liveness',()=>{
  const f=fixture(true);assert.throws(()=>f.d.humanFeed.pair(f.id,{clockSeconds:10}),{code:'HUMAN_CLOCK_UNSUPPORTED'});
  assert.throws(()=>f.d.humanFeed.observe(f.id,{observation:f.observation(),picks:[]},'wrong'),{code:'HUMAN_FEED_PAIR_REQUIRED'});
  assert.throws(()=>f.d.humanFeed.observe(f.id,{observation:{...f.observation(),teamKey:'wrong'},picks:[]},f.config.token),{code:'HUMAN_FEED_ROOM_MISMATCH'});
  f.observe();f.restart();assert.equal(f.d.humanFeed.status(f.id).fresh,false);
  assert.throws(()=>f.observe(),{code:'HUMAN_FEED_PAIR_REQUIRED'});f.reconnect();f.observe();assert.equal(f.d.humanFeed.status(f.id).fresh,true);
});
test('human dashboard freshness and clock do not require an execution lease',()=>{
  const f=fixture(true);f.observe(30);const w=f.d.workspace(f.id);
  w.context={localDraft:{instanceId:'local'},yahooLeagueKey:f.league.provenance.yahooLeagueKey,yahooTeamKey:f.league.provenance.yahooTeamKey};
  const m=viewModel(w,{now:f.now(),receivedAt:f.now()});assert.equal(m.stale,false);assert.equal(m.controllerActive,false);assert.equal(m.humanRemainingMs,28000);assert.match(m.controllerStatus,/You make/);
  assert.equal(viewModel(w,{now:f.now()+5001,receivedAt:f.now()+5001}).stale,true);
});
test('clock changes and a different human choice retain timing and honest attribution',()=>{
  const f=fixture(true);f.observe(70);f.observe(30);const w=f.d.workspace(f.id),alternative=w.card.alternatives.safe.player;
  f.visible();f.picks.push({overallPick:1,yahooPlayerId:alternative.yahooPlayerKey.split('.p.')[1],name:alternative.name,position:alternative.position,team:alternative.team,isMine:true});
  f.observe(30);const next=f.d.workspace(f.id);next.context={yahooLeagueKey:f.league.provenance.yahooLeagueKey,yahooTeamKey:f.league.provenance.yahooTeamKey};
  const m=viewModel(next,{now:f.now(),receivedAt:f.now()});assert.equal(next.humanFeed.turns[1].minimumRemainingMs,28000);assert.equal(next.humanFeed.turns[1].failed,false);
  assert.match(m.reason,/Different from/);assert.match(m.reason,/not recorded/);assert.equal(m.classification,'RECONCILED PICK');
});

test('twelve observed seconds reserves ten for the human and two for uncertainty',()=>{
  const f=fixture(true);f.observe(12);f.visible();
  assert.equal(f.d.humanFeed.status(f.id).turns[1].minimumRemainingMs,10000);
  const late=fixture(true);late.observe(11.999);late.visible();
  assert.equal(late.d.humanFeed.status(late.id).turns[1].failed,true);
});

test('autodraft and unknown manual mode cannot acknowledge timely human delivery',()=>{
  for(const mode of [{autodraft:true,manualModeKnown:true},{autodraft:false,manualModeKnown:false}]){
    const f=fixture(true);
    f.d.humanFeed.observe(f.id,{observation:{...f.observation(),...mode},picks:[]},f.config.token);
    assert.equal(f.d.humanFeed.status(f.id).fresh,false);
    assert.throws(()=>f.visible(),{code:'HUMAN_DELIVERY_STALE'});
  }
});
