'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require.resolve('../public/visual-clock-connection.js'),'utf8');
function fixture({pickerDelay=0,hold=false}={}){
  let now=100000,callbacks,interval,release,stops=0;const requests=[],statuses=[],clocks=[];
  const context={Date:{now:()=>now,parse:Date.parse},performance:{now:()=>now},setInterval:fn=>(interval=fn,1),clearInterval(){interval=null;},HuddleTimeBounds:require('../public/clock-time-bounds'),HuddleRequests:{requestJSON:async(url,options={})=>{
    const body=options.body&&JSON.parse(options.body);requests.push({url,body,at:now});if(url==='/api/clock-time')return {serverWallMs:now};
    if(body.action==='pair')return {token:'token',epoch:'epoch',roomName:'test'};if(body.action==='trace')return {};
    if(hold)await new Promise(r=>release=r);return {observationId:'frame-'+body.frame,fresh:true};
  }},HuddleYahooClockReader:{start:async cb=>{callbacks=cb;now+=pickerDelay;await cb.onReady();return {stop:async()=>{stops++;}};}}};vm.createContext(context);vm.runInContext(code,context);
  const connection=context.HuddleVisualClockConnection.create({base:'/fixture',onStatus:x=>statuses.push(x),onClock:x=>clocks.push(x)});
  const observation=frame=>({frame,observedAt:new Date(now).toISOString(),capturedMonoMs:now,recognitionMs:100,confidence:95,headerText:'test'});
  const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  return {connection,requests,statuses,clocks,settle,bump:ms=>now+=ms,sample:frame=>callbacks.onObservation(observation(frame)),release:()=>release(),tick:()=>interval?.(),stops:()=>stops};
}
test('calibration occurs after a ninety-second permission picker, not before it',async()=>{
  const f=fixture({pickerDelay:90000});await f.connection.start();f.sample(1);await f.settle();
  assert.equal(f.requests.find(r=>r.url==='/api/clock-time').at,190000);
  assert.equal(f.clocks.at(-1).observationId,'frame-1');assert.ok(!f.statuses.some(s=>/expired/.test(s||'')));await f.connection.stop();
});
test('one pending request keeps and sends the newest sample while accounting for superseded frames',async()=>{
  const f=fixture({hold:true});await f.connection.start();f.sample(1);await f.settle();f.bump(100);f.sample(2);f.sample(3);f.release();await f.settle();
  assert.deepEqual(f.requests.filter(r=>r.body?.frame).map(r=>r.body.frame),[1,3]);f.release();await f.settle();await f.tick();await f.settle();
  const traces=f.requests.filter(r=>r.body?.action==='trace').flatMap(r=>r.body.events);assert.ok(traces.some(e=>e.type==='sample-superseded'&&e.frame===2));await f.connection.stop();
});
test('expired calibration refreshes immediately and waits for a newly captured sample',async()=>{
  const f=fixture();await f.connection.start();f.bump(61000);f.sample(1);await f.settle();f.sample(2);await f.settle();
  assert.equal(f.requests.filter(r=>r.url==='/api/clock-time').length,2);assert.deepEqual(f.requests.filter(r=>r.body?.frame).map(r=>r.body.frame),[2]);await f.connection.stop();
});
test('stopping ignores late observation responses and terminates the reader',async()=>{
  const f=fixture({hold:true});await f.connection.start();f.sample(1);await f.settle();await f.connection.stop();f.release();await f.settle();
  assert.equal(f.stops(),1);assert.deepEqual(f.clocks,[null]);assert.equal(f.connection.connected,false);
});
