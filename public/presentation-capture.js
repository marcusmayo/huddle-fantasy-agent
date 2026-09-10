(function(root){
  'use strict';
  const release=stream=>stream?.getTracks?.().forEach(track=>track.stop());
  function create({identity,getTarget,acquireMedia,onStatus=()=>{},onState=()=>{}}){
    let epoch=0,active=null,pending=false;
    const valid=target=>target&&target.available!==false&&target.identity?.leagueId===identity.leagueId&&target.identity?.sessionId===identity.sessionId&&typeof target.connect==='function'&&typeof target.disconnect==='function';
    async function disconnect(){
      epoch++;pending=false;const previous=active;active=null;release(previous?.stream);onState('disconnected');onStatus('Clock source disconnected. Reconnect before continuing clock verification.');
      if(previous)await previous.target.disconnect();
    }
    async function connect(){
      if(pending||active)throw Error('A clock connection is already active or pending.');
      const target=getTarget();if(!valid(target))throw Error('Open the intended Huddle draft window first.');
      pending=true;const attempt=++epoch;onState('connecting');let stream;
      try{
        // Keep browser acquisition in the normal tab's user-activation call stack.
        stream=await acquireMedia();
        if(attempt!==epoch||target!==getTarget())throw Error('Draft window changed while sharing was being selected.');
        const tracks=stream.getVideoTracks();if(tracks.length!==1||tracks[0].readyState!=='live')throw Error('A live shared video source is required.');
        active={target,stream};tracks[0].addEventListener('ended',()=>{if(active?.stream===stream)void disconnect().catch(error=>onStatus(error.message));},{once:true});
        await target.connect(stream);
        if(tracks[0].readyState!=='live')throw Error('Sharing ended during clock startup.');
        if(attempt!==epoch||target!==getTarget())throw Error('Draft window closed or changed during clock startup.');
        onState('connected');onStatus('Clock source connected. Timing verification is still required.');
      }catch(error){
        release(stream);
        if(attempt===epoch){const previous=active;active=null;if(previous)try{await previous.target.disconnect();}catch{}onState('disconnected');onStatus(error.message);}
        throw error;
      }finally{if(attempt===epoch)pending=false;}
    }
    return {connect,disconnect,get connected(){return Boolean(active&&!pending);}};
  }
  root.HuddlePresentationCapture={create};
})(globalThis);
