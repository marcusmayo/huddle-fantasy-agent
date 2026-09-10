// Real wall-clock host lifecycle proof; model responses and browser work are FAKE.
// This cannot certify computer-use performance, Yahoo picks or live timing.
import fs from 'node:fs';
import path from 'node:path';
import {runPersistentModelLoop} from './persistent-model-loop.mjs';
const directory=path.resolve('.media-build/persistent-model-loop-proof');fs.mkdirSync(directory,{recursive:true});
const started=Date.now(),events=[],executions=[];let count=0;
const write=()=>fs.writeFileSync(path.join(directory,'progress.json'),JSON.stringify({pid:process.pid,scope:'Offline host lifecycle only; fake model and fake browser',started,at:Date.now(),executions:executions.length}));
const result=await runPersistentModelLoop({prompt:'Offline lifecycle proof',operationBudgetMs:5000,
  respond:async()=>Date.now()-started>=65000?{id:'done',status:'completed',output:[]}:
    {id:'r'+(++count),status:'completed',output:[{type:'function_call',name:'exec_browser',call_id:'c'+count,arguments:JSON.stringify({code:'fake observation'})}]},
  execute:async()=>{await new Promise(resolve=>setTimeout(resolve,1000));executions.push(Date.now());write();return 'fake observation';},
  verifyComplete:async()=>Date.now()-started>=65000,
  onEvent:event=>{events.push(event);write();}
});
const summary={...result,scope:'Offline host lifecycle only; not real model/browser or draft validation',started,ended:Date.now(),elapsedMs:Date.now()-started,maxFakeExecutionGapMs:Math.max(0,...executions.slice(1).map((t,i)=>t-executions[i])),events};
fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,events:summary.events.length}));
