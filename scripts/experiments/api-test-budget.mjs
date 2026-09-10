// Reserve a conservative cost ceiling BEFORE each paid request; no automatic retries.
// Input ceilings must be verified by the API tokenizer for the exact request/history.
export function createApiTestBudget({limitUsd=5,inputUsdPerMillion=10,outputUsdPerMillion=50}={}){
  for(const x of [limitUsd,inputUsdPerMillion,outputUsdPerMillion])if(!Number.isFinite(x)||x<=0)throw Error('Invalid budget');
  const ledger=[];
  const total=()=>ledger.reduce((s,r)=>s+(r.actualUsd??r.reservedUsd),0);
  const cost=(input,output)=>input*inputUsdPerMillion/1e6+output*outputUsdPerMillion/1e6;
  function reserve({requestId,inputTokens,maxOutputTokens}){
    if(ledger.some(r=>r.state==='usage-exceeded'))throw Error('Budget accounting failed; stop test');
    if(!requestId||ledger.some(r=>r.requestId===requestId))throw Error('Missing or duplicate request ID');
    if(!Number.isSafeInteger(inputTokens)||inputTokens<0||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1)throw Error('Verified token ceilings required');
    // These baseline rates do not cover long-context or fast-mode surcharges.
    if(inputTokens>25000||maxOutputTokens>2048)throw Error('Initial test token ceiling exceeded');
    const reservedUsd=cost(inputTokens,maxOutputTokens);
    if(total()+reservedUsd>limitUsd+1e-9)throw Error('Approved budget would be exceeded');
    ledger.push({requestId,inputTokens,maxOutputTokens,reservedUsd,state:'reserved'});return reservedUsd;
  }
  function settle({requestId,inputTokens,outputTokens}){
    const row=ledger.find(r=>r.requestId===requestId);
    if(!row||row.state!=='reserved')throw Error('Request is not pending');
    if(!Number.isSafeInteger(inputTokens)||inputTokens<0||!Number.isSafeInteger(outputTokens)||outputTokens<0)throw Error('Valid API usage required');
    if(inputTokens>row.inputTokens||outputTokens>row.maxOutputTokens){row.actualUsd=cost(inputTokens,outputTokens);row.state='usage-exceeded';throw Error('API usage exceeded reserved bounds; stop test');}
    row.actualUsd=cost(inputTokens,outputTokens);row.state='settled';return row.actualUsd;
  }
  return {reserve,settle,status:()=>({limitUsd,accountedUsd:total(),ledger:structuredClone(ledger)})};
}
