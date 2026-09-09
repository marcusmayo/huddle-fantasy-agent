'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {viewModel}=require('../public/draft-view-model');
const now=Date.parse('2026-09-09T00:00:00Z');
function room(){return {session:{id:'one',sourceMode:'yahoo',status:'active',picks:[],totalPicks:120},
  card:{preferred:{player:{name:'Preferred'}},alternatives:{}},context:{sync:{recurring:true,lastSuccessAt:new Date(now).toISOString()}},
  decisions:{events:[],integrityVerified:true}};}
test('draft view ages the board and the Yahoo feed independently and recovers on the next good read',()=>{
  const w=room();assert.equal(viewModel(w,{now,receivedAt:now}).stale,false);
  assert.equal(viewModel(w,{now:now+7000,receivedAt:now}).stale,true);
  w.context.sync.lastSuccessAt=new Date(now-30000).toISOString();
  assert.equal(viewModel(w,{now,receivedAt:now}).stale,true);
  w.context.sync.lastSuccessAt=new Date(now).toISOString();
  assert.equal(viewModel(w,{now,receivedAt:now,error:'Update timed out'}).stale,true);
  assert.equal(viewModel(w,{now,receivedAt:now}).stale,false);
  w.context.sync.recurring=false;assert.equal(viewModel(w,{now,receivedAt:now}).stale,true);
});
test('audible and uncertain submission remain visible; the observed clock expires rather than being invented',()=>{
  const w=room();w.decisions.events=[{type:'plan',hash:'p',overallPick:1,classification:'audible',playerName:'Selected',recommendedPlayer:'Preferred',reason:'Fresh evidence changed the choice.',
    yahooObservation:{observedAt:new Date(now).toISOString(),overallPick:1,secondsLeft:20}},
    {type:'submit-uncertain',planId:'p'}];
  const m=viewModel(w,{now:now+2000,receivedAt:now});
  assert.equal(m.classification,'AUDIBLE');assert.equal(m.decision.playerName,'Selected');assert.equal(m.recommended,'Preferred');
  assert.match(m.decisionStatus,/uncertain/);assert.match(m.clock,/18s/);
  assert.match(viewModel(w,{now:now+6000,receivedAt:now}).clock,/unverified/);
});
test('completed screen keeps all twenty owned picks and final acceptance without a phantom pick or clock',()=>{
  const w=room();w.session.status='completed';w.session.picks=Array.from({length:120},(_,i)=>({overallPick:i+1,isMine:i%12===0||i%12===11,playerName:`Player ${i+1}`}));
  w.decisions.lastAccepted={type:'accepted',overallPick:120,classification:'huddle',playerName:'Final Player'};
  const m=viewModel(w,{now,receivedAt:now});
  assert.equal(m.current,null);assert.equal(m.owned.length,20);assert.equal(m.recent[0].overallPick,120);
  assert.equal(m.clock,'Draft finished');assert.match(m.feed,/120\/120/);assert.equal(m.decision.playerName,'Final Player');
});

test('cached active control expires at the server heartbeat deadline even without another response',()=>{
  const w=room();w.controller={active:true,stage:'watching',heartbeatAgeMs:4000,expiresAfterMs:10000};
  assert.equal(viewModel(w,{now:now+5999,receivedAt:now}).controllerActive,true);
  const expired=viewModel(w,{now:now+6000,receivedAt:now});
  assert.equal(expired.controllerActive,false);assert.match(expired.controllerStatus,/heartbeat expired/);
  assert.equal(viewModel(w,{now:now+6000,receivedAt:now+3000,requestedAt:now}).controllerActive,false,
    'A delayed response must not extend the heartbeat deadline');
  assert.equal(viewModel(w,{now,receivedAt:now,error:'Read timed out'}).controllerActive,false);
  assert.match(viewModel(w,{now,receivedAt:now,error:'Read timed out'}).controllerStatus,/unverified/);
  w.controller.heartbeatAgeMs=0;
  assert.equal(viewModel(w,{now:now+7000,receivedAt:now+7000}).controllerActive,true);
  for(const invalid of [undefined,null,-1,NaN,'0']){
    w.controller.heartbeatAgeMs=invalid;
    assert.equal(viewModel(w,{now,receivedAt:now}).controllerActive,false);
  }
  w.controller.heartbeatAgeMs=0;w.session.status='completed';
  assert.equal(viewModel(w,{now,receivedAt:now}).controllerActive,false);
});

test('confirmed pre-input cancellation stays visible and abandonment cannot hide uncertain input',()=>{
  const w=room();w.decisions.events=[{type:'plan',hash:'p',overallPick:1,playerName:'Choice'},
    {type:'submit-started',planId:'p'},{type:'input-not-dispatched',planId:'p'}];
  assert.match(viewModel(w,{now,receivedAt:now}).decisionStatus,/Cancelled before input/);
  assert.equal(viewModel(w,{now,receivedAt:now}).decision.playerName,'Choice');
  w.decisions.events.splice(2,1,{type:'submit-uncertain',planId:'p'},{type:'abandoned',planId:'p'});
  assert.match(viewModel(w,{now,receivedAt:now}).decisionStatus,/uncertain/);
});
