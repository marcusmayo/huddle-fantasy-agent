'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DraftService}=require('../src/services/draft-service');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {roleManifest}=require('../src/services/draft-controller-service');
function fixture(){
  let time=Date.parse('2026-09-09T00:00:00Z');
  const league={...require('../config/leagues/yahoo-example.json'),provenance:{yahooLeagueKey:'nfl.l.1',yahooTeamKey:'nfl.l.1.t.1'}};
  const playerPool=structuredClone(require('../config/fixtures/demo-players.json'));playerPool.players.forEach((p,i)=>p.yahooPlayerKey=`nfl.p.${100+i}`);
  const args={league,playerPool,store:new MemoryStateStore(),now:()=>new Date(time)};
  const drafts=new DraftService(args),session=drafts.createSession({draftSlot:1,sourceMode:'yahoo'});
  const observation=()=>({observedAt:new Date(time).toISOString(),completedPicks:0,overallPick:1,phase:'waiting',autodraft:false,manualModeKnown:true,draftSlot:1,onClock:false,leagueKey:'nfl.l.1',teamKey:'nfl.l.1.t.1'});
  const roles=[{role:'yahoo',browserId:'edge',tabId:'y',url:'https://football.fantasysports.yahoo.com/draftclient/f1/1/1?auth=DO-NOT-SAVE'},
    {role:'huddle',browserId:'edge',tabId:'h',url:'http://localhost:8787/draft-view.html'}];
  const prepared=[{yahooPlayerId:'100',name:'Choice',position:'RB'},{yahooPlayerId:'101',name:'Fallback',position:'RB'}];
  const start=()=>({action:'start',controllerId:'draft-controller',handoffAccepted:true,roles,prepared,observation:observation(),
    availableObservation:{...observation(),players:prepared.map(p=>({...p,available:true}))}});
  return {drafts,session,args,roles,observation,start,advance:ms=>time+=ms};
}
test('opening control works without a recorder and needs handoff, protected app tabs, two prepared choices and a fresh correct room',()=>{
  const f=fixture(),control=f.drafts.controllers,id=f.session.id;
  assert.equal(control.status(id).active,false);
  assert.throws(()=>control.update(id,{...f.start(),handoffAccepted:false}),{code:'CONTROLLER_HANDOFF_REQUIRED'});
  assert.throws(()=>control.update(id,{...f.start(),prepared:[]}),{code:'CONTROLLER_PREPARED_PICK_REQUIRED'});
  assert.throws(()=>control.update(id,{...f.start(),observation:{...f.observation(),draftSlot:2}}),{code:'CONTROLLER_SEAT_MISMATCH'});
  assert.deepEqual(f.start().roles.map(role=>role.role),['yahoo','huddle']);
  for(const missing of ['yahoo','huddle'])assert.throws(()=>control.update(id,{...f.start(),roles:f.roles.filter(role=>role.role!==missing)}),{code:'CONTROLLER_ROLES_REQUIRED'});
  const started=control.update(id,f.start());assert.equal(started.active,true);assert.ok(started.token);
  assert.throws(()=>control.update(id,f.start()),{code:'CONTROLLER_ALREADY_ACTIVE'});
  assert.doesNotMatch(JSON.stringify(f.args.store.load()),/DO-NOT-SAVE/);
  assert.doesNotMatch(JSON.stringify(control.status(id)),new RegExp(started.token));
});
test('heartbeat expiry and process restart require a new verified handoff rather than reviving old control',()=>{
  const f=fixture(),id=f.session.id,lease=f.drafts.controllers.update(id,f.start());
  f.advance(11000);assert.equal(f.drafts.controllers.status(id).active,false);
  assert.throws(()=>f.drafts.controllers.update(id,{action:'heartbeat',token:lease.token,observation:f.observation()}),{code:'CONTROLLER_LEASE_EXPIRED'});
  const restarted=new DraftService(f.args);
  assert.equal(restarted.controllers.status(id).active,false);assert.equal(restarted.controllers.status(id).roles.length,2);
  assert.throws(()=>restarted.controllers.update(id,{action:'heartbeat',token:lease.token,observation:f.observation()}),{code:'CONTROLLER_LEASE_REQUIRED'});
  const fresh=restarted.controllers.update(id,f.start());assert.equal(fresh.active,true);
  assert.notEqual(fresh.runId,lease.runId);
  assert.throws(()=>restarted.controllers.assertLease(id,fresh.token,{controllerId:lease.controllerId,controllerRunId:lease.runId}),{code:'CONTROLLER_RUN_MISMATCH'});
});
test('stale or wrong-board observations cannot renew a lease; stop revokes computer-use submission',()=>{
  const f=fixture(),id=f.session.id,lease=f.drafts.controllers.update(id,f.start()),old=f.observation();
  f.advance(6000);
  assert.throws(()=>f.drafts.controllers.update(id,{action:'heartbeat',token:lease.token,observation:old}),{code:'CONTROLLER_OBSERVATION_STALE'});
  assert.throws(()=>f.drafts.controllers.update(id,{action:'heartbeat',token:lease.token,observation:{...f.observation(),completedPicks:1}}),{code:'CONTROLLER_BOARD_MISMATCH'});
  assert.equal(f.drafts.controllers.update(id,{action:'heartbeat',token:lease.token,observation:f.observation(),stage:'preparing'}).active,true);
  f.drafts.controllers.update(id,{action:'stop',token:lease.token});
  assert.throws(()=>f.drafts.controllers.assertLease(id,lease.token),{code:'CONTROLLER_LEASE_REQUIRED'});
  assert.throws(()=>f.drafts.controllers.update(id,{action:'heartbeat',token:lease.token,observation:f.observation()}),{code:'CONTROLLER_HANDOFF_REQUIRED'});
});
test('failed checkpoint persistence does not activate the controller',()=>{
  const f=fixture();f.args.store.save=()=>{throw Error('disk failure');};
  assert.throws(()=>f.drafts.controllers.update(f.session.id,f.start()),/disk failure/);
  assert.equal(f.drafts.controllers.status(f.session.id).active,false);
  assert.equal(f.drafts.state.sessions[f.session.id].controllerCheckpoint,undefined);
  assert.equal(f.drafts.decisionSummary(f.session.id).events.length,0);
});
test('role manifests reject collisions and non-draft Yahoo surfaces',()=>{
  const f=fixture();
  assert.throws(()=>roleManifest(f.roles.map(r=>({...r,browserId:'one',tabId:'same'}))),{code:'CONTROLLER_ROLE_COLLISION'});
  assert.throws(()=>roleManifest(f.roles.map(r=>r.role==='yahoo'?{...r,url:'https://football.fantasysports.yahoo.com/f1/1'}:r)),{code:'CONTROLLER_YAHOO_ROOM_REQUIRED'});
  assert.throws(()=>roleManifest(f.roles,'nfl.l.2'),{code:'CONTROLLER_ROOM_MISMATCH'});
});

