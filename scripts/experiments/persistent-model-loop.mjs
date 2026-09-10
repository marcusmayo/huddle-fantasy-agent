// Offline review prototype. No API client, browser driver, credentials or Yahoo access.
// Adapters must supply an isolated environment and enforce cancellation before live use.
export async function runPersistentModelLoop({respond,execute,verifyComplete,prompt,
  maxResponses=1000,operationBudgetMs=5000,completeAfterTool=false,signal,onEvent=()=>{}}){
  if(!Number.isInteger(maxResponses)||maxResponses<1||!Number.isFinite(operationBudgetMs)||operationBudgetMs<1)
    throw Error('Invalid execution limits');
  let previousResponseId,input=[{role:'user',content:prompt}];
  const handled=new Set();
  const event=(type,details={})=>onEvent({type,at:Date.now(),...details});
  const active=()=>{if(signal?.aborted)throw Error('Run stopped');};
  async function bounded(stage,fn){
    active();const controller=new AbortController();
    const abort=()=>controller.abort(signal?.reason);
    signal?.addEventListener('abort',abort,{once:true});
    let timer,rejectAbort;
    const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(Error('Run stopped'));signal?.addEventListener('abort',rejectAbort,{once:true});});
    try{return await Promise.race([
      Promise.resolve().then(()=>{active();return fn(controller.signal);}),aborted,
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(stage+' timeout; outcome unverified'));},operationBudgetMs);})
    ]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);signal?.removeEventListener('abort',rejectAbort);}
  }
  event('host-started');
  try{
    for(let round=0;round<maxResponses;round++){
      event('response-requested',{round,previousResponseId});
      const response=await bounded('model',s=>respond({input,previous_response_id:previousResponseId,signal:s}));
      active();
      if(response.status!=='completed'||!response.id||!Array.isArray(response.output))throw Error('Incomplete model response');
      previousResponseId=response.id;
      const calls=response.output.filter(x=>x.type==='function_call');
      if(!calls.length){
        if(!await bounded('completion-check',s=>verifyComplete({signal:s})))throw Error('Model stopped before verified draft completion');
        event('completed');return {completed:true,responses:round+1,calls:handled.size};
      }
      if(calls.length!==1)throw Error('Only one ordered browser execution is permitted');
      const call=calls[0];
      if(call.name!=='exec_browser'||!call.call_id||handled.has(call.call_id))throw Error('Unexpected or repeated execution call');
      const args=JSON.parse(call.arguments);
      if(typeof args.code!=='string'||!args.code.trim())throw Error('Missing browser code');
      active();handled.add(call.call_id);event('execution-started',{callId:call.call_id});
      const output=await bounded('browser',s=>execute({code:args.code,callId:call.call_id,signal:s}));
      active();event('execution-finished',{callId:call.call_id});
      if(completeAfterTool&&await bounded('completion-check',s=>verifyComplete({signal:s}))){
        active();event('completed');return {completed:true,responses:round+1,calls:handled.size};
      }
      input=[{type:'function_call_output',call_id:call.call_id,output}];
    }
    throw Error('Response limit reached before completion');
  }catch(error){event('failed',{message:error.message});throw error;}
}
