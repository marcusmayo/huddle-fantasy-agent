'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createYahooMockLoop} = require('../scripts/yahoo-mock-cua-loop');

function setup({notice=true,acknowledge=true}={}) {
  const ui={inactivityNotice:notice,autoKnown:true,autodraft:true,header:'Waiting room'};
  const actions=[];
  const locator=selector=>({filter(){return this;},async click(){
    actions.push(selector);
    if(selector==='button') ui.inactivityNotice=false;
    else if(!ui.inactivityNotice&&acknowledge)ui.autodraft=false;
  }});
  const run=createYahooMockLoop({yahoo:{playwright:{locator,waitForTimeout:async()=>{if(!acknowledge)throw Error('Mode not acknowledged');}}},huddle:{},roomId:'1234',draftSlot:8,rules:{}});
  run.inspect=async()=>({...ui});
  return {run,ui,actions};
}
test('dismisses the non-dialog inactivity notice before restoring manual mode',async()=>{
  const {run,actions}=setup();
  assert.equal((await run.recoverManual()).autodraft,false);
  assert.deepEqual(actions,['button','button[title="Autodraft"]']);
});
test('unacknowledged manual mode never advances to selection',async()=>{
  const {run}=setup({notice:false,acknowledge:false});
  let selected=false;run.window=async()=>{selected=true;};
  await assert.rejects(run.startVerified(),/not acknowledged/);
  assert.equal(selected,false);
});
test('an opening live turn proceeds to selection without returning a preflight card',async()=>{
  const {run,ui}=setup({notice:false});ui.autodraft=false;ui.header='00:14\nYOUR TURN • ROUND 1, PICK 8';
  let selected=false;run.window=async()=>{selected=true;return {manualVerified:2};};
  assert.deepEqual(await run.startVerified(),{manualVerified:2});
  assert.equal(selected,true);
});
test('completed roster is not reported fully manual when opening picks were unverified',async()=>{
  const {run}=setup();const picks=Array.from({length:120},(_,i)=>({overallPick:i+1,yahooPlayerId:String(i+1),isMine:[8,9,24,25,40,41,56,57,72,73,88,89,104,105,120].includes(i+1)}));
  run.capture=async()=>({snapshot:{picks}});run.sync=async()=>({roster:'15/15'});
  run.log=picks.filter(p=>p.isMine&&p.overallPick>=56).map(p=>({pick:p.overallPick,yahooPlayerId:p.yahooPlayerId,accepted:true}));
  const proof=await run.complete();assert.equal(proof.fullyManual,false);assert.deepEqual(proof.unverifiedPicks,[8,9,24,25,40,41]);
  run.log=picks.filter(p=>p.isMine).map(p=>({pick:p.overallPick,yahooPlayerId:p.yahooPlayerId,accepted:true}));
  assert.equal((await run.complete()).fullyManual,true);
});