test('an explicitly simulated room stays on loopback and a Huddle iframe is a distinct protected surface',()=>{
  const f=fixture(),roles=f.roles.map(r=>r.role==='yahoo'?{...r,url:'http://127.0.0.1:8792/draftclient/f1/1/1'}:
    r.role==='huddle'?{...r,browserId:'edge',tabId:'y',frameSelector:'iframe[title="Huddle draft view"]'}:r);
  assert.throws(()=>roleManifest(roles,'nfl.l.1'),{code:'CONTROLLER_YAHOO_ROOM_REQUIRED'});
  const result=roleManifest(roles,'nfl.l.1',{simulation:true});assert.equal(result[0].simulation,true);assert.ok(result[1].frameSelector);
  assert.throws(()=>roleManifest(f.roles,'nfl.l.1',{simulation:true}),{code:'CONTROLLER_YAHOO_ROOM_REQUIRED'});
});

test('small browser clock skew is accepted without permitting stale or far-future availability',()=>{
  const f=fixture(),input=f.start();
  input.observation.observedAt=new Date(Date.parse(input.observation.observedAt)+3).toISOString();
  input.availableObservation.observedAt=input.observation.observedAt;
  assert.equal(f.drafts.controllers.update(f.session.id,input).active,true);
  f.advance(6000);
  assert.throws(()=>f.drafts.controllers.update(f.session.id,{action:'heartbeat',token:f.drafts.controllers.leases.get(f.session.id).token,observation:input.observation}),{code:'CONTROLLER_OBSERVATION_STALE'});
});

test('prepared choices need fresh unambiguous available rows and turn ownership must agree',()=>{
  const f=fixture(),start=f.start(),id=f.session.id;
  assert.throws(()=>f.drafts.controllers.update(id,{...start,availableObservation:null}),{code:'CONTROLLER_AVAILABILITY_REQUIRED'});
  for(const change of [p=>({...p,available:false}),p=>({...p,name:'Another player'}),p=>({...p,position:'QB'})]){
    assert.throws(()=>f.drafts.controllers.update(id,{...start,availableObservation:{...start.availableObservation,players:start.availableObservation.players.map(change)}}),{code:'CONTROLLER_PREPARED_IDENTITY_MISMATCH'});
  }
  assert.throws(()=>f.drafts.controllers.update(id,{...start,observation:{...f.observation(),phase:'drafting',secondsLeft:30,onClock:false}}),{code:'CONTROLLER_TURN_MISMATCH'});
  assert.equal(f.drafts.controllers.update(id,{...start,observation:{...f.observation(),phase:'drafting',secondsLeft:30,onClock:true}}).active,true);
});
