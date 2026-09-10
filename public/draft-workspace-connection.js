(function(root){
  'use strict';
  // Heartbeats prove transport liveness only. Source freshness remains in the workspace.
  function create({url,request,makeStream,onWorkspace,onError=()=>{},now=Date.now,
    setTimer=setTimeout,clearTimer=clearTimeout,quietMs=3000,pollMs=1000}){
    let active=false,generation=0,stream=null,watch=null,retry=null,pollTimer=null,
      controller=null,lastEvent=0,revision=0,retryMs=1000,denialAttempts=0,denialDeadline=null;
    function clearDenial(){denialAttempts=0;clearTimer(denialDeadline);denialDeadline=null;}
    function closeStream(){const old=stream;stream=null;old?.close();clearTimer(watch);}
    function stop(){active=false;generation++;closeStream();clearTimer(retry);retry=null;
      clearTimer(pollTimer);pollTimer=null;controller?.abort();controller=null;clearDenial();}
    function report(error){
      const ambiguous=[401,403].includes(error.status)&&error.code==='INVALID_RESPONSE';
      if(ambiguous){
        denialAttempts++;closeStream();clearTimer(retry);retry=null;
        if(denialAttempts<=3){
          onError(Object.assign(new Error('Draft connection could not be verified; retrying briefly.'),error,
            {message:'Draft connection could not be verified; retrying briefly.',recovering:true,attempt:denialAttempts}));
          if(!denialDeadline)denialDeadline=setTimer(()=>{
            stop();onError(Object.assign(new Error('Connection remains unavailable. Sign in if required, then reconnect this view.'),
              {status:error.status,code:'RECOVERY_EXHAUSTED',recovering:false}));
          },4500);
          return false;
        }
      }
      onError(error);if([401,403,404].includes(error.status)){stop();return true;}return false;
    }
    async function poll(){
      pollTimer=null;if(!active||controller)return;
      const token=generation,at=now(),seen=revision,abort=new AbortController();controller=abort;
      try{const value=await request(url+'/workspace',{timeoutMs:1500,signal:abort.signal});
        if(active&&token===generation&&seen===revision){onWorkspace(value,{requestedAt:at,transport:'poll'});clearDenial();}
      }catch(error){if(active&&token===generation)report(error);}
      finally{if(controller===abort)controller=null;
        if(active&&token===generation&&!stream&&!pollTimer)pollTimer=setTimer(poll,denialAttempts?250:pollMs);}
    }
    function fallback(error){
      if(!active)return;closeStream();if(report(error))return;
      if(!controller&&!pollTimer)void poll();
      if(!retry&&!denialAttempts){retry=setTimer(()=>{retry=null;connect();},retryMs);retryMs=Math.min(10000,retryMs*2);}
    }
    function connect(){
      if(!active)return;
      if(!makeStream){if(!controller&&!pollTimer)void poll();return;}
      let candidate;const token=generation;
      try{candidate=makeStream(url+'/workspace-stream');stream=candidate;lastEvent=now();}
      catch(error){fallback(error);return;}
      const current=()=>active&&generation===token&&stream===candidate;
      function check(){if(!current())return;
        if(now()-lastEvent>=quietMs)return fallback(new Error('Draft connection silent; restoring updates.'));
        watch=setTimer(check,Math.min(1000,quietMs));}
      watch=setTimer(check,Math.min(1000,quietMs));
      candidate.addEventListener('heartbeat',()=>{if(current())lastEvent=now();});
      candidate.addEventListener('workspace',event=>{if(!current())return;
        try{const value=JSON.parse(event.data);onWorkspace(value,{requestedAt:now(),transport:'stream'});
          clearDenial();revision++;lastEvent=now();retryMs=1000;clearTimer(pollTimer);pollTimer=null;
        }catch(error){fallback(error);}});
      candidate.addEventListener('unavailable',()=>{if(current())fallback(new Error('Draft updates unavailable; reconnecting.'));});
      candidate.onerror=()=>{if(current())fallback(new Error('Draft connection interrupted; restoring updates.'));};
    }
    function start(){stop();active=true;connect();}
    return Object.freeze({start,stop});
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create};
  else root.HuddleWorkspaceConnection={create};
})(globalThis);
