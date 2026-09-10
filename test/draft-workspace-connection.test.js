const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../public/draft-workspace-connection');
function fixture(request=async()=>({pick:2})){
  let time=0,id=0;const timers=new Map(),streams=[],reads=[],errors=[],received=[];
  const connection=create({url:'/draft',now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    request:(...args)=>{reads.push(time);return request(...args);},
    makeStream:()=>{const handlers={};const s={closed:false,addEventListener:(name,fn)=>handlers[name]=fn,close:()=>s.closed=true,send:(name,value)=>handlers[name]?.({data:JSON.stringify(value)})};streams.push(s);return s;},
    onWorkspace:(value,timing)=>received.push({value,timing,at:time}),onError:e=>errors.push(e)});
  async function advance(ms){const until=time+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}time=until;await settle();}
  return {connection,streams,reads,errors,received,advance,timers};
}
async function settle(){for(let i=0;i<5;i++)await Promise.resolve();}
test('silent stream recovers through a same-view read within three seconds',async()=>{
  const f=fixture();f.connection.start();f.streams[0].send('workspace',{pick:1});await f.advance(3000);
  assert.equal(f.streams[0].closed,true);assert.equal(f.received.at(-1).value.pick,2);assert.equal(f.received.at(-1).at,3000);f.connection.stop();assert.equal(f.timers.size,0);
});
test('heartbeat keeps transport alive without claiming a fresh workspace',async()=>{
  const f=fixture();f.connection.start();f.streams[0].send('workspace',{pick:1});
  for(let i=0;i<10;i++){await f.advance(1000);f.streams[0].send('heartbeat',{});}
  assert.equal(f.reads.length,0);assert.equal(f.received.length,1);f.connection.stop();
});
test('an old in-flight read cannot replace a newer stream workspace',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.connection.start();f.streams[0].onerror();await f.advance(1000);
  f.streams[1].send('workspace',{pick:4});resolve({pick:2});await settle();assert.equal(f.received.at(-1).value.pick,4);
  f.streams[0].send('workspace',{pick:1});assert.equal(f.received.length,1);f.connection.stop();
});
test('authorization failure stops retries and requires explicit restart',async()=>{
  const f=fixture(async()=>{throw Object.assign(Error('Sign in'),{status:401});});f.connection.start();f.streams[0].onerror();await settle();await f.advance(30000);
  assert.equal(f.reads.length,1);assert.equal(f.timers.size,0);f.connection.start();assert.equal(f.streams.length,2);f.connection.stop();
});
test('stop cancels pending reads and ignores late delivery',async()=>{
  let resolve,signal;const f=fixture((url,options)=>{signal=options.signal;return new Promise(r=>resolve=r);});f.connection.start();f.streams[0].onerror();f.connection.stop();assert.equal(signal.aborted,true);
  resolve({pick:9});await settle();assert.equal(f.received.length,0);assert.equal(f.timers.size,0);
});
test('repeated outages stay bounded and recover after the service returns',async()=>{
  let online=false;const f=fixture(async()=>{if(!online)throw Error('offline');return {pick:7};});f.connection.start();f.streams[0].onerror();await settle();await f.advance(6000);online=true;await f.advance(5000);
  assert.equal(f.received.at(-1).value.pick,7);assert.ok(f.reads.length<=12);f.connection.stop();
});

test('unreadable transient denial recovers without signing in and leaves no denial deadline',async()=>{
  let calls=0;const f=fixture(async()=>{if(++calls<3)throw Object.assign(Error('unreadable'),{status:403,code:'INVALID_RESPONSE'});return {pick:9};});
  f.connection.start();f.streams[0].onerror();await settle();await f.advance(500);
  assert.equal(f.reads.length,3);assert.equal(f.received.at(-1).value.pick,9);
  assert.equal(f.errors.at(-1).recovering,true);await f.advance(6000);
  assert.ok(!f.errors.some(e=>e.code==='RECOVERY_EXHAUSTED'));f.connection.stop();assert.equal(f.timers.size,0);
});

test('persistent unreadable denial stops after three additional reads',async()=>{
  const f=fixture(async()=>{throw Object.assign(Error('unreadable'),{status:401,code:'INVALID_RESPONSE'});});
  f.connection.start();f.streams[0].onerror();await settle();await f.advance(30000);
  assert.equal(f.reads.length,4);assert.equal(f.timers.size,0);assert.equal(f.received.length,0);
});

test('recovery deadline aborts a hung follow-up read',async()=>{
  let calls=0,signal;const f=fixture(async(u,o)=>{if(++calls===1)throw Object.assign(Error('unreadable'),{status:403,code:'INVALID_RESPONSE'});signal=o.signal;return new Promise(()=>{});});
  f.connection.start();f.streams[0].onerror();await settle();await f.advance(4500);
  assert.equal(signal.aborted,true);assert.equal(f.errors.at(-1).code,'RECOVERY_EXHAUSTED');assert.equal(f.timers.size,0);
});

test('missing session never enters ambiguous authentication recovery',async()=>{
  const f=fixture(async()=>{throw Object.assign(Error('missing'),{status:404,code:'INVALID_RESPONSE'});});
  f.connection.start();f.streams[0].onerror();await settle();await f.advance(30000);
  assert.equal(f.reads.length,1);assert.equal(f.timers.size,0);
});
