(function(root){
  'use strict';
  // Display evidence has its own lifecycle; optional clock capture is unrelated.
  function create({base,request,storage=root.localStorage,now=Date.now,mono=()=>performance.now(),uuid=()=>crypto.randomUUID(),onStatus=()=>{},onSettled=()=>{}}){
    const storageKey='huddle-display-v1:'+base;
    let state={pending:[],trace:[],lost:0,done:[]},flushing=false,stopped=false;
    const active=new Set();
    try{const saved=JSON.parse(storage?.getItem(storageKey)||'null');if(saved&&Array.isArray(saved.pending)&&Array.isArray(saved.trace)&&Array.isArray(saved.done))state=saved;}catch{}
    state.pending=state.pending.slice(-30);state.trace=state.trace.slice(-1000);state.done=state.done.slice(-500);
    state.failures=state.failures||{};state.outcomes=state.outcomes||{};
    function persist(){try{storage?.setItem(storageKey,JSON.stringify(state));}catch{state.lost++;onStatus('Display evidence storage unavailable');}}
    function trace(type,details={}){
      if(state.trace.length>=1000){state.lost++;persist();return;}
      state.trace.push({id:uuid(),type,wallMs:now(),monoMs:mono(),...details});persist();
    }
    function has(key){const f=state.failures[key];return state.done.includes(key)||state.pending.some(x=>x.key===key)||Boolean(f&&(f.count>=3||now()<f.nextAt));}
    function enqueue(key,path,body){
      if(has(key))return false;
      if(state.pending.length>=30){trace('receipt-skipped',{recommendationId:body.recommendationId,overallPick:body.overallPick,reason:'outbox-capacity'});return false;}
      const entry={key,path,body,attempts:0,nextAt:now(),expiresAt:now()+30000};state.pending.push(entry);persist();
      trace('receipt-rendered',{receiptId:body.receiptId,recommendationId:body.recommendationId,overallPick:body.overallPick});tick();return true;
    }
    function finish(entry,reason){state.pending=state.pending.filter(x=>x!==entry);
      state.outcomes[entry.body.receiptId]={key:entry.key,state:reason,at:now()};
      if(reason==='receipt-acknowledged'){state.done.push(entry.key);state.done=state.done.slice(-500);delete state.failures[entry.key];}
      else{const old=state.failures[entry.key];state.failures[entry.key]={count:(old?.count||0)+1,nextAt:now()+1000};}
      const entries=Object.entries(state.outcomes);if(entries.length>1000)state.outcomes=Object.fromEntries(entries.slice(-1000));
      persist();trace(reason,{receiptId:entry.body.receiptId,recommendationId:entry.body.recommendationId||entry.key,overallPick:entry.body.overallPick});}
    async function send(entry){
      active.add(entry.key);entry.attempts++;persist();trace('receipt-send',{receiptId:entry.body.receiptId,attempt:entry.attempts,overallPick:entry.body.overallPick});
      try{
        const result=await request(base+entry.path,{method:'POST',timeoutMs:1500,body:JSON.stringify(entry.body)});
        finish(entry,'receipt-acknowledged');onStatus(result.timing==='unknown'?'Display saved; selection timing unverified':result.timely===false?'Display was late; timing requirement missed':'Timing evidence saved');
      }catch(e){
        trace('receipt-error',{receiptId:entry.body.receiptId,overallPick:entry.body.overallPick,reason:e.details?.reason||e.code||'NETWORK_ERROR',attempt:entry.attempts});
        const retryable=!e.status&&!e.code||['REQUEST_TIMEOUT','REQUEST_ABORTED','DISPLAY_RESULTS_STALE'].includes(e.code)||e.status===429||e.status>=500;
        if(retryable&&entry.attempts<5&&now()<entry.expiresAt){entry.nextAt=now()+Math.min(4000,250*2**entry.attempts);persist();onStatus('Display evidence waiting to retry');}
        else{finish(entry,'receipt-terminal');onStatus('Display evidence unverified; failure saved');}
      }finally{active.delete(entry.key);onSettled();}
    }
    async function flush(){
      if(flushing||!state.trace.length)return;flushing=true;const batch=state.trace.slice(0,50);
      try{await request(base+'/display-trace',{method:'POST',timeoutMs:1500,body:JSON.stringify({events:batch,lost:state.lost})});const ids=new Set(batch.map(x=>x.id));state.trace=state.trace.filter(x=>!ids.has(x.id));persist();}catch{}finally{flushing=false;}
    }
    function tick(){if(stopped)return;for(const entry of [...state.pending]){
      if(active.has(entry.key))continue;
      if(now()>entry.expiresAt){finish(entry,'receipt-expired');continue;}
      // One slow receipt cannot block the next turn. Concurrency stays bounded.
      if(active.size<2&&entry.nextAt<=now())void send(entry);
    }void flush();}
    return {trace,has,enqueue,tick,flush,stop(){stopped=true;persist();return flush();},snapshot:()=>JSON.parse(JSON.stringify(state))};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.HuddleDisplayDelivery={create};
})(globalThis);
