// Shared paid-test transport. Credentials never enter browser/model context or logs.
import fs from 'node:fs';
import path from 'node:path';
import {createApiTestBudget} from './api-test-budget.mjs';
export function createPaidSession({runId,dir,tools}){
  const spendPath=path.resolve('.media-build/api-agent-spend.json');
  const spend=fs.existsSync(spendPath)?JSON.parse(fs.readFileSync(spendPath,'utf8')):{limitUsd:5,entries:[]};
  const accounted=()=>spend.entries.reduce((n,e)=>n+(e.conservativeUsd??e.reservedUsd),0);
  if(accounted()>=5)throw Error('Approved cumulative budget exhausted');
  const budget=createApiTestBudget({limitUsd:5-accounted()});
  const line=fs.readFileSync('.media-build/api-agent.env','utf8').split(/\r?\n/).find(x=>/^OPENAI_API_KEY\s*=/.test(x));
  const key=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');if(!key)throw Error('API credential missing');
  const requests=[],model='gpt-6-astra',effort='xhigh';
  const persist=()=>{fs.writeFileSync(spendPath,JSON.stringify(spend,null,2));fs.writeFileSync(path.join(dir,'requests.json'),JSON.stringify(requests,null,2));};
  async function api(endpoint,body,signal){
    const r=await fetch('https://api.openai.com/v1/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    const data=await r.json();if(!r.ok)throw Error('OpenAI HTTP '+r.status+' '+(data.error?.code||data.error?.type||'request_failed'));return data;
  }
  async function respond({input,previous_response_id,signal}){
    const body={model,input,tools,parallel_tool_calls:false,reasoning:{effort},...(previous_response_id?{previous_response_id}:{})};
    const countStart=Date.now(),count=await api('responses/input_tokens',body,signal);
    if(!Number.isSafeInteger(count.input_tokens)||count.input_tokens>25000)throw Error('Input count unverified or ceiling exceeded');
    const ceiling=Math.min(25000,count.input_tokens+256),requestId=runId+'-'+requests.length;
    const reservedUsd=budget.reserve({requestId,inputTokens:ceiling,maxOutputTokens:2048});
    const entry={runId,requestId,reservedUsd,state:'reserved'};spend.entries.push(entry);
    const request={requestId,countedInputTokens:count.input_tokens,countMs:Date.now()-countStart,startedAt:Date.now()};requests.push(request);persist();
    const response=await api('responses',{...body,max_output_tokens:2048},signal);
    request.finishedAt=Date.now();request.modelMs=request.finishedAt-request.startedAt;request.usage=response.usage;request.status=response.status;request.responseId=response.id;
    fs.writeFileSync(path.join(dir,'response-'+requests.length+'.json'),JSON.stringify(response,null,2));
    if(!response.usage){persist();throw Error('Missing usage; reservation retained');}
    const u=response.usage;
    try{entry.conservativeUsd=budget.settle({requestId,inputTokens:u.input_tokens,outputTokens:u.output_tokens});entry.state='settled';entry.usage=u;
      const cached=u.input_tokens_details?.cached_tokens||0;entry.usageEstimatedUsd=(u.input_tokens-cached)*10/1e6+cached/1e6+u.output_tokens*50/1e6;
    }finally{persist();}
    return response;
  }
  return {respond,status:()=>({model,effort,requests,accountedUsd:accounted(),runUsageEstimatedUsd:spend.entries.filter(e=>e.runId===runId).reduce((n,e)=>n+(e.usageEstimatedUsd||0),0),unsettledRequests:spend.entries.filter(e=>e.runId===runId&&e.state!=='settled').length})};
}
