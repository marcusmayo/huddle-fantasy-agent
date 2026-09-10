(function(root){
  'use strict';
  function create({base,onStatus,onStopped=()=>{},onClock=()=>{},onPreview=()=>{}}){
    let active=null,lastCalibration=null;
    const request=(path,options)=>HuddleRequests.requestJSON(path,options);
    function trace(type,details={}){const s=active;if(!s)return;if(s.trace.length>=2000){s.lost++;return;}s.trace.push({type,monoMs:performance.now(),wallMs:Date.now(),...details});}
    async function flush(s){if(!s.token||s.flushing||!s.trace.length)return;s.flushing=true;const events=s.trace.splice(0,100);try{await request(base+'/visual-clock',{method:'POST',headers:{authorization:'Bearer '+s.token},timeoutMs:2000,body:JSON.stringify({action:'trace',events,lost:s.lost})});}catch{ s.lost+=events.length;}finally{s.flushing=false;}}
    async function calibrate(s){
      if(s.calibrating)return s.calibrating;
      s.calibrating=(async()=>{const sentWallMs=Date.now(),sentMonoMs=performance.now();const result=await request('/api/clock-time',{timeoutMs:2000});
        const c=HuddleTimeBounds.calibrate({sentWallMs,sentMonoMs,receivedWallMs:Date.now(),receivedMonoMs:performance.now(),serverWallMs:result.serverWallMs});
        if(active!==s||s.stopped)return;c.id=++s.calibrationId;s.calibrations.push(c);s.calibrations=s.calibrations.slice(-4);lastCalibration=c;trace('calibrated',{calibrationId:c.id,uncertaintyMs:c.uncertaintyMs});
      })();try{await s.calibrating;}finally{s.calibrating=null;}
    }
    function bounds(s,wallMs,monoMs){for(const c of [...s.calibrations].reverse()){try{return {...HuddleTimeBounds.serverTimeBounds(c,{wallMs,monoMs}),calibrationId:c.id};}catch{}}throw Error('Clock calibration expired; refreshing');}
    async function drain(s){
      if(s.sending||s.stopped)return;s.sending=true;
      try{while(s.pending&&!s.stopped&&active===s){const o=s.pending;s.pending=null;
        try{let capturedAt;try{capturedAt=bounds(s,Date.parse(o.observedAt),o.capturedMonoMs);}catch(e){await calibrate(s);trace('sample-skipped',{frame:o.frame,reason:'calibration-refresh'});continue;}
          if(performance.now()-o.capturedMonoMs>1300){trace('sample-skipped',{frame:o.frame,reason:'expired-in-queue'});continue;}
          trace('observation-send',{frame:o.frame,capturedAt});
          const result=await request(base+'/visual-clock',{method:'POST',headers:{authorization:'Bearer '+s.token},timeoutMs:1500,body:JSON.stringify({headerText:o.headerText,confidence:o.confidence,recognitionMs:o.recognitionMs,frame:o.frame,capturedAt})});
          if(active!==s||s.stopped)break;trace('observation-accepted',{frame:o.frame,observationId:result.observationId});onClock(result);onStatus(null);
        }catch(e){if(active===s&&!s.stopped){trace('observation-rejected',{frame:o.frame,reason:e.message});onStatus(e.message);}}
      }}finally{s.sending=false;}
    }
    async function stop(){const s=active;if(!s||s.stopped)return;s.stopped=true;s.pending=null;clearInterval(s.timer);trace('disconnected');await s.reader?.stop();await flush(s);onClock(null);onStatus('Yahoo clock disconnected');onStopped();}
    async function start({stream}={}){
      if(active&&!active.stopped)throw Error('Disconnect the existing clock first');
      const s={stopped:false,pending:null,sending:false,calibrations:[],calibrationId:0,trace:[],lost:0};active=s;
      try{
        // Reader invokes getDisplayMedia synchronously; calibration happens only after selection.
        s.reader=await HuddleYahooClockReader.start({stream,onReady:async()=>{const pair=await request(base+'/visual-clock',{method:'POST',body:JSON.stringify({action:'pair'}),timeoutMs:3000});s.token=pair.token;s.epoch=pair.epoch;await calibrate(s);return pair;},onPreview,onTrace:trace,
          onState:m=>{if(active!==s)return;onStatus(m);if(m==='Stopped'&&!s.stopped){s.stopped=true;clearInterval(s.timer);flush(s);onStopped();}},
          onError:e=>{if(active===s&&!s.stopped){trace('reader-error',{reason:e.message});onStatus(e.message);}},
          onObservation:o=>{if(s.stopped||active!==s)return;if(s.pending)trace('sample-superseded',{frame:s.pending.frame,byFrame:o.frame});s.pending=o;drain(s);}});
        if(s.stopped||active!==s){await s.reader.stop();return;}
        s.timer=setInterval(()=>{flush(s);const c=s.calibrations.at(-1);if(!c||performance.now()-c.calibratedMonoMs>30000)calibrate(s).catch(e=>onStatus(e.message));},1000);
      }catch(e){await stop();throw e;}
    }
    return {start,stop,trace,renderBounds(){if(!active||active.stopped)throw Error('Yahoo clock disconnected');return {...bounds(active,Date.now(),performance.now()),epoch:active.epoch};},get epoch(){return active?.epoch;},get connected(){return Boolean(active?.reader&&!active.stopped);},get offsetMs(){return lastCalibration?.offsetMs||0;}};
  }
  root.HuddleVisualClockConnection={create};
})(globalThis);
