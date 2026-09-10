'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {YahooReadOnlyClient,YahooDraftPoller,extractDraftResults}=require('../src/providers/yahoo');
const {DraftService}=require('../src/services/draft-service');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {viewModel}=require('../public/draft-view-model');
test('the whole Yahoo read is bounded including credentials and response body',async()=>{
 const bodyClient=new YahooReadOnlyClient({accessToken:'test',fetchImpl:async()=>({ok:true,json:()=>new Promise(()=>{})})});
 await assert.rejects(bodyClient.get('/test',{requestTimeoutMs:20,maxAttempts:1}),{code:'YAHOO_REQUEST_TIMEOUT'});
 let requests=0,resolveToken;const tokenClient=new YahooReadOnlyClient({tokenProvider:()=>new Promise(r=>{resolveToken=r;}),fetchImpl:async()=>{requests++;}});
 await assert.rejects(tokenClient.get('/test',{requestTimeoutMs:20,maxAttempts:1}),{code:'YAHOO_REQUEST_TIMEOUT'});
 resolveToken('test');await new Promise(r=>setImmediate(r));assert.equal(requests,0,'Late credentials must not initiate an abandoned read');
});
test('draft reads use a short single attempt and do not invent a source timestamp',async()=>{
 const client=new YahooReadOnlyClient();let options;client.get=async(_path,o)=>{options=o;return {};};
 const result=await client.draftResults('999.l.1');assert.deepEqual(options,{maxAttempts:1,requestTimeoutMs:4000});
 assert.ok(result.receivedAt);assert.equal(result.sourceTimestamp,undefined);assert.equal(result.secondsLeft,undefined);
});
test('rate-limit backoff information survives a draft read',async()=>{
 const client=new YahooReadOnlyClient({accessToken:'test',fetchImpl:async()=>({ok:false,status:429,headers:{get:()=> '12'}})});
 await assert.rejects(client.draftResults('999.l.1'),e=>e.code==='YAHOO_RATE_LIMITED'&&e.retryAfterMs===12000&&e.attempts===1);
});
test('conflicting duplicate results and gaps cannot be certified as a successful board read',async()=>{
 assert.throws(()=>extractDraftResults([{pick:1,player_key:'999.p.1',team_key:'999.l.1.t.1'},{pick:1,player_key:'999.p.2',team_key:'999.l.1.t.1'}]),{code:'YAHOO_DRAFT_CONFLICT'});
 const league={...require('../config/leagues/yahoo-example.json'),teamCount:2,roster:{QB:1,BN:1}},players=[{id:'p1',yahooPlayerKey:'999.p.1',name:'One',position:'QB'}];
 const d=new DraftService({league,playerPool:{players},store:new MemoryStateStore()}),s=d.createSession({draftSlot:1,sourceMode:'yahoo'});
 let picks=[{overallPick:2,teamKey:'999.l.1.t.1',yahooPlayerKey:'999.p.1'}];
 const poller=new YahooDraftPoller({client:{draftResults:async()=>({picks})},leagueKey:'999.l.1',sessionId:s.id,draftService:d,playerPool:{players},targetTeamKey:'999.l.1.t.1'});
 await assert.rejects(poller.syncOnce(),{code:'YAHOO_DRAFT_INVALID'});assert.equal(d.getSession(s.id).picks.length,0);
 picks=[{overallPick:1,teamKey:'999.l.1.t.1',yahooPlayerKey:'999.p.1'}];await poller.syncOnce();picks=[];
 await assert.rejects(poller.syncOnce(),{code:'YAHOO_DRAFT_INCOMPLETE'});assert.equal(d.getSession(s.id).picks.length,1);
});
test('a fresh API response does not imply a fresh live clock or ten seconds to select',()=>{
 const now=Date.now(),w={session:{sourceMode:'yahoo',status:'active',picks:[],draftSlot:1},card:{alternatives:{}},decisions:{events:[]},
   context:{},apiFeed:{enabled:true,recurring:true,state:'running',lastSuccessAt:new Date(now).toISOString()},
   controller:{active:false,observation:{observedAt:new Date(now).toISOString(),overallPick:1,secondsLeft:70}}};
 const m=viewModel(w,{now,receivedAt:now});assert.equal(m.stale,false);assert.match(m.feed,/live freshness unverified/);
 assert.match(m.deliveryMessage,/not verified/);assert.equal(m.humanRemainingMs,null);assert.match(m.clock,/unverified/);
 assert.equal(viewModel(w,{now:now+16000,receivedAt:now+16000}).stale,true);
});
test('the app has no extension installation or connection-file flow',()=>{
 const html=fs.readFileSync(require.resolve('../public/draft-view.html'),'utf8'),js=fs.readFileSync(require.resolve('../public/draft-view.js'),'utf8');
 assert.doesNotMatch(html,/human-pair|human-setup|connection file|companion/i);assert.doesNotMatch(js,/createObjectURL|human-pair|\.download=/);
});
test('human mock mode exposes missing or stale observations without asking for an execution controller',()=>{
 const now=Date.now(),w={session:{sourceMode:'mock',status:'active',picks:[],draftSlot:8},card:{alternatives:{}},decisions:{events:[]}};
 let m=viewModel(w,{now});assert.equal(m.stale,true);assert.equal(m.humanMode,true);assert.match(m.controllerStatus,/You make/);assert.match(m.reason,/browser observation/);
 w.session.mockRoom={observedAt:new Date(now).toISOString(),autodraft:false};assert.equal(viewModel(w,{now}).stale,false);assert.equal(viewModel(w,{now:now+5001,receivedAt:now+5001}).stale,true);
});
