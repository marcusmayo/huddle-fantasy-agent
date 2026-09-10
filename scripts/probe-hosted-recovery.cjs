'use strict';
// Read-only probe; never kills a process or changes draft state.
// Usage: node scripts/probe-hosted-recovery.cjs config.json SESSION BUILD [container OLD_PID]
const {execFileSync}=require('node:child_process');
async function probe({url,sessionId,buildIdentity,processInfo=()=>null,oldPid=null,timeoutMs=10000}){
 const start=performance.now(),samples=[];let ready=null;
 while(performance.now()-start<timeoutMs){
  const sample={elapsedMs:Math.round(performance.now()-start)};
  try{
   const process=processInfo();
   if(process){sample.pid=process.pid;sample.running=process.running;
    if(!process.running||!(process.pid>1)||process.pid===oldPid)throw Error('PROCESS_NOT_READY');}
   const response=await fetch(url,{signal:AbortSignal.timeout(Math.min(1000,Math.max(1,timeoutMs-(performance.now()-start))))});
   sample.status=response.status;if(!response.ok)throw Error('HTTP_NOT_READY');
   const workspace=await response.json();
   if(workspace.session?.id!==sessionId||workspace.session?.buildIdentity!==buildIdentity)throw Error('IDENTITY_MISMATCH');
   sample.picks=workspace.session.picks.length;sample.ready=true;ready=sample;
  }catch(e){sample.error=e.name==='TimeoutError'?'REQUEST_TIMEOUT':String(e.message).slice(0,100);}
  samples.push(sample);if(ready)break;await new Promise(r=>setTimeout(r,100));
 }
 return {scope:'Process and HTTP readiness only; visible recovery must be measured separately',ready:Boolean(ready),elapsedMs:Math.round(performance.now()-start),samples};
}
if(require.main===module){
 const [file,sessionId,buildIdentity,container,old]=process.argv.slice(2),config=require(require('node:path').resolve(file));
 const url=`http://${config.host||'127.0.0.1'}:${config.port}/api/leagues/${encodeURIComponent(config.league.id)}/draft/sessions/${encodeURIComponent(sessionId)}/workspace`;
 const processInfo=container?()=>{const value=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];return {running:value.State.Running,pid:value.State.Pid};}:()=>null;
 probe({url,sessionId,buildIdentity,processInfo,oldPid:Number(old)||null}).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.ready?0:1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={probe};
