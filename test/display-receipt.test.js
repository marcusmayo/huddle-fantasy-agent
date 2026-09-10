'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DraftService}=require('../src/services/draft-service');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {viewModel}=require('../public/draft-view-model');
function fixture(){
 const store=new MemoryStateStore(),league={...require('../config/leagues/yahoo-example.json'),teamCount:2};
 const players=Array.from({length:40},(_,i)=>({id:`p${i}`,name:`Player ${i}`,position:['QB','RB','WR','TE','K','DEF'][i%6],projectedPoints:300-i,expertRank:i+1,adp:i+1}));
 const d=new DraftService({league,playerPool:{players,source:'test',complete:true},store});
 const id=d.createSession({draftSlot:1,sourceMode:'yahoo'}).id,card=d.workspace(id).card;
 const input={receiptId:'display-1',recommendationId:card.recommendationId,overallPick:1,renderedAt:new Date().toISOString(),visible:true,playerIds:[card.preferred,card.alternatives.safe,card.alternatives.upside].map(x=>x.player.id),panels:['preferred','safe','upside','reasons','recent','roster'].map(id=>({id,visible:true}))};
 return {d,id,store,input};
}
test('clock-independent display receipts are idempotent, integrity checked and never certify selection timing',()=>{
 const {d,id,input}=fixture();assert.equal(d.recordDisplay(id,input).timing,'unknown');assert.equal(d.recordDisplay(id,input).applied,false);
 const events=d.decisionSummary(id).events.filter(x=>x.type==='recommendation-displayed');assert.equal(events.length,1);assert.equal(events[0].timely,undefined);assert.equal(events[0].timing,'unknown');assert.equal(d.decisionSummary(id).integrityVerified,true);
});
test('wrong players, clipped panels, invalid timestamps and storage failure cannot save display evidence',()=>{
 const {d,id,input,store}=fixture();
 for(const patch of [{playerIds:['wrong']},{panels:[]},{renderedAt:'invalid'},{overallPick:2},{visible:false}])assert.throws(()=>d.recordDisplay(id,{...input,...patch}),/matching/);
 store.save=()=>{throw Error('disk failure');};assert.throws(()=>d.recordDisplay(id,input),/disk failure/);assert.equal(d.decisionSummary(id).events.filter(x=>x.type==='recommendation-displayed').length,0);
});

test('delayed visibility survives board advancement without becoming current or timely',()=>{
 const {d,id,input}=fixture();d.recordPick(id,{playerId:input.playerIds[0]});
 const result=d.recordDisplay(id,{...input,renderedAt:new Date(Date.now()-20000).toISOString()});
 assert.equal(result.displayState,'historical');assert.equal(result.timeStatus,'unverified');assert.equal(result.timing,'unknown');
 assert.equal(d.decisionSummary(id).integrityVerified,true);
});
test('receipt failures retain the particular rejection condition',()=>{
 const {d,id,input}=fixture();assert.throws(()=>d.recordDisplay(id,{...input,playerIds:['wrong']}),e=>e.code==='DISPLAY_RECEIPT_INVALID'&&e.details.reason==='player-mismatch');
});
test('a receipt ID cannot acknowledge a different render',()=>{
 const {d,id,input}=fixture();d.recordDisplay(id,input);
 assert.throws(()=>d.recordDisplay(id,{...input,overallPick:2}),e=>e.details.reason==='receipt-id-conflict');
});
test('failed optional clock cannot invalidate healthy results, but stale results still invalidate recommendations',()=>{
 const {d,id}=fixture(),now=Date.now(),w=d.workspace(id);w.context={};w.apiFeed={enabled:true,recurring:true,state:'running',lastSuccessAt:new Date(now).toISOString()};w.screenClock={enabled:true,fresh:false,observation:null,turns:{}};
 assert.equal(viewModel(w,{now}).stale,false);assert.match(viewModel(w,{now}).deliveryMessage,/timing.*unverified/);
 w.apiFeed.lastSuccessAt=new Date(now-20000).toISOString();assert.equal(viewModel(w,{now}).stale,true);
});

test('clock-disabled diagnostics retain skip reasons, deduplicate batches and roll back on storage failure',()=>{
 const {d,id,store}=fixture();const e={id:'one',type:'receipt-skipped',wallMs:Date.now(),monoMs:23,overallPick:1,reason:'panels-clipped',secret:'must not persist'};
 d.recordDisplayTrace(id,{events:[e],lost:0});d.recordDisplayTrace(id,{events:[e],lost:0});
 const saved=d.exportDecisionAudit(id).displayDiagnostics;assert.equal(saved.events.length,1);assert.equal(saved.events[0].reason,'panels-clipped');assert.equal(saved.events[0].secret,undefined);
 assert.equal(d.getSession(id).displayDiagnostics.events,undefined,'Do not resend the diagnostic log in every recommendation');
 store.save=()=>{throw Error('disk failure');};assert.throws(()=>d.recordDisplayTrace(id,{events:[{...e,id:'two'}],lost:0}));assert.equal(d.getSession(id).displayDiagnostics.sequence,1);
});

test('connection recovery and superseded revisions survive evidence export',()=>{
 const {d,id}=fixture();const base={wallMs:Date.now(),monoMs:1};
 d.recordDisplayTrace(id,{events:[{...base,id:'error',type:'connection-error',status:503,reason:'offline'},
 {...base,id:'recovered',type:'workspace-received',transport:'poll'},
 {...base,id:'revision',type:'render-superseded',recommendationId:'old',currentRecommendationId:'new'}]});
 const events=d.exportDecisionAudit(id).displayDiagnostics.events;
 assert.equal(events.length,3);assert.equal(events[0].status,503);assert.equal(events[1].transport,'poll');assert.equal(events[2].currentRecommendationId,'new');
});
