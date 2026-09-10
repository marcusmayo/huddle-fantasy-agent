'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../public/yahoo-clock-reader.js'),'utf8');
const geometry=[{paragraphs:[{lines:['Test room','00:30'].map((text,i)=>({text,bbox:{x0:100,y0:20+i*60,x1:500,y1:50+i*60}}))}]}];
function fixture({recognitionMs=200,workerReady=Promise.resolve()}={}){
  let mono=1000,terminated=0,stopped=0,captures=0;const observations=[],errors=[],traces=[];
  const video={videoWidth:900,videoHeight:848,play:async()=>{},requestVideoFrameCallback:callback=>(video.callback=callback,1),cancelVideoFrameCallback(){}};
  const track={readyState:'live',stop:()=>stopped++,addEventListener(){}};
  const context={performance:{now:()=>mono},Date,setInterval:()=>1,clearInterval(){},navigator:{mediaDevices:{getDisplayMedia:async()=>{captures++;return {getVideoTracks:()=>[track],getTracks:()=>[track]};}}},document:{head:{append:s=>s.onload()},createElement:type=>{
    if(type==='video')return video;if(type==='script')return {};
    return {getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData(){}})};
  }},Tesseract:{createWorker:async()=>{await workerReady;return {setParameters:async()=>{},recognize:async()=>{mono+=recognitionMs;return {data:{confidence:95,text:'Test room\n00:30\nYOUR TURN • ROUND 1, PICK 1',blocks:geometry}};},terminate:async()=>terminated++};}},HuddleYahooClock:require('../public/yahoo-clock-model')};
  vm.createContext(context);vm.runInContext(code,context);
  return {track,captures:()=>captures,start:({stream}={})=>context.HuddleYahooClockReader.start({stream,onReady:async()=>({roomName:'Test room'}),onObservation:o=>observations.push(o),onError:e=>errors.push(e.message),onTrace:(type,data)=>traces.push({type,...data})}),video,observations,errors,traces,terminated:()=>terminated,stopped:()=>stopped};
}
test('actual video frame callback schedules its successor and emits an observation',async()=>{
  const f=fixture(),reader=await f.start();await f.video.callback(0,{mediaTime:1,presentedFrames:1});
  assert.equal(f.observations.length,0);await f.video.callback(0,{mediaTime:2,presentedFrames:2});
  assert.equal(f.observations.length,1);assert.equal(f.observations[0].frame,2);assert.equal(f.observations[0].recognitionMs,200);
  assert.ok(f.traces.some(e=>e.type==='recognition-finished'&&e.recognizeCallMs===200));assert.deepEqual(f.errors,[]);
  await reader.stop();assert.equal(f.stopped(),1);assert.equal(f.terminated(),3);
});
test('slow recognition is traced and rejected without ending the frame loop',async()=>{
  const f=fixture({recognitionMs:1700}),reader=await f.start();await f.video.callback(0,{mediaTime:1,presentedFrames:1});
  assert.equal(f.observations.length,0);assert.ok(f.errors.some(e=>/too long/.test(e)));assert.equal(typeof f.video.callback,'function');
  await reader.stop();
});

function asyncFixture(){
  let mono=1000;const observations=[],traces=[],jobs=[],canvases=[],errors=[];
  const video={pixel:0,videoWidth:900,videoHeight:848,play:async()=>{},requestVideoFrameCallback:cb=>(video.callback=cb,1),cancelVideoFrameCallback(){}};
  const track={readyState:'live',stop(){},addEventListener(){}};
  const context={performance:{now:()=>mono},Date,setInterval:()=>1,clearInterval(){},navigator:{mediaDevices:{getDisplayMedia:async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]})}},document:{visibilityState:'visible',head:{append:s=>s.onload()},createElement:type=>{
    if(type==='video')return video;if(type==='script')return {};
    const canvas={width:0,height:0};canvas.getContext=()=>({drawImage:source=>{canvas.pixel=source.pixel;},getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4).fill(canvas.pixel)}),putImageData(){},fillRect(){}});canvases.push(canvas);return canvas;
  }},Tesseract:{createWorker:async()=>({setParameters:async()=>{},recognize:bytes=>new Promise(resolve=>jobs.push({pixel:bytes[1078],resolve})),terminate:async()=>{}})},HuddleYahooClock:require('../public/yahoo-clock-model')};
  vm.createContext(context);vm.runInContext(code,context);
  return {video,jobs,canvases,observations,traces,errors,
    start:()=>context.HuddleYahooClockReader.start({onReady:async()=>({roomName:'Test room'}),onObservation:o=>observations.push(o),onError:e=>errors.push(e.message),onTrace:(type,data)=>traces.push({type,...data})}),
    frame(n,at){mono=at;video.pixel=n;return video.callback(at,{mediaTime:n,presentedFrames:n});},
    finish(index,at,text='Test room\n00:30\nYOUR TURN • ROUND 1, PICK 1',blocks=geometry){mono=at;jobs[index].resolve({data:{confidence:95,text,blocks}});},
    time(at){mono=at;}
  };
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function prime(f){const p=f.frame(0,0);await settle();f.finish(0,100);await p;f.jobs.length=0;f.traces.length=0;}

