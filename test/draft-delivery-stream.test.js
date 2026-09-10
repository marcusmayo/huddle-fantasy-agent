'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {openDraftStream}=require('../src/services/draft-stream');
const {YahooDraftPoller}=require('../src/providers/yahoo');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('polling subtracts read time while preserving response-relative rate-limit backoff',async()=>{
  for(const scenario of [{duration:2000,delay:3000},{duration:6000,delay:100},{duration:2000,retry:12000,delay:12000}]){
    let now=0,scheduled=[];
    const p=new YahooDraftPoller({client:{},leagueKey:'x',draftService:{},playerPool:{players:[]},now:()=>now,setTimer:(fn,ms)=>{scheduled.push({fn,ms});return 1;},clearTimer:()=>{}});
    p.syncOnce=async()=>{now+=scenario.duration;if(scenario.retry)throw Object.assign(Error('Limited'),{status:429,retryAfterMs:scenario.retry});};
    p.start();await turn();assert.equal(scheduled[0].ms,scenario.delay);assert.equal(scheduled.length,1);p.stop();
    await scheduled[0].fn();assert.equal(scheduled.length,1,'A stopped generation cannot schedule another read');
  }
});
function fixture(){
  const listeners=new Set();let revision=1,reads=0;
  const service={subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const response=new EventEmitter();response.chunks=[];response.writeHead=()=>{};response.write=x=>{response.chunks.push(x);return true;};response.end=()=>response.emit('close');
  const read=()=>{reads++;return {revision};};
  return {service,response,read,listeners,get reads(){return reads;},change(){revision++;for(const fn of listeners)fn();}};
}
test('a saved update is pushed immediately, coalesces bursts, and disconnect releases the subscription',async()=>{
  const f=fixture();openDraftStream(f.response,f.service,f.read);assert.equal(f.reads,1);
  f.change();f.change();await turn();assert.equal(f.reads,2);assert.match(f.response.chunks.at(-1),/"revision":3/);
  f.response.end();f.change();await turn();assert.equal(f.listeners.size,0);assert.equal(f.reads,2);
});

test('stream metadata correlates deliveries without claiming Yahoo publication time',async()=>{
 const f=fixture();openDraftStream(f.response,f.service,()=>({...f.read(),apiFeed:{lastSuccessAt:'2026-09-09T18:00:00Z'}}));
 const parse=chunk=>JSON.parse(chunk.split('data: ')[1].trim()).streamDelivery;const a=parse(f.response.chunks[0]);f.change();await turn();const b=parse(f.response.chunks.at(-1));
 assert.equal(a.streamId,b.streamId);assert.equal(b.sequence,a.sequence+1);assert.equal(a.sourceReadAt,'2026-09-09T18:00:00Z');assert.ok(a.workspaceBuildMs>=0);assert.equal(a.publicationAt,undefined);f.response.end();
});
test('snapshot persistence cannot recursively broadcast, and reconnect reads the latest board',async()=>{
  const f=fixture();openDraftStream(f.response,f.service,()=>{const value=f.read();for(const fn of f.listeners)fn();return value;});
  f.change();await turn();await turn();assert.equal(f.reads,2);f.response.end();
  const next=fixture();next.change();openDraftStream(next.response,next.service,next.read);assert.match(next.response.chunks[0],/"revision":2/);next.response.end();
});
test('unavailable state ends the stream instead of retaining a healthy old card',async()=>{
  const f=fixture();let fail=false;openDraftStream(f.response,f.service,()=>{if(fail)throw Error('Deleted');return f.read();});
  fail=true;f.change();await turn();assert.match(f.response.chunks.at(-1),/event: unavailable/);assert.equal(f.listeners.size,0);
});
test('a buffered large snapshot waits for drain and sends only the newest pending state',async()=>{
  const f=fixture();let blocked=true;
  f.response.write=x=>{f.response.chunks.push(x);return !blocked;};
  openDraftStream(f.response,f.service,f.read);f.change();f.change();await turn();
  assert.equal(f.reads,1);assert.equal(f.listeners.size,1);
  blocked=false;f.response.emit('drain');await turn();
  assert.equal(f.reads,2);assert.match(f.response.chunks.at(-1),/"revision":3/);f.response.end();
});
