import test from 'node:test';
import assert from 'node:assert/strict';
import {runPersistentModelLoop} from './persistent-model-loop.mjs';
const call=(id='c1',code='fixture')=>({id:'r'+id,status:'completed',output:[{type:'function_call',call_id:id,name:'exec_browser',arguments:JSON.stringify({code})}]});
const done={id:'done',status:'completed',output:[{type:'message'}]};
function fixture(overrides={}){
  let requests=[],executed=[],events=[],queue=[call(),done];
  const options={prompt:'Offline fixture only',respond:async x=>{requests.push(x);return queue.shift();},execute:async x=>{executed.push(x);return 'observed';},verifyComplete:async()=>true,onEvent:e=>events.push(e),...overrides};
  return {run:()=>runPersistentModelLoop(options),requests,executed,events,queue};
}
test('host continues automatically with matching call output and response identity',async()=>{
  const f=fixture();const result=await f.run();assert.equal(result.completed,true);assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].previous_response_id,'rc1');assert.deepEqual(f.requests[1].input,[{type:'function_call_output',call_id:'c1',output:'observed'}]);
});
test('unverified input is never retried or followed by another model call',async()=>{
  const f=fixture({execute:async()=>{throw Error('unknown input');}});await assert.rejects(f.run(),/unknown/);assert.equal(f.requests.length,1);assert.equal(f.events.at(-1).type,'failed');
});
test('premature model completion is not draft completion',async()=>{
  const f=fixture({verifyComplete:async()=>false});f.queue.splice(0,2,done);await assert.rejects(f.run(),/before verified/);
});
test('repeated call identity cannot replay a UI action',async()=>{
  const f=fixture();f.queue.splice(1,1,call());await assert.rejects(f.run(),/repeated/);assert.equal(f.executed.length,1);
});
test('model latency exhausts budget without dispatching browser input',async()=>{
  const f=fixture({operationBudgetMs:10,respond:()=>new Promise(()=>{})});await assert.rejects(f.run(),/model timeout/);assert.equal(f.executed.length,0);
});
test('browser timeout aborts its adapter and stops further requests',async()=>{
  let browserSignal;const f=fixture({operationBudgetMs:10,execute:async x=>{browserSignal=x.signal;return new Promise(()=>{});}});
  await assert.rejects(f.run(),/browser timeout/);assert.equal(browserSignal.aborted,true);assert.equal(f.requests.length,1);
});
test('operator stop prevents new input after model request',async()=>{
  const controller=new AbortController();const f=fixture({signal:controller.signal,respond:async()=>{controller.abort();return call();}});
  await assert.rejects(f.run(),/stopped/);assert.equal(f.executed.length,0);
});
test('response limit cannot produce false completion',async()=>{
  const f=fixture({maxResponses:1});await assert.rejects(f.run(),/limit/);assert.equal(f.events.at(-1).type,'failed');
});
test('verified completion after input avoids an unnecessary paid response',async()=>{
  const f=fixture({completeAfterTool:true});const result=await f.run();assert.equal(result.completed,true);assert.equal(f.requests.length,1);assert.equal(f.executed.length,1);
});
test('incomplete external state continues model work after the tool returns',async()=>{
  let checks=0;const f=fixture({completeAfterTool:true,verifyComplete:async()=>++checks===2});const result=await f.run();assert.equal(result.completed,true);assert.equal(f.requests.length,2);
});
