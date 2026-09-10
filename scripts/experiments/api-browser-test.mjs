// Approved $5 experiment. Synthetic browser fixture only; no Yahoo or Huddle API.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createApiTestBudget} from './api-test-budget.mjs';
import {runPersistentModelLoop} from './persistent-model-loop.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/marcu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const runId=randomUUID(),dir=path.resolve('.media-build/api-browser-'+runId);fs.mkdirSync(dir,{recursive:true});
const spendPath=path.resolve('.media-build/api-agent-spend.json');
const spend=fs.existsSync(spendPath)?JSON.parse(fs.readFileSync(spendPath,'utf8')):{limitUsd:5,entries:[]};
const accounted=()=>spend.entries.reduce((n,e)=>n+(e.conservativeUsd??e.reservedUsd),0);
const remaining=5-accounted();if(remaining<=0)throw Error('Approved test budget exhausted');
const budget=createApiTestBudget({limitUsd:remaining});
const env=fs.readFileSync('.media-build/api-agent.env','utf8');
const line=env.split(/\r?\n/).find(x=>/^OPENAI_API_KEY\s*=/.test(x));
const key=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
if(!key)throw Error('API credential missing');
const model='gpt-6-astra',effort='xhigh',events=[],requests=[],observations=[],inputs=[];let browser,page,lastSnapshot,stopped=false;
const persist=()=>{fs.writeFileSync(spendPath,JSON.stringify(spend,null,2));fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({runId,model,effort,at:Date.now(),requests:requests.length,inputs:inputs.length,accountedUsd:accounted()}));};
async function api(endpoint,body,signal){
  const r=await fetch('https://api.openai.com/v1/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  const data=await r.json();if(!r.ok){const e=Error('OpenAI HTTP '+r.status+' '+(data.error?.code||data.error?.type||'request_failed'));e.httpStatus=r.status;throw e;}return data;
}
const tools=[{type:'function',name:'exec_browser',description:'Operate the real test browser. code is a JSON array of at most 3 commands: {"action":"observe"}, {"action":"click","button":"exact visible button name"}, or {"action":"wait","ms":100}. It is a restricted browser program, not JavaScript. Only click buttons from the visible observation. Each execution returns the current visible page. Do not invent hidden state.',parameters:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},strict:true}];
async function observe(){
  const snapshot=await page.evaluate(()=>({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({name:e.innerText,disabled:e.disabled})),phase:document.getElementById('phase').textContent,turn:document.getElementById('turn').textContent,clock:document.getElementById('clock').textContent}));
  snapshot.observedAt=Date.now();const gap=lastSnapshot? snapshot.observedAt-lastSnapshot.observedAt:0;
  observations.push({...snapshot,gapMs:gap});
  const previous=lastSnapshot;lastSnapshot=snapshot;
  await page.screenshot({path:path.join(dir,'view-'+observations.length+'.png')});
  if(previous?.phase==='drafting'&&gap>5000)throw Error('Observation gap exceeded 5000 ms: '+gap);
  if(snapshot.phase==='failed')throw Error('Fixture timer expired; autodraft failure');
  return snapshot;
}
let result,error,truth;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1200,height:800}});page=await context.newPage();
  await context.route('**/*',route=>route.abort());
  await page.setContent(`<!doctype html><title>API selector test - synthetic only</title><style>body{font:20px system-ui;margin:40px;background:#10251e;color:#eee}button{font:20px system-ui;padding:16px;margin:8px}strong{color:#c5ff48}</style><h1>API selector test · synthetic only</h1><p>Not Yahoo. Not Huddle recommendation validation.</p><p id="phase">waiting</p><p>Turn: <span id="turn">0</span></p><p>Seconds left: <span id="clock">—</span></p><p id="rec">Start to reveal the recommendation.</p><button id="start">Start controlled test</button><div id="choices"></div><h2>Accepted picks</h2><div id="accepted"></div><script>
  window.fixtureTruth={turns:[],events:[]};let index=-1,deadline=0;const durations=[30,70],names=['Fixture Alpha','Fixture Beta'];const $=id=>document.getElementById(id);
  function render(){if(index<0)return;$('clock').textContent=String(Math.max(0,Math.ceil((deadline-Date.now())/1000)));if($('phase').textContent==='drafting'&&Date.now()>=deadline){$('phase').textContent='failed';fixtureTruth.events.push({type:'autodraft',turn:index+1,at:Date.now()});$('choices').innerHTML='';}}
  function next(){index++;if(index===2){$('phase').textContent='completed';$('rec').textContent='Both picks accepted.';$('choices').innerHTML='';return;}
    deadline=Date.now()+durations[index]*1000;$('phase').textContent='drafting';$('turn').textContent=String(index+1);$('rec').innerHTML='Recommendation: <strong>'+names[index]+'</strong>';fixtureTruth.turns.push({turn:index+1,clockSeconds:durations[index],startedAt:Date.now(),deadline,recommendation:names[index]});
    $('choices').innerHTML='<button>Draft '+names[index]+'</button><button>Draft Fixture Decoy</button>';
    [...$('choices').children].forEach(button=>button.onclick=()=>{if(Date.now()>=deadline)return render();const player=button.textContent.slice(6);fixtureTruth.events.push({type:'input',turn:index+1,player,at:Date.now(),remainingMs:deadline-Date.now()});if(player!==names[index]){$('phase').textContent='failed';return;} $('accepted').appendChild(Object.assign(document.createElement('p'),{textContent:'Accepted '+(index+1)+': '+player}));next();});render();}
  $('start').onclick=()=>{$('start').disabled=true;next();};setInterval(render,100);
  </script>`);
  const initial=await observe();
  result=await runPersistentModelLoop({prompt:'You are the model selector in an approved isolated browser experiment. Start the controlled test, then select the exact current recommended player promptly on both turns using visible buttons. Observe each result and complete both picks. Never choose the decoy. Use only exec_browser restricted JSON commands, not JavaScript. Do not wait unnecessarily. The 30-second and 70-second clocks require the same prompt response. After both picks are accepted, finish. Initial visible page: '+JSON.stringify(initial),maxResponses:8,operationBudgetMs:55000,
    respond:async({input,previous_response_id,signal})=>{
      const body={model,input,tools,parallel_tool_calls:false,reasoning:{effort},...(previous_response_id?{previous_response_id}:{})};
      const start=Date.now();const count=await api('responses/input_tokens',body,signal);
      // Reserve a small token-count tolerance, capped at the approved per-request ceiling.
      const ceiling=Math.min(25000,count.input_tokens+256);if(count.input_tokens>25000)throw Error('Input ceiling exceeded');
      const requestId=runId+'-'+requests.length,reservedUsd=budget.reserve({requestId,inputTokens:ceiling,maxOutputTokens:2048});
      const entry={runId,requestId,reservedUsd,state:'reserved'};spend.entries.push(entry);persist();
      const request={requestId,countedInputTokens:count.input_tokens,countMs:Date.now()-start,startedAt:Date.now()};requests.push(request);
      const response=await api('responses',{...body,max_output_tokens:2048},signal);request.finishedAt=Date.now();request.modelMs=request.finishedAt-request.startedAt;request.usage=response.usage;request.status=response.status;request.responseId=response.id;
      fs.writeFileSync(path.join(dir,'response-'+requests.length+'.json'),JSON.stringify(response,null,2));
      if(!response.usage)throw Error('Missing API usage; retain full reservation');
      const u=response.usage;entry.conservativeUsd=budget.settle({requestId,inputTokens:u.input_tokens,outputTokens:u.output_tokens});entry.state='settled';entry.usage=u;
      const cached=u.input_tokens_details?.cached_tokens||0;entry.usageEstimatedUsd=(u.input_tokens-cached)*10/1e6+cached/1e6+u.output_tokens*50/1e6;persist();return response;
    },
    execute:async({code,callId,signal})=>{
      const commands=JSON.parse(code);if(!Array.isArray(commands)||commands.length<1||commands.length>3)throw Error('Invalid browser program');
      for(const command of commands){
        if(stopped||signal.aborted)throw Error('Browser execution stopped');
        if(command.action==='observe')await observe();
        else if(command.action==='wait'){if(!Number.isInteger(command.ms)||command.ms<0||command.ms>500)throw Error('Invalid wait');await page.waitForTimeout(command.ms);}
        else if(command.action==='click'){
          const current=await observe();if(!current.buttons.some(b=>!b.disabled&&b.name===command.button))throw Error('Button not currently available');
          if(current.phase==='drafting'&&Number(current.clock)<10)throw Error('Insufficient ten-second selection reserve');
          const at=Date.now();await page.getByRole('button',{name:command.button,exact:true}).click({timeout:2000});inputs.push({callId,button:command.button,startedAt:at,finishedAt:Date.now()});await observe();
        }else throw Error('Unsupported browser command');
      }return JSON.stringify(await observe());
    },
    completeAfterTool:true,
    verifyComplete:async()=>{const s=await observe();return s.phase==='completed'&&s.text.includes('Accepted 1: Fixture Alpha')&&s.text.includes('Accepted 2: Fixture Beta');},onEvent:e=>{events.push(e);persist();}
  });
}catch(e){error=e.message;stopped=true;}
finally{
  if(page&&!page.isClosed())truth=await page.evaluate(()=>window.fixtureTruth).catch(()=>null);
  await browser?.close();persist();
  const summary={runId,scope:'Real OpenAI model and isolated browser; synthetic standalone UI; NOT Yahoo or Huddle validation',model,effort,result:result||null,error:error||null,requests,inputs,observations,truth,events,accountedUsd:accounted(),runUsageEstimatedUsd:spend.entries.filter(e=>e.runId===runId).reduce((s,e)=>s+(e.usageEstimatedUsd||0),0),unsettledRequests:spend.entries.filter(e=>e.runId===runId&&e.state!=='settled').length};
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({dir,runId,completed:!!result?.completed,error:summary.error,requests:requests.length,inputs:inputs.length,accountedUsd:summary.accountedUsd,runUsageEstimatedUsd:summary.runUsageEstimatedUsd}));
  if(error)process.exitCode=1;
}