test('supplied browser stream is used without opening a second picker',async()=>{
  const f=fixture(),stream={getTracks:()=>[f.track],getVideoTracks:()=>[f.track]};
  const reader=await f.start({stream});assert.equal(f.captures(),0);assert.equal(f.video.srcObject,stream);await reader.stop();
});

test('sharing canceled while workers load cannot pair or leave workers running',async()=>{
  let ready;const workerReady=new Promise(resolve=>ready=resolve),f=fixture({workerReady});
  const starting=f.start();await settle();f.track.readyState='ended';ready();
  await assert.rejects(starting,/stopped during startup/);assert.equal(f.terminated(),3);assert.equal(f.video.srcObject,null);assert.equal(f.video.callback,undefined);
});

test('stable geometry keeps fresh region OCR past ten seconds and rediscovers after resize',async()=>{
  const f=asyncFixture(),reader=await f.start(),first=f.frame(1,1000);await settle();
  const lines=['Test room','00:30','YOUR TURN • ROUND 1, PICK 1'].map((text,i)=>({text,bbox:{x0:100,y0:20+i*60,x1:500,y1:50+i*60}}));
  f.finish(0,1200,undefined,[{paragraphs:[{lines}]}]);await first;
  const later=f.frame(2,15000);await settle();
  f.finish(1,15100,'Test room');await settle();
  f.finish(2,15200,'00:16');await settle();
  f.finish(3,15300,'YOUR TURN • ROUND 1, PICK 1');await later;
  assert.equal(f.observations.length,1);
  assert.equal(f.observations[0].capturedMonoMs,15000);
  assert.equal(f.traces.find(e=>e.type==='frame-start'&&e.frame===2).discover,false);
  assert.equal(f.traces.find(e=>e.type==='recognition-finished'&&e.frame===2).regionCount,3);
  f.video.videoWidth=1000;const resized=f.frame(3,16000);await settle();
  f.finish(4,16200);await resized;
  assert.equal(f.traces.find(e=>e.type==='frame-start'&&e.frame===3).discover,true);
  await reader.stop();
});

test('busy OCR retains only newest pixels and drains without another callback',async()=>{
  const f=asyncFixture(),reader=await f.start();await prime(f);const first=f.frame(1,1000);await settle();
  f.frame(2,1100);f.frame(3,1200);
  assert.equal(f.jobs.length,1);assert.equal(f.canvases.filter(c=>c.width>0).length,2);
  f.finish(0,1300);await settle();
  assert.equal(f.jobs.length,2);assert.equal(f.jobs[1].pixel,3);
  f.finish(1,1400);await first;
  assert.deepEqual(f.observations.map(o=>o.frame),[1,3]);
  assert.equal(f.observations[1].capturedMonoMs,1200);
  assert.equal(f.observations[1].recognitionMs,200);
  assert.equal(f.canvases.filter(c=>c.width>0).length,0);
  assert.ok(f.traces.some(e=>e.type==='frame-discarded'&&e.frame===2&&e.reason==='superseded'));
  await reader.stop();
});

test('over-age pending pixels are rejected without a new timestamp or OCR job',async()=>{
  const f=asyncFixture(),reader=await f.start();await prime(f);const first=f.frame(1,1000);await settle();
  f.frame(2,1100);f.finish(0,1200);await settle();
  // Job 2 is already consuming; a third frame waits behind it until over-age.
  f.frame(3,1250);f.finish(1,2600);await first;
  assert.equal(f.jobs.length,2);
  assert.ok(f.traces.some(e=>e.type==='frame-discarded'&&e.frame===3&&e.reason==='stale-before-recognition'));
  await reader.stop();
});

test('resize invalidates in-flight geometry and keeps only the new-size frame',async()=>{
  const f=asyncFixture(),reader=await f.start(),first=f.frame(1,1000);await settle();
  f.frame(2,1100);f.video.videoWidth=1000;f.frame(3,1200);
  f.finish(0,1300);await settle();assert.equal(f.observations.length,0);assert.equal(f.jobs[1].pixel,3);
  f.finish(1,1400);await first;assert.deepEqual(f.observations,[]);assert.ok(f.traces.some(e=>e.type==='geometry-ready'&&e.frame===3));await reader.stop();
});

test('disconnect releases pending frames and suppresses the in-flight result',async()=>{
  const f=asyncFixture(),reader=await f.start(),first=f.frame(1,1000);await settle();f.frame(2,1100);
  await reader.stop();f.finish(0,1200);await first;
  assert.equal(f.jobs.length,1);assert.equal(f.observations.length,0);assert.equal(f.canvases.filter(c=>c.width>0).length,0);
});

