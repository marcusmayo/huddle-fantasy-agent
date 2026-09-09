'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let createHuddleDraftDisplay;
test.before(async () => ({createHuddleDraftDisplay}=await import('../scripts/huddle-draft-display-cua.mjs')));
const expected={planId:'a'.repeat(64),recommendationId:'b'.repeat(64),overallPick:8,preferred:'Preferred Player',selected:'Selected Player'};
const ready={...expected,safe:'Safer Player',upside:'Upside Player',allPanelsInFrame:true,stale:false};
function fixture(views=[ready,ready]) {
  let time=0,index=0;const waits=[],budgets=[];
  const tab={playwright:{
    locator:()=>{throw Error('BODY is not an accessible element in this browser');},
    evaluate:async(fn,arg,options)=>{budgets.push(options.timeoutMs);return structuredClone(views[Math.min(index++,views.length-1)]);},
    waitForTimeout:async ms=>{waits.push(ms);time+=ms;}
  }};
  return {display:createHuddleDraftDisplay({tab,now:()=>time}),waits,budgets};
}
test('page display reads bypass inaccessible BODY locators and retain a stable exact revision',async()=>{
  const f=fixture([{...ready,recommendationId:'c'.repeat(64)},ready,ready]);
  assert.equal((await f.display.confirm(expected)).recommendationId,expected.recommendationId);
  assert.deepEqual(f.waits,[80,400]);assert.equal(f.display.observations().length,1);
  assert.ok(f.budgets[2]<f.budgets[0]);
});
test('display confirmation rejects stale, clipped, mismatched and changing decisions',async()=>{
  for(const change of [{stale:true},{allPanelsInFrame:false},{preferred:'Wrong Player'}]) {
    const f=fixture([{...ready,...change}]);
    await assert.rejects(f.display.confirm(expected),{code:'DISPLAY_NOT_READY'});assert.equal(f.display.observations().length,0);
  }
  const f=fixture([ready,{...ready,selected:'Different Player'}]);
  await assert.rejects(f.display.confirm(expected),{code:'DISPLAY_CHANGED'});assert.equal(f.display.observations().length,0);
});
test('display rendering and stability share one deadline and respect cancellation',async()=>{
  const missing=fixture([{...ready,recommendationId:''}]);
  await assert.rejects(missing.display.confirm(expected,{timeoutMs:240}),{code:'DISPLAY_DEADLINE'});
  const short=fixture();await assert.rejects(short.display.confirm(expected,{timeoutMs:400}),{code:'DISPLAY_DEADLINE'});
  const cancelled=fixture();await assert.rejects(cancelled.display.confirm(expected,{signal:AbortSignal.abort()}),{code:'DISPLAY_DEADLINE'});
  assert.equal(cancelled.budgets.length,0);
});
