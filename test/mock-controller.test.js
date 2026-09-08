'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let createYahooMockLoop, verifyStandardMockSettings;
test.before(async()=>{
  ({createYahooMockLoop}=await import('../scripts/yahoo-mock-cua-loop.mjs'));
  ({verifyStandardMockSettings}=await import('../scripts/yahoo-mock-entry-cua.mjs'));
});

function setup({notice=true,acknowledge=true}={}) {
  const ui={inactivityNotice:notice,autoKnown:true,autodraft:true,header:'Waiting room'};
  const actions=[];
  const locator=selector=>({filter(){return this;},async click(){
    actions.push(selector);
    if(selector==='button') ui.inactivityNotice=false;
    else if(!ui.inactivityNotice&&acknowledge)ui.autodraft=false;
  }});
  const run=createYahooMockLoop({yahoo:{playwright:{locator,waitForTimeout:async()=>{if(!acknowledge)throw Error('Mode not acknowledged');}}},huddle:{},roomId:'1234',draftSlot:8,rules:{roster:{QB:1,RB:2,WR:2,TE:1,'W/R/T':1,K:1,DEF:1,BN:6}}});
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
test('startup never performs a separate import before the shared turn loop',async()=>{
  for(const header of ['Draft Starting Soon',"Gavin’s Pick • You’re up in 1 Pick • Round 1, Pick 7",'00:14\nYour Turn • Round 1, Pick 8']) {
    const {run,ui}=setup({notice:false});ui.autodraft=false;ui.header=header;
    run.capture=async()=>{throw Error('Opening preflight consumed the pick clock');};
    run.sync=async()=>{throw Error('Opening import must be part of the selection cycle');};
    run.window=async()=>({manualVerified:2});
    assert.deepEqual(await run.startVerified(),{manualVerified:2});
  }
});
test('the real mixed-case Yahoo turn header reaches selection through batch',async()=>{
  const {run,ui}=setup({notice:false});ui.autodraft=false;ui.header='00:29\nYour Turn • Round 1, Pick 8';
  run.cycle=async()=>({pick:8,accepted:true});
  assert.equal((await run.batch({waitMs:0})).result.pick,8);
});
test('an unsuccessful cycle retains its diagnostic instead of blank pick fields',async()=>{
  const {run}=setup();run.batch=async()=>({manualVerified:0,result:{blocked:'Live turn changed',header:'Round 2, Pick 10'}});
  const progress=await run.window();assert.equal(progress.results[0].result.blocked,'Live turn changed');
});
test('completed roster is not reported fully manual when opening picks were unverified',async()=>{
  const {run}=setup();const picks=Array.from({length:120},(_,i)=>({overallPick:i+1,yahooPlayerId:String(i+1),isMine:[8,9,24,25,40,41,56,57,72,73,88,89,104,105,120].includes(i+1)}));
  run.capture=async()=>({snapshot:{picks}});run.sync=async()=>({roster:'15/15'});
  run.log=picks.filter(p=>p.isMine&&p.overallPick>=56).map(p=>({pick:p.overallPick,yahooPlayerId:p.yahooPlayerId,accepted:true}));
  const proof=await run.complete();assert.equal(proof.fullyManual,false);assert.deepEqual(proof.unverifiedPicks,[8,9,24,25,40,41]);
  run.log=picks.filter(p=>p.isMine).map(p=>({pick:p.overallPick,yahooPlayerId:p.yahooPlayerId,accepted:true}));
  assert.equal((await run.complete()).fullyManual,true);
});
test('controller derives completion from league size and excludes IR; rejects the wrong seat',()=>{
  const args={yahoo:{},huddle:{},roomId:'1234',draftSlot:3,teamCount:6,rules:{roster:{QB:2,RB:3,WR:4,TE:1,'W/T':1,'W/R':1,K:1,DEF:2,BN:5,IR:2}}};
  const run=createYahooMockLoop(args);assert.equal(run.rounds,20);assert.equal(run.expectedPicks,120);
  assert.equal(createYahooMockLoop({...args,teamCount:10}).expectedPicks,200);
  assert.throws(()=>createYahooMockLoop({...args,draftSlot:8}),/assigned seat/);
});
test('standard entry blocks changed scoring, clock, roster, and position caps',()=>{
  const run={teamCount:8,rounds:15,rules:{receptionPoints:.5,passingTouchdown:4,roster:{QB:1,WR:2,RB:2,TE:1,'W/R/T':1,K:1,DEF:1,BN:6},rosterMaximums:{RB:6,QB:4}}};
  const text='League Settings\nDraft Pick Time\n30 seconds\nRoster Positions (15)\nQB\nWR\n2\nRB\n2\nTE\nW/R/T\nK\nDEF\nBN\n6\nPosition Limits\nRB: 6, TE: 4, QB: 4, DEF: 4, K: 4, WR: 8, OFF: 4\nPass TD - Passing Touchdowns\n4\nRec - Receptions\n0.5\n';
  assert.equal(verifyStandardMockSettings(text,run),true);
  for(const changed of [text.replace('0.5','1.0'),text.replace('30 seconds','15 seconds'),text.replace('WR\n2','WR\n3'),text.replace('RB: 6','RB: 4')])assert.throws(()=>verifyStandardMockSettings(changed,run),/differ|Unverified/);
  assert.throws(()=>verifyStandardMockSettings(text,{...run,teamCount:6}),/configuration/);
});
