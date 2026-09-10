(function(root){
  'use strict';
  function calibrate({sentWallMs,receivedWallMs,sentMonoMs,receivedMonoMs,serverWallMs}){
    const numbers=[sentWallMs,receivedWallMs,sentMonoMs,receivedMonoMs,serverWallMs];
    if(!numbers.every(Number.isFinite))throw Error('Clock calibration is incomplete');
    const rtt=receivedMonoMs-sentMonoMs,wallElapsed=receivedWallMs-sentWallMs;
    if(rtt<0||rtt>2000||Math.abs(wallElapsed-rtt)>100)throw Error('Clock calibration is uncertain');
    return {offsetMs:serverWallMs-(sentWallMs+receivedWallMs)/2,uncertaintyMs:rtt/2+100,calibratedMonoMs:receivedMonoMs,referenceWallMs:receivedWallMs};
  }
  function serverTimeBounds(sample,{wallMs,monoMs}){
    if(!sample||monoMs<sample.calibratedMonoMs||monoMs-sample.calibratedMonoMs>60000)throw Error('Clock calibration expired');
    if(Math.abs(wallMs-(sample.referenceWallMs+monoMs-sample.calibratedMonoMs))>100)throw Error('Local wall clock changed; recalibration required');
    const center=wallMs+sample.offsetMs;
    return {earliestMs:center-sample.uncertaintyMs,latestMs:center+sample.uncertaintyMs};
  }
  const api={calibrate,serverTimeBounds};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HuddleTimeBounds=api;
})(globalThis);
