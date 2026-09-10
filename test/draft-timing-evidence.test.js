'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DraftTimingEvidence}=require('../src/services/draft-timing-evidence');
test('collector records beyond seven minutes without restarting and detects sampling gaps',()=>{
  let wall=0,mono=0,saves=0;const state={};const make=()=>new DraftTimingEvidence({session:()=>state,persist:()=>saves++,now:()=>wall,mono:()=>mono});
  const log=make();log.start();
  for(let i=0;i<100;i++){wall=mono=i*5000;log.readStarted();wall=mono+=120;log.result({pickCount:i});}
  assert.equal(state.timingEvidence.incomplete,false);assert.equal(saves,201);
  wall=mono+=84000;log.readStarted();assert.equal(state.timingEvidence.incomplete,true);
  assert.equal(state.timingEvidence.events.filter(e=>e.type==='sampling-gap').length,1);
  const resumed=make();resumed.start();assert.ok(state.timingEvidence.events.some(e=>e.type==='interruption'));
  assert.deepEqual(state.timingEvidence.events.map(e=>e.sequence),Array.from({length:state.timingEvidence.events.length},(_,i)=>i+1));
});
test('watchdog exposes stale evidence and completion remains durable',()=>{
  let now=0;const state={};const log=new DraftTimingEvidence({session:()=>state,persist:()=>{},now:()=>now,mono:()=>now});log.start();
  now=11000;assert.equal(log.health().healthy,false);
  log.record('completed',{pickCount:120});now=900000;assert.equal(log.health().complete,true);assert.equal(log.health().healthy,true);
});
test('failed persistence cannot leave an apparently saved event',()=>{
  const state={};const log=new DraftTimingEvidence({session:()=>state,persist:()=>{throw Error('disk full');}});
  assert.throws(()=>log.start(),/disk full/);assert.equal(state.timingEvidence,undefined);
});
