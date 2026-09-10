const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../public/presentation-capture.js'),'utf8'),context);
const create=context.HuddlePresentationCapture.create;
function fixture(){
  const identity={leagueId:'league',sessionId:'session'},events=[],statuses=[];let calls=0,connections=0,disconnects=0,resolveMedia;
  const track={readyState:'live',stop(){this.readyState='ended';},addEventListener(name,fn){this[name]=fn;}},stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  let target={identity,connect:async s=>{assert.equal(s,stream);connections++;},disconnect:async()=>disconnects++};
  const capture=create({identity,getTarget:()=>target,acquireMedia:()=>{calls++;return new Promise(resolve=>resolveMedia=resolve);},onState:s=>events.push(s),onStatus:s=>statuses.push(s)});
  return {capture,stream,track,events,statuses,resolve:()=>resolveMedia(stream),setTarget:t=>target=t,target:()=>target,counts:()=>({calls,connections,disconnects})};
}
test('normal-tab acquisition is immediate, handed off once, and explicitly disconnected',async()=>{
  const f=fixture(),pending=f.capture.connect();assert.equal(f.counts().calls,1);await assert.rejects(f.capture.connect(),/already/);
  f.resolve();await pending;assert.equal(f.capture.connected,true);assert.equal(f.counts().connections,1);
  await f.capture.disconnect();assert.equal(f.track.readyState,'ended');assert.equal(f.counts().disconnects,1);
});
test('closing presentation while the picker is pending stops the returned stream without connecting',async()=>{
  const f=fixture(),pending=f.capture.connect();await f.capture.disconnect();f.setTarget(null);f.resolve();
  await assert.rejects(pending,/changed/);assert.equal(f.track.readyState,'ended');assert.equal(f.counts().connections,0);
});
test('wrong-session receiver cannot open the picker',async()=>{
  const f=fixture();f.setTarget({...f.target(),identity:{leagueId:'other',sessionId:'other'}});
  await assert.rejects(f.capture.connect(),/intended/);assert.equal(f.counts().calls,0);
});
test('receiver startup failure releases media and allows retry',async()=>{
  const f=fixture();f.target().connect=async()=>{throw Error('startup failed');};const pending=f.capture.connect();f.resolve();
  await assert.rejects(pending,/startup failed/);assert.equal(f.track.readyState,'ended');assert.equal(f.capture.connected,false);assert.equal(f.events.at(-1),'disconnected');
});
test('browser stop-sharing tears down the receiver',async()=>{
  const f=fixture(),pending=f.capture.connect();f.resolve();await pending;f.track.ended();await Promise.resolve();
  assert.equal(f.capture.connected,false);assert.equal(f.counts().disconnects,1);
});

test('receiver completion clears connected status and repeated stop is safe',async()=>{
 const f=fixture(),pending=f.capture.connect();f.resolve();await pending;assert.match(f.statuses.at(-1),/connected/);
 await f.capture.disconnect();await f.capture.disconnect();
 assert.equal(f.capture.connected,false);assert.match(f.statuses.at(-1),/^Clock source disconnected/);assert.equal(f.counts().disconnects,1);
});
