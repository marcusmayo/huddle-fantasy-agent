(function(root){
  'use strict';
  const MINIMUM_SELECTION_MS=10000, MINIMUM_UNCERTAINTY_MS=2000;
  const fail=message=>{throw Error(message);};
  function parse(text,{confidence=100}={}){
    if(confidence<80)fail('Yahoo clock is not clear enough');
    const clocks=[...text.matchAll(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/g)];
    const short=[...text.matchAll(/^\s*(\d{1,2})\s*$/gm)];
    const turns=[...text.matchAll(/Round\s+(\d+)\s*[,•.]?\s*Pick\s+(\d+)/gi)];
    if(clocks.length+short.length!==1||turns.length!==1||(clocks.length&&Number(clocks[0][2])>=60)||(short.length&&Number(short[0][1])>=60))fail('One Yahoo countdown and current pick are required');
    const secondsLeft=clocks.length?Number(clocks[0][1])*60+Number(clocks[0][2]):Number(short[0][1]);
    const overallPick=Number(turns[0][2]),round=Number(turns[0][1]);
    if(!secondsLeft||!overallPick||!round)fail('Yahoo turn is not active');
    const onClock=/YOUR\s+TURN/i.test(text);
    if(!onClock&&!/Pick\s*[^A-Za-z0-9]*You.?re\s+up\s+in/i.test(text))fail('Yahoo turn owner is unreadable');
    return {secondsLeft,overallPick,round,onClock};
  }
  // Clock length never controls recommendation scheduling. New board revisions
  // are rendered immediately; this model only assesses their remaining reserve.
  function remaining(observation,now,uncertaintyMs=MINIMUM_UNCERTAINTY_MS){
    if(!observation||!Number.isFinite(now)||!Number.isFinite(observation.capturedMonoMs)||now<observation.capturedMonoMs)return null;
    return Math.max(0,observation.secondsLeft*1000-(now-observation.capturedMonoMs)-Math.max(MINIMUM_UNCERTAINTY_MS,uncertaintyMs));
  }
  class ClockTracker {
    constructor({maxAgeMs=1500,maxFrameGapMs=1500}={}){this.maxAgeMs=maxAgeMs;this.maxFrameGapMs=maxFrameGapMs;this.previous=null;this.confirmed=null;this.changed=null;this.invalidTurn=null;this.reason='Connect the Yahoo clock';}
    reset(reason){this.previous=null;this.confirmed=null;this.changed=null;this.invalidTurn=null;this.reason=reason;}
    observe(value,{now,completedPicks,draftSlot,teamCount,expectedRoom,observedRoom}){
      this.confirmed=null;
      try {
        if(!expectedRoom||expectedRoom!==observedRoom)fail('Selected Yahoo room does not match');
        if(!Number.isFinite(value.capturedMonoMs)||now<value.capturedMonoMs||now-value.capturedMonoMs>this.maxAgeMs)fail('Yahoo clock frame is stale');
        if(value.overallPick!==completedPicks+1)fail('Waiting for matching Yahoo results');
        if(value.round!==Math.floor((value.overallPick-1)/teamCount)+1)fail('Yahoo round does not match the draft');
        const offset=(value.overallPick-1)%teamCount;
        const owner=value.round%2?offset+1:teamCount-offset;
        if(value.onClock!==(owner===draftSlot))fail('Yahoo turn owner does not match');
        if(this.invalidTurn===value.overallPick)fail('Yahoo timer reset needs a new verified turn');
        const prior=this.previous;this.previous=value;
        if(!this.changed||this.changed.overallPick!==value.overallPick||this.changed.secondsLeft!==value.secondsLeft)this.changed=value;
        if(value.capturedMonoMs-this.changed.capturedMonoMs>1500)fail('Yahoo countdown is paused or frozen');
        if(!prior||prior.overallPick!==value.overallPick)fail('Confirming the Yahoo turn');
        const elapsed=value.capturedMonoMs-prior.capturedMonoMs;
        if(elapsed<=0||elapsed>this.maxFrameGapMs)fail('Waiting for continuous Yahoo clock frames');
        const change=prior.secondsLeft-value.secondsLeft;
        if(change<0){this.invalidTurn=value.overallPick;fail('Yahoo clock changed unexpectedly');}
        if(Math.abs(change-elapsed/1000)>1.25)fail('Yahoo clock changed unexpectedly');
        this.confirmed={...value};this.reason=null;return this.confirmed;
      }catch(error){this.reason=error.message;return null;}
    }
    status(now){
      const current=this.confirmed;
      if(!current||now-current.capturedMonoMs>this.maxAgeMs)return {verified:false,reason:this.reason||'Yahoo clock is stale'};
      const remainingMs=remaining(current,now);
      return {verified:true,observation:current,remainingMs,timely:remainingMs>=MINIMUM_SELECTION_MS};
    }
  }
  const api={parse,remaining,ClockTracker,MINIMUM_SELECTION_MS,MINIMUM_UNCERTAINTY_MS};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HuddleYahooClock=api;
})(globalThis);
