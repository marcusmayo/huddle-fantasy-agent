'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DraftService}=require('../src/services/draft-service');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {viewModel}=require('../public/draft-view-model');
function fixture(){
  let now=Date.parse('2026-09-09T20:00:00Z'),frame=0;
  const league={...require('../config/leagues/yahoo-example.json'),name:'Clock test room',teamCount:8,provenance:{yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1'}};
  const players=Array.from({length:240},(_,i)=>({id:`p${i}`,yahooPlayerKey:`999.p.${i+1000}`,name:`Player ${i}`,position:['QB','RB','WR','TE','RB','WR','K','DEF'][i%8],expertRank:i+1,adp:i+1,projectedPoints:400-i,floor:300-i,ceiling:450-i}));
  const store=new MemoryStateStore(),d=new DraftService({league,playerPool:{players,source:'test',complete:true,season:2026},store,now:()=>new Date(now)});
  const id=d.createSession({draftSlot:1,sourceMode:'yahoo'}).id,token=d.visualClock.pair(id).token;
  const input=(seconds=30)=>({headerText:`Clock test room\n${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}\nYOUR TURN • ROUND 1, PICK 1`,confidence:95,recognitionMs:100,frame:++frame,capturedAt:{earliestMs:now-100,latestMs:now}});
  const observe=(seconds=30,patch={})=>d.visualClock.observe(id,{...input(seconds),...patch},token);
  const confirm=seconds=>{assert.throws(()=>observe(seconds),/Confirming/);now+=400;return observe(seconds);};
  const receipt=(patch={})=>{const w=d.workspace(id);return d.visualClock.delivered(id,{receiptId:require('node:crypto').randomUUID(),epoch:d.visualClock.connections.get(id).epoch,renderBounds:{earliestMs:now,latestMs:now},observationId:w.screenClock.observationId,overallPick:1,recommendationId:w.card.recommendationId,playerIds:[w.card.preferred,w.card.alternatives.safe,w.card.alternatives.upside].map(c=>c.player.id),visible:true,...patch});};
  return {d,id,store,league,input,observe,confirm,receipt,bump:ms=>now+=ms,now:()=>now};
}
test('automatic observed clock gives longer drafts more reserve without delaying the same visible receipt',()=>{
  const results=[];
  for(const seconds of [30,70]){const f=fixture();f.confirm(seconds);f.bump(300);results.push(f.receipt().remainingMs);assert.equal(f.d.controllers.status(f.id).active,false);assert.equal(f.d.decisionSummary(f.id).integrityVerified,true);}
  assert.deepEqual(results,[27600,67600]);
});
test('wrong room, uncertain time, stale frame and timer reset cannot certify delivery',()=>{
  const f=fixture();f.confirm(30);
  assert.throws(()=>f.observe(30,{headerText:'Wrong room\n00:30\nYOUR TURN • ROUND 1, PICK 1'}),/room/);
  assert.equal(f.d.visualClock.status(f.id).fresh,false);
  assert.throws(()=>f.observe(30,{capturedAt:{earliestMs:f.now()-2000,latestMs:f.now()}}),/uncertain/);
  f.bump(100);f.observe(30);f.bump(100);
  assert.throws(()=>f.observe(70),/changed/);f.bump(100);assert.throws(()=>f.observe(70),/reset/);
  assert.throws(()=>f.receipt(),/unverified|fresh/);
});
test('receipt verifies the exact visible card and ten-second minimum, and persistence failure rolls it back',()=>{
  const f=fixture();f.confirm(13);
  assert.throws(()=>f.receipt({visible:false}),/visible/);
  assert.throws(()=>f.receipt({playerIds:['wrong']}),/visible/);
  const save=f.store.save;f.store.save=()=>{throw Error('disk failed');};
  assert.throws(()=>f.receipt(),/disk failed/);assert.equal(f.d.visualClock.status(f.id).turns[1],undefined);
  f.store.save=save;assert.equal(f.receipt().timely,true);
  const late=fixture();late.confirm(12);assert.equal(late.receipt().timely,false);
  assert.deepEqual(late.d.visualClock.status(late.id).failedPicks,[1]);
});
test('clock evidence is durable and omitted from the live payload; missing final turn remains a failure',()=>{
  const f=fixture();f.confirm(30);
  const raw=f.d.state.sessions[f.id];assert.ok(raw.clockEvidence.events.some(e=>e.type==='clock-observed'));
  assert.equal(f.d.workspace(f.id).session.clockEvidence.events,undefined);
  raw.picks.push({overallPick:1,isMine:true,playerId:'p0',playerName:'Player 0'});raw.status='completed';
  assert.deepEqual(f.d.visualClock.status(f.id).failedPicks,[1]);
});
test('human view expires a captured clock after 1.5 seconds even when API checks remain healthy',()=>{
  const f=fixture();f.confirm(30);const w=f.d.workspace(f.id);
  w.context={yahooLeagueKey:f.league.provenance.yahooLeagueKey,yahooTeamKey:f.league.provenance.yahooTeamKey};
  w.apiFeed={enabled:true,recurring:true,state:'running',lastSuccessAt:new Date(f.now()).toISOString()};
  assert.equal(viewModel(w,{now:f.now()}).stale,false);
  const expired=viewModel(w,{now:f.now()+1501});assert.equal(expired.stale,false);assert.match(expired.clock,/unverified/);
  assert.equal(expired.turnAgreement,'unknown');assert.equal(expired.humanRemainingMs,null);
  w.apiFeed.lastSuccessAt=new Date(f.now()-16000).toISOString();assert.equal(viewModel(w,{now:f.now()+1501}).stale,true);
});
test('HTTP clock connection is gated, same-origin and refuses receipts without live results',async()=>{
  const {buildApp}=require('../src/server');const f=fixture();
  const runtime={host:'127.0.0.1',port:0,league:f.league,defaultLeagueId:f.league.id,leagues:[{id:f.league.id,config:f.league,yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1'}],playerPool:{players:[],complete:false},fantasyProsSyncEnabled:false};
  const app=buildApp(runtime,{storeFactory:()=>new MemoryStateStore(),yahooAccount:{status:()=>({connected:false})},yahooOperations:{draftStatus:()=>({recurring:false,state:'stopped'}),start(){},stop(){}}});
  const id=app.draftService.createSession({draftSlot:1,sourceMode:'yahoo'}).id;
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`,url=`${base}/api/leagues/${f.league.id}/draft/sessions/${id}`;
  const post=async(route,origin=base)=>await(await fetch(url+route,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'pair'})})).json();
  try{
    assert.equal((await post('/visual-clock')).error,'VISUAL_CLOCK_DISABLED');runtime.visualClockEnabled=true;
    assert.equal((await post('/visual-clock','http://wrong.test')).error,'CLOCK_ORIGIN');
    assert.ok((await post('/visual-clock')).token);
    assert.equal((await post('/clock-delivery')).error,'CLOCK_RESULTS_STALE');
    const clock=await(await fetch(base+'/api/clock-time')).json();assert.ok(Math.abs(clock.serverWallMs-Date.now())<1000);
  }finally{await new Promise(r=>app.commandRelay.close(r));await new Promise(r=>app.server.close(r));}
});
test('a timely historical render survives delayed acknowledgement but a late render does not',()=>{
  const f=fixture();f.confirm(70);const w=f.d.workspace(f.id),bounds={earliestMs:f.now(),latestMs:f.now()};
  const patch={observationId:w.screenClock.observationId,renderBounds:bounds,receiptId:'timely-then-delayed'};
  f.bump(2500);assert.equal(f.receipt(patch).timely,true);
  assert.equal(f.receipt(patch).applied,false,'idempotent acknowledgement');
  assert.throws(()=>f.receipt({observationId:w.screenClock.observationId}),/fresh/);
});
test('a new connection, future render, and excessive acknowledgement delay cannot fabricate delivery',()=>{
  const f=fixture();f.confirm(30);const w=f.d.workspace(f.id);
  assert.throws(()=>f.receipt({epoch:'old'}),/connection/);
  assert.throws(()=>f.receipt({renderBounds:{earliestMs:f.now()+1000,latestMs:f.now()+1100}}),/fresh/);
  const bounds={earliestMs:f.now(),latestMs:f.now()};f.bump(5001);
  assert.throws(()=>f.receipt({observationId:w.screenClock.observationId,renderBounds:bounds}),/fresh/);
});
test('clock-only observations never request a complete workspace rebuild',()=>{
  const f=fixture();let notifications=0;const unsubscribe=f.d.subscribe(()=>notifications++);
  f.confirm(30);assert.equal(notifications,0);unsubscribe();
});
test('an in-flight timely receipt is not made permanently failed by the next reconciled pick',()=>{
  const f=fixture();f.confirm(30);const w=f.d.workspace(f.id);
  const patch={receiptId:'in-flight',renderBounds:{earliestMs:f.now(),latestMs:f.now()},observationId:w.screenClock.observationId,recommendationId:w.card.recommendationId,playerIds:[w.card.preferred,w.card.alternatives.safe,w.card.alternatives.upside].map(c=>c.player.id)};
  f.bump(100);const s=f.d.state.sessions[f.id];s.picks.push({overallPick:1,isMine:true,playerId:'p0',playerName:'Player 0'});
  s.timingEvidence={events:[{type:'board-reconciled',pickCount:1,at:new Date(f.now()).toISOString()}]};
  assert.deepEqual(f.d.visualClock.status(f.id).failedPicks,[]);f.bump(1000);
  assert.equal(f.receipt(patch).timely,true);f.bump(5000);assert.deepEqual(f.d.visualClock.status(f.id).failedPicks,[]);
});


test('two verified advance frames wake results once without certifying an unreconciled board',()=>{
 const f=fixture(),calls=[];f.d.visualClock.onBoardAdvance=(id,pick)=>calls.push({id,pick});
 const patch={headerText:"Clock test room\n00:30\nOpponent's Pick • You're up in 7 Picks • ROUND 1, PICK 2"};
 assert.throws(()=>f.observe(30,patch),/matching/);f.bump(200);
 assert.throws(()=>f.observe(30,patch),/matching/);assert.deepEqual(calls,[{id:f.id,pick:2}]);
 assert.equal(f.d.visualClock.status(f.id).fresh,false);f.bump(200);
 assert.throws(()=>f.observe(30,patch),/matching/);assert.equal(calls.length,1);
 assert.throws(()=>f.receipt(),/fresh/);
});
test('wrong room and owner cannot trigger a results wake',()=>{
 const f=fixture(),calls=[];f.d.visualClock.onBoardAdvance=()=>calls.push(1);
 for(const headerText of ["Wrong room\n00:30\nOpponent's Pick • You're up in 7 Picks • ROUND 1, PICK 2","Clock test room\n00:30\nYOUR TURN • ROUND 1, PICK 2"]){for(let i=0;i<2;i++){assert.throws(()=>f.observe(30,{headerText}));f.bump(200);}}
 assert.equal(calls.length,0);
});
