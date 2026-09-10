'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DraftService}=require('../src/services/draft-service');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {digest}=require('../src/domain/decision-audit');
const {openHostedSession}=require('../src/services/hosted-draft-session');
const {saveDraftReport}=require('../src/services/draft-report');
function fixture(){const league={...require('../config/leagues/yahoo-example.json'),id:'hosted-test',provenance:{yahooLeagueKey:'470.l.1',yahooTeamKey:'470.l.1.t.1'}};
 const store=new MemoryStateStore(),args={league,store,playerPool:{players:Array.from({length:40},(_,i)=>({id:'p'+i,name:'Player '+i,position:['QB','RB','WR','TE','K','DEF'][i%6],projectedPoints:300-i,expertRank:i+1,adp:i+1})),source:'test',complete:true}};
 const service=new DraftService(args),request={draftSlot:1,leagueKey:'470.l.1',teamKey:'470.l.1.t.1',rulesHash:digest(league)};
 return {service,store,args,request};}
test('hosted session resumes its exact identity and preserves a picked player after reconstruction',()=>{
 const f=fixture(),s=openHostedSession({service:f.service,...f.request,mode:'create'});f.service.recordPick(s.id,{playerId:'p0'});
 const rebuilt=new DraftService(f.args),r=openHostedSession({service:rebuilt,...f.request,mode:'resume',sessionId:s.id});assert.equal(r.picks.length,1);assert.equal(r.id,s.id);
 assert.throws(()=>openHostedSession({service:rebuilt,...f.request,mode:'create'}),{code:'HOSTED_SESSION_IDENTITY'});
 for(const patch of [{draftSlot:2},{rulesHash:'changed'},{teamKey:'470.l.1.t.2'}])assert.throws(()=>openHostedSession({service:rebuilt,...f.request,mode:'resume',sessionId:s.id,...patch}),{code:'HOSTED_SESSION_IDENTITY'});
});
test('report preserves unknown actor/timing, validates file checksums and survives restart',()=>{
 const f=fixture(),s=openHostedSession({service:f.service,...f.request,mode:'create'});f.service.recordPick(s.id,{playerId:'p0'});
 f.service.state.sessions[s.id].accessToken='SECRET-CANARY';
 const report=saveDraftReport(f.service,s.id);assert.equal(report.report.manualSelectionVerified,false);assert.ok(report.report.missingReceiptPicks.includes(1));assert.equal(report.report.completed,false);assert.equal(report.report.owned[0].outcome,'accepted-unattributed');assert.equal(report.report.owned.at(-1).outcome,'not-reconciled');
 assert.equal(JSON.stringify(report).includes('SECRET-CANARY'),false);
 for(const [name,body]of Object.entries(report.files))assert.equal(require('node:crypto').createHash('sha256').update(body).digest('hex'),report.checksums[name]);
 const rebuilt=new DraftService(f.args);assert.equal(rebuilt.state.reportExports[s.id].artifactId,report.artifactId);
});
test('completed sessions remain completed; corrupted identity and board are rejected',()=>{
 const f=fixture(),s=openHostedSession({service:f.service,...f.request,mode:'create'});
 f.service.state.sessions[s.id].status='completed';f.service.persist();
 assert.equal(openHostedSession({service:new DraftService(f.args),...f.request,mode:'resume',sessionId:s.id}).status,'completed');
 f.service.state.hostedDraftIdentity.version=2;f.service.persist();
 assert.throws(()=>openHostedSession({service:new DraftService(f.args),...f.request,mode:'resume',sessionId:s.id}),{code:'HOSTED_SESSION_IDENTITY'});
});
test('preparation writes identity and session atomically and rolls back failed storage',()=>{
 const f=fixture();let writes=0;f.store.save=state=>{writes++;assert.equal(Object.keys(state.sessions)[0],state.hostedDraftIdentity.sessionId);throw Error('disk failure');};
 assert.throws(()=>openHostedSession({service:f.service,...f.request,mode:'create'}),/disk failure/);assert.equal(writes,1);assert.deepEqual(f.service.state.sessions,{});assert.equal(f.service.state.hostedDraftIdentity,undefined);
});
test('reports retain earlier immutable artifacts after the board advances',()=>{
 const f=fixture(),s=openHostedSession({service:f.service,...f.request,mode:'create'}),first=saveDraftReport(f.service,s.id);
 f.service.recordPick(s.id,{playerId:'p0'});const second=saveDraftReport(f.service,s.id);
 assert.notEqual(first.artifactId,second.artifactId);assert.deepEqual(f.service.state.reportArchive[first.artifactId],first);assert.equal(second.report.buildIdentity,s.buildIdentity);
});