test('wrong room invalidates queued crops and requires fresh discovery',async()=>{
  const f=asyncFixture(),reader=await f.start(),first=f.frame(1,1000);await settle();f.frame(2,1100);
  f.finish(0,1200,'Wrong room\n00:30\nYOUR TURN • ROUND 1, PICK 1');await first;
  assert.equal(f.jobs.length,1);assert.equal(f.observations.length,0);assert.ok(f.errors.includes('Selected Yahoo room does not match'));
  const next=f.frame(3,1300);await settle();f.finish(1,1400);await next;assert.equal(f.observations.length,0);assert.ok(f.traces.some(e=>e.type==='geometry-ready'&&e.frame===3));await reader.stop();
});


test('slow discovery locates geometry without publishing expiring clock pixels',async()=>{
 const f=asyncFixture(),reader=await f.start(),first=f.frame(1,1000);await settle();
 f.frame(2,1100);f.finish(0,2146);await first;
 assert.equal(f.observations.length,0);assert.ok(f.traces.some(e=>e.type==='geometry-ready'));assert.equal(f.jobs.length,1);
 const fresh=f.frame(3,2200);await settle();f.finish(1,2500);await fresh;
 assert.equal(f.observations.length,1);assert.equal(f.observations[0].capturedMonoMs,2200);assert.equal(f.observations[0].recognitionMs,300);await reader.stop();
});
test('waiting header prewarms geometry but never certifies a turn',async()=>{
 const f=asyncFixture(),reader=await f.start();
 const lines=['Test room','00:02','Waiting to start'].map((text,i)=>({text,bbox:{x0:100,y0:20+i*60,x1:500,y1:50+i*60}}));
 const first=f.frame(1,1000);await settle();f.finish(0,1200,'Test room\n00:02\nWaiting to start',[{paragraphs:[{lines}]}]);await first;
 assert.equal(f.observations.length,0);
 const waiting=f.frame(2,1300);await settle();f.finish(1,1400,'Test room');f.finish(2,1400,'00:02');f.finish(3,1400,'Waiting to start');await waiting;
 assert.ok(f.traces.some(e=>e.type==='waiting-for-turn'));assert.equal(f.observations.length,0);
 const active=f.frame(3,1500);await settle();f.finish(4,1600,'Test room');f.finish(5,1600,'00:30');f.finish(6,1600,'YOUR TURN • ROUND 1, PICK 1');await active;
 assert.equal(f.observations.length,1);assert.equal(f.traces.find(e=>e.type==='frame-start'&&e.frame===3).discover,false);await reader.stop();
});


test('cropped minutes clock cannot be accepted as a short one-second clock',async()=>{
 const f=asyncFixture(),reader=await f.start(),lines=['Test room','01:10','YOUR TURN • ROUND 1, PICK 1'].map((text,i)=>({text,bbox:{x0:100,y0:20+i*60,x1:500,y1:50+i*60}}));
 const first=f.frame(1,1000);await settle();f.finish(0,1200,'Test room\n01:10\nYOUR TURN • ROUND 1, PICK 1',[{paragraphs:[{lines}]}]);await first;
 const cut=f.frame(2,1300);await settle();f.finish(1,1400,'Test room');f.finish(2,1400,'01');f.finish(3,1400,'YOUR TURN • ROUND 1, PICK 1');await cut;
 assert.equal(f.observations.length,0);assert.ok(f.errors.some(e=>e.includes('crop is incomplete')));
 const retry=f.frame(3,1500);await settle();assert.equal(f.traces.find(e=>e.type==='frame-start'&&e.frame===3).discover,true);f.finish(4,1600);await retry;await reader.stop();
});
test('genuine short seconds discovered in the source remain supported',async()=>{
 const f=asyncFixture(),reader=await f.start(),lines=['Test room','30','YOUR TURN • ROUND 1, PICK 1'].map((text,i)=>({text,bbox:{x0:100,y0:20+i*60,x1:500,y1:50+i*60}}));
 const first=f.frame(1,1000);await settle();f.finish(0,1200,'Test room\n30\nYOUR TURN • ROUND 1, PICK 1',[{paragraphs:[{lines}]}]);await first;
 const next=f.frame(2,1300);await settle();f.finish(1,1400,'Test room');f.finish(2,1400,'29');f.finish(3,1400,'YOUR TURN • ROUND 1, PICK 1');await next;
 assert.equal(f.observations[0].secondsLeft,29);await reader.stop();
});
test('repeated inactive readings trigger bounded geometry recovery',async()=>{
 const f=asyncFixture(),reader=await f.start();await prime(f);
 const a=f.frame(1,1000);await settle();f.finish(0,1100,'Test room\n00:00\nYOUR TURN • ROUND 1, PICK 1');await a;
 const b=f.frame(2,2200);await settle();f.finish(1,2300,'Test room\n00:00\nYOUR TURN • ROUND 1, PICK 1');await b;
 const c=f.frame(3,2400);await settle();assert.equal(f.traces.find(e=>e.type==='frame-start'&&e.frame===3).discover,true);f.finish(2,2500);await c;
 assert.equal(f.observations.length,0);await reader.stop();
});
