'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,remaining,ClockTracker}=require('../public/yahoo-clock-model');
test('recognizes Yahoo clock automatically and rejects ambiguous text',()=>{
  assert.deepEqual(parse('00:30\nYOUR TURN • ROUND 1, PICK 8'),{secondsLeft:30,overallPick:8,round:1,onClock:true});
  assert.equal(parse("01:10\nSomeone’s Pick • You're up in 3 Picks • Round 1, Pick 5").secondsLeft,70);
  assert.equal(parse('9\nYOUR TURN • ROUND 1, PICK 8').secondsLeft,9);
  for(const s of ['00:99\nYOUR TURN • ROUND 1, PICK 8','00:30 00:20\nYOUR TURN • ROUND 1, PICK 8','00:30\nPick 8'])assert.throws(()=>parse(s));
});
test('identical delivery latency gives a 70-second clock forty extra seconds',()=>{
  for(const seconds of [15,30,45,70,90]){
    assert.equal(remaining({secondsLeft:seconds,capturedMonoMs:100},3100),seconds*1000-5000);
  }
  assert.equal(remaining({secondsLeft:15,capturedMonoMs:100},3100),10000);
  assert.equal(remaining({secondsLeft:15,capturedMonoMs:100},3101),9999);
});
test('requires consecutive fresh frames, matching turn and room, and fails on a reset',()=>{
  const t=new ClockTracker();const context={now:100,completedPicks:7,draftSlot:8,teamCount:8,expectedRoom:'room-a',observedRoom:'room-a'};
  const a={secondsLeft:30,capturedMonoMs:100,overallPick:8,round:1,onClock:true};
  assert.equal(t.observe(a,context),null);
  assert.ok(t.observe({...a,capturedMonoMs:600},{...context,now:650}));
  assert.equal(t.status(700).timely,true);
  assert.equal(t.status(2200).verified,false);
  assert.equal(t.observe({...a,secondsLeft:70,capturedMonoMs:1000},{...context,now:1050}),null);
  assert.equal(t.status(1050).verified,false);
  assert.equal(t.observe({...a,secondsLeft:70,capturedMonoMs:1200},{...context,now:1250}),null,'a repeated reset value cannot silently regain verification');
  assert.equal(t.observe({...a,capturedMonoMs:1200},{...context,now:1250,observedRoom:'wrong'}),null);
});
test('does not infer a new turn from a timer reset or a delayed board',()=>{
  const t=new ClockTracker();
  assert.equal(t.observe({secondsLeft:70,capturedMonoMs:0,overallPick:9,round:2,onClock:true},{now:10,completedPicks:7,draftSlot:8,teamCount:8,expectedRoom:'x',observedRoom:'x'}),null);
  assert.match(t.reason,/results/);
});
test('repeated frozen frames cannot refresh the countdown indefinitely',()=>{
  const t=new ClockTracker();const context={completedPicks:7,draftSlot:8,teamCount:8,expectedRoom:'x',observedRoom:'x'};
  for(const now of [0,500,1000,1500,2000])t.observe({secondsLeft:30,capturedMonoMs:now,overallPick:8,round:1,onClock:true},{...context,now});
  assert.equal(t.status(2000).verified,false);assert.match(t.reason,/frozen/);
});
