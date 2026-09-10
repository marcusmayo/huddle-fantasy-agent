'use strict';
// Diagnostic only. Uses the existing server account; never exports credentials,
// changes league state, persists raw Yahoo payloads or submits a selection.
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),runtime=require(path.join(root,'src/config')).loadRuntimeConfig();
const oauth=require(path.join(root,'src/providers/yahoo-oauth')).createYahooOAuthRuntime(runtime);
const Account=require(path.join(root,'src/services/yahoo-account-service')).YahooAccountService;
const account=new Account({runtime,yahooOAuth:oauth});
const room=process.argv[2];
if(!/^\d+$/.test(room||''))throw Error('Supply the observed Yahoo mock-room ID');
const expectedPicks=Number(process.argv[3]);
if(!Number.isInteger(expectedPicks)||expectedPicks<1)throw Error('Supply the verified total number of draft picks');
const control=runtime.leagues.find(l=>l.yahooLeagueKey)?.yahooLeagueKey;
if(!control)throw Error('An imported control league is required');
const client=account.readClient();client.maxAttempts=1;client.requestTimeoutMs=4000;
const dir=path.join(root,'.media-build','source-timing-'+room);fs.mkdirSync(dir,{recursive:true});
const records=[];let wire=null;
client.fetch=async(url,options={})=>{
  const started=Date.now();
  const response=await fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(4000)]):AbortSignal.timeout(4000)});
  wire={status:response.status,headers:{date:response.headers.get('date'),age:response.headers.get('age'),retryAfter:response.headers.get('retry-after')},headerMs:Date.now()-started};
  return response;
};
function save(){fs.writeFileSync(path.join(dir,'api-evidence.json'),JSON.stringify({room,control,scope:'Authenticated documented endpoint; mock-to-league mapping is a hypothesis, not verified identity',records},null,2));}
function clockFields(value,result=new Set()){
  if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(/clock|deadline|draft_time|draft_status|current_pick|seconds_left/i.test(key))result.add(key);clockFields(child,result);}
  return [...result];
}
async function read(key,phase){
  const started=Date.now();wire=null;
  try{const result=await client.draftResults(key);const row={key,phase,startedAt:new Date(started).toISOString(),receivedAt:new Date().toISOString(),durationMs:Date.now()-started,...wire,pickCount:result.picks.length,picks:result.picks.map(p=>({overallPick:p.overallPick,yahooPlayerKey:p.yahooPlayerKey,teamKey:p.teamKey})),clockFieldNames:clockFields(result.payload)};records.push(row);save();console.log(JSON.stringify({...row,picks:undefined}));return row;}
  catch(error){const row={key,phase,startedAt:new Date(started).toISOString(),receivedAt:new Date().toISOString(),durationMs:Date.now()-started,...wire,errorCode:error.code||error.name,message:String(error.message).slice(0,400)};records.push(row);save();console.log(JSON.stringify(row));return row;}
}
(async()=>{
  console.log(JSON.stringify({phase:'start',room,connected:account.status().connected,control}));
  await read(control,'control-before');
  const keys=[control.split('.l.')[0]+'.l.'+room,'nfl.l.'+room];
  const active=new Set();
  const finished=new Set();
  const terminalStatus=r=>[400,401,403,404,410,429].includes(r.status);
  const observe=(key,r)=>{
    if(r.status===200&&!r.errorCode&&r.pickCount===expectedPicks){finished.add(key);active.delete(key);}
    else if(terminalStatus(r))active.delete(key);
  };
  for(const key of keys){const r=await read(key,'mock-before');if(r.status===200&&!r.errorCode)active.add(key);observe(key,r);if(r.status===429)return;}
  const start=Date.now();
  // Successful sources receive a five-second cadence. Missing/forbidden mappings
  // get only two later checks to establish that the failure persists during play.
  let checkpoint=0;
  while(Date.now()-start<1800000&&finished.size<keys.length){
    await new Promise(r=>setTimeout(r,5000));
    for(const key of [...active]){const r=await read(key,'mock-live');observe(key,r);if(r.status===429)return;}
    const elapsed=Date.now()-start;
    if((checkpoint===0&&elapsed>=90000)||(checkpoint===1&&elapsed>=300000)){
      for(const key of keys.filter(k=>!active.has(k)&&!finished.has(k))){const r=await read(key,'mock-later');observe(key,r);if(r.status===200&&!r.errorCode&&!finished.has(key))active.add(key);if(r.status===429)return;}
      checkpoint++;
    }
  }
  await read(control,'control-after');console.log(JSON.stringify({phase:'finished',room,records:records.length,completedSources:[...finished]}));
})().catch(error=>{console.log(JSON.stringify({phase:'failed',code:error.code||error.name,message:String(error.message).slice(0,300)}));process.exitCode=1;});
