(function(root){
  'use strict';
  let library;
  function load(){return library ||= new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/yahoo-clock/tesseract.min.js';s.onload=resolve;s.onerror=()=>reject(Error('Clock recognition files are unavailable'));document.head.append(s);});}
  async function createRecognizer(){await load();const worker=await Tesseract.createWorker('eng',1,{workerPath:'/vendor/yahoo-clock/worker.min.js',corePath:'/vendor/yahoo-clock',langPath:'/vendor/yahoo-clock',workerBlobURL:false,cacheMethod:'none'});await worker.setParameters({tessedit_pageseg_mode:'11'});return worker;}
  async function createRegionRecognizer(){
    const results=await Promise.allSettled(Array.from({length:3},()=>createRecognizer()));
    const workers=results.filter(r=>r.status==='fulfilled').map(r=>r.value),failed=results.find(r=>r.status==='rejected');
    if(failed){await Promise.allSettled(workers.map(w=>w.terminate()));throw failed.reason;}
    return {regionWorkers:workers,setParameters:p=>workers[0].setParameters(p),recognize:(...args)=>workers[0].recognize(...args),terminate:()=>Promise.allSettled(workers.map(w=>w.terminate()))};
  }
  function invert(canvas){
    const ctx=canvas.getContext('2d',{willReadFrequently:true}),data=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<data.data.length;i+=4){const v=255-Math.max(data.data[i],data.data[i+1],data.data[i+2]);data.data[i]=data.data[i+1]=data.data[i+2]=v;}ctx.putImageData(data,0,0);return canvas;
  }
  function bitmap(canvas){
    const w=canvas.width,h=canvas.height,stride=(w+3)&~3,offset=1078;
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>8000000)throw Error('Clock image dimensions are invalid');
    const bytes=new Uint8Array(offset+stride*h),v=new DataView(bytes.buffer),rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
    bytes[0]=66;bytes[1]=77;v.setUint32(2,bytes.length,true);v.setUint32(10,offset,true);v.setUint32(14,40,true);v.setInt32(18,w,true);v.setInt32(22,h,true);v.setUint16(26,1,true);v.setUint16(28,8,true);v.setUint32(34,stride*h,true);v.setUint32(46,256,true);
    for(let i=0;i<256;i++)bytes.set([i,i,i,0],54+i*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)bytes[offset+(h-1-y)*stride+x]=rgba[(y*w+x)*4];
    return bytes;
  }
  async function recognizeFrame(worker,canvas,bands){
    if(!bands){await worker.setParameters({tessedit_pageseg_mode:'11'});return worker.recognize(bitmap(canvas),{},{blocks:true});}
    if(worker.regionWorkers){
      if(bands.length!==worker.regionWorkers.length)throw Error('Clock recognition region count changed');
      const settled=await Promise.allSettled(bands.map(async(band,index)=>{
        const part=document.createElement('canvas'),reader=worker.regionWorkers[index];part.width=band.width;part.height=band.height;
        try{part.getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,band.top,band.width,band.height,0,0,band.width,band.height);await reader.setParameters({tessedit_pageseg_mode:'7'});return (await reader.recognize(bitmap(part))).data;}
        finally{part.width=part.height=0;}
      }));
      // Drain every job before reuse, including when one region fails.
      const failure=settled.find(r=>r.status==='rejected');if(failure)throw failure.reason;
      const rows=settled.map(r=>r.value);return {data:{text:rows.map(x=>x.text.trim()).join('\n'),confidence:Math.min(...rows.map(x=>x.confidence)),regionTexts:rows.map(x=>x.text.trim())}};
    }
    await worker.setParameters({tessedit_pageseg_mode:'7'});
    const rows=[];
    for(const band of bands){
      const part=document.createElement('canvas');part.width=band.width;part.height=band.height;
      try{part.getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,band.top,band.width,band.height,0,0,band.width,band.height);rows.push((await worker.recognize(bitmap(part))).data);}
      finally{part.width=part.height=0;}
    }
    return {data:{text:rows.map(x=>x.text.trim()).join('\n'),confidence:Math.min(...rows.map(x=>x.confidence))}};
  }
  function prepare(source,width,height,region,inverted=true){
    const r=region||{x:0,y:0,width,height:Math.min(160,height*.2)},scale=2;
    const crops=r.regions||[r],gap=crops.length>1?12:0;
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(Math.max(...crops.map(c=>c.width))*scale);canvas.height=Math.ceil(crops.reduce((sum,c)=>sum+c.height*scale+gap,0));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(gap){ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);}
    let top=0;for(const crop of crops){ctx.drawImage(source,crop.x,crop.y,crop.width,crop.height,0,top,crop.width*scale,crop.height*scale);top+=crop.height*scale+gap;}
    return inverted?invert(canvas):canvas;
  }
  const normalize=s=>String(s||'').toLowerCase().replace(/\s*-\s*h2h\s*$/i,'').replace(/[^a-z0-9]/g,'');
  function locate(data,width,height,roomName){
    const lines=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
    const relevant=lines.filter(l=>/\b\d{1,2}:\d{2}\b|^\s*\d{1,2}\s*$|ROUND|YOUR TURN|YOU.RE UP IN|WAITING TO START/i.test(l.text)||roomName&&normalize(l.text)===normalize(roomName));
    if(relevant.length<2||roomName&&!relevant.some(l=>normalize(l.text)===normalize(roomName)))return null;
    const x=Math.max(0,Math.floor(Math.min(...relevant.map(l=>l.bbox.x0))/2)-15),y=Math.max(0,Math.floor(Math.min(...relevant.map(l=>l.bbox.y0))/2)-10);
    const right=Math.min(width,Math.ceil(Math.max(...relevant.map(l=>l.bbox.x1))/2)+40),bottom=Math.min(Math.min(160,height*.2),Math.ceil(Math.max(...relevant.map(l=>l.bbox.y1))/2)+12);
    const room=lines.filter(l=>roomName&&normalize(l.text)===normalize(roomName));
    const clock=lines.filter(l=>/\b\d{1,2}:\d{2}\b|^\s*\d{1,2}\s*$/.test(l.text));
    const turn=lines.filter(l=>(/ROUND/i.test(l.text)&&/YOUR TURN|YOU.RE UP IN/i.test(l.text))||/WAITING TO START/i.test(l.text));
    let regions;
    // Keep all identity text live; never reuse a recognized room name as evidence.
    // Generous turn padding allows the longer opponent line after YOUR TURN.
    if(room.length===1&&clock.length===1&&turn.length===1&&new Set([room[0],clock[0],turn[0]]).size===3){
      regions=[room[0],clock[0],turn[0]].map((line,index)=>{
        const pad=index===2?180:128;
        const left=Math.max(0,Math.floor(line.bbox.x0/2)-pad),top=Math.max(0,Math.floor(line.bbox.y0/2)-6);
        const right=Math.min(width,Math.ceil(line.bbox.x1/2)+pad),bottom=Math.min(height,Math.ceil(line.bbox.y1/2)+6);
        return {x:left,y:top,width:right-left,height:bottom-top};
      });
    }
    return {x,y,width:right-x,height:bottom-y,clockFormat:clock.length===1&&clock[0].text.includes(':')?'minutes-seconds':'seconds',...(regions?{regions}:{})};
  }
  async function start({stream:providedStream,onObservation,onError,onState=()=>{},onReady=async()=>({}),onTrace=()=>{},onPreview=()=>{}}){
    const stream=providedStream||await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:10},audio:false});
    if(stream.getVideoTracks().length!==1||stream.getVideoTracks()[0].readyState!=='live'){stream.getTracks().forEach(t=>t.stop());throw Error('A live shared video source is required');}
    const track=stream.getVideoTracks()[0],video=document.createElement('video');video.muted=true;video.srcObject=stream;
    let stopped=false,worker,busy=false,pending=null,lastMediaTime=-1,lastCompleted=performance.now(),frameId,watchdog,region=null,dimensions='',epoch=0,lastWorkerEnd=null,inactiveSince=null;
    const costs={discovery:[],compact:[]};
    const release=sample=>{if(sample?.canvas){sample.canvas.width=0;sample.canvas.height=0;}};
    const discard=reason=>{if(pending){onTrace('frame-discarded',{frame:pending.frame,reason});release(pending);pending=null;}};
    const stop=async()=>{if(stopped)return;stopped=true;epoch++;discard('stopped');clearInterval(watchdog);if(frameId)video.cancelVideoFrameCallback?.(frameId);stream.getTracks().forEach(t=>t.stop());video.srcObject=null;await worker?.terminate();onState('Stopped');};
    track.addEventListener('ended',()=>{onError(Error('Yahoo sharing stopped'));stop();});track.addEventListener('mute',()=>onError(Error('Yahoo sharing is unavailable')));
    try{
      onState('Loading the clock reader');worker=await createRegionRecognizer();
      const assertLive=()=>{if(stopped||track.readyState!=='live')throw Error('Yahoo sharing stopped during startup');};
      assertLive();await video.play();assertLive();const config=await onReady();assertLive();
      if(!video.requestVideoFrameCallback)throw Error('This browser cannot verify clock frames');
      async function drain(){
        if(busy||stopped)return;busy=true;
        try{while(pending&&!stopped){
          const sample=pending;pending=null;
          const {canvas,frame,capturedMonoMs,observedAt,discover}=sample,started=performance.now();
          const history=costs[discover?'discovery':'compact'];
          // Expire old cost estimates so a transient stall cannot prevent recovery forever.
          while(history.length&&started-history[0].at>5000)history.shift();
          const estimatedWorkMs=history.length?Math.max(...history.map(x=>x.ms))+50:(discover?900:700),ageMs=started-capturedMonoMs;
          if(sample.epoch!==epoch||ageMs>1300||ageMs+estimatedWorkMs+200>1500){onTrace('frame-discarded',{frame,reason:ageMs>1300?'stale-before-recognition':'insufficient-processing-budget',ageMs,estimatedWorkMs});release(sample);continue;}
          onTrace('worker-dispatch',{frame,queueMs:started-sample.snapshotEndMonoMs,idleMs:lastWorkerEnd===null?null:started-lastWorkerEnd});
          let validGeometry=false;
          try{
            invert(canvas);const prepared=performance.now();
            const {data}=await recognizeFrame(worker,canvas,sample.bands);const recognized=performance.now();lastWorkerEnd=recognized;
            history.push({ms:recognized-started,at:recognized});if(history.length>8)history.shift();
            onTrace('recognition-finished',{frame,snapshotMs:sample.snapshotEndMonoMs-capturedMonoMs,queueMs:started-sample.snapshotEndMonoMs,prepareMs:prepared-started,recognizeCallMs:recognized-prepared,regionCount:sample.bands?.length||1,totalMs:recognized-capturedMonoMs,width:canvas.width,height:canvas.height});
            if(stopped||sample.epoch!==epoch){onTrace('frame-discarded',{frame,reason:'lifecycle-changed'});continue;}
            if(performance.now()-capturedMonoMs>1500)throw Error('Clock recognition took too long');
            if(config.roomName&&!data.text.split('\n').some(line=>normalize(line)===normalize(config.roomName)))throw Error('Selected Yahoo room does not match');
            if(discover){
              if(data.confidence<80)throw Error('Yahoo clock is not clear enough');
              region=locate(data,sample.width,sample.height,config.roomName);validGeometry=Boolean(region);
              onTrace('region-located',{frame,region});
              if(region){
                // Discovery locates geometry only. Its old pixels never establish
                // freshness; pending discovery frames must not prolong warm-up.
                discard('discovery-complete');onTrace('geometry-ready',{frame,elapsedMs:performance.now()-capturedMonoMs});
                onPreview(canvas);continue;
              }
              throw Error('Yahoo header geometry is not established');
            }
            validGeometry=Boolean(region);
            if(data.confidence>=80&&/WAITING TO START/i.test(data.text)){
              inactiveSince=null;lastCompleted=performance.now();onTrace('waiting-for-turn',{frame});onState('Header ready; waiting for Yahoo turn');continue;
            }
            if(sample.bands&&region.clockFormat==='minutes-seconds'&&!/^\d{1,2}:\d{2}$/.test(data.regionTexts?.[1]||''))throw Error('Yahoo countdown crop is incomplete; reacquiring header');
            const parsed=HuddleYahooClock.parse(data.text,{confidence:data.confidence});inactiveSince=null;
            const elapsed=performance.now()-capturedMonoMs;if(elapsed>1500)throw Error('Clock recognition took too long');
            onPreview(canvas);
            lastCompleted=performance.now();onObservation({...parsed,capturedMonoMs,observedAt,recognitionMs:elapsed,confidence:data.confidence,headerText:data.text,frame,source:'yahoo-visible-tab'});
          }catch(error){if(!stopped&&sample.epoch===epoch){const inactive=validGeometry&&error.message==='Yahoo turn is not active';if(inactive&&inactiveSince===null)inactiveSince=performance.now();if(!inactive||performance.now()-inactiveSince>=1000){region=null;inactiveSince=null;epoch++;discard('region-invalidated');}onTrace('recognition-rejected',{frame,reason:error.message});onError(error);}}
          finally{release(sample);}
        }}finally{busy=false;}
      }
      function readFrame(now,meta){
        if(stopped)return;frameId=video.requestVideoFrameCallback(readFrame);
        const capturedMonoMs=performance.now(),observedAt=new Date().toISOString(),frame=meta.presentedFrames;
        onTrace('frame-callback',{frame,mediaTime:meta.mediaTime,presentationTime:meta.presentationTime,expectedDisplayTime:meta.expectedDisplayTime,callbackLagMs:capturedMonoMs-now,busy,visibility:document.visibilityState});
        if(meta.mediaTime<=lastMediaTime)return;lastMediaTime=meta.mediaTime;
        const width=video.videoWidth,height=video.videoHeight,size=width+'x'+height;
        if(size!==dimensions){dimensions=size;region=null;epoch++;discard('resized');}
        // Every compact frame still recognizes room, clock and turn. Rediscover
        // on resize or rejected geometry, not on a timer that interrupts fresh reads.
        const discover=!region;
        // Snapshot pixels now, not when the asynchronous worker becomes available.
        // Only one in-flight image and one replaceable pending image are retained.
        discard('superseded');
        try{
          const canvas=prepare(video,width,height,discover?null:region,false);
          let top=0;const bands=!discover&&region?.regions?.map(c=>{const b={top,width:c.width*2,height:c.height*2};top+=b.height+12;return b;});
          pending={canvas,frame,capturedMonoMs,observedAt,snapshotEndMonoMs:performance.now(),width,height,discover,epoch,bands};
          onTrace('frame-start',{frame,capturedMonoMs,discover,snapshotMs:pending.snapshotEndMonoMs-capturedMonoMs});
          return drain();
        }catch(error){onError(error);}
      }
      let watchdogDue=performance.now()+500;
      frameId=video.requestVideoFrameCallback(readFrame);lastCompleted=performance.now();watchdog=setInterval(()=>{const now=performance.now();onTrace('scheduler-check',{lagMs:Math.max(0,now-watchdogDue),visibility:document.visibilityState});watchdogDue=now+500;if(now-lastCompleted>2000)onError(Error('Fresh Yahoo clock readings are unavailable'));},500);
      onState('Confirming Yahoo clock');return {stop};
    }catch(error){await stop();throw error;}
  }
  root.HuddleYahooClockReader={start,createRecognizer,createRegionRecognizer,prepare,locate,bitmap,recognizeFrame};
})(globalThis);
