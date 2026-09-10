// Validation only: reads Huddle's rendered cards and operates Yahoo's UI.
// No reconcile, workspace API, clock-feed, controller lease, or pick API exists here.
export const SELECTOR_VERSION='independent-human-selector-terminal-failure-v2';
const fault=(code,message)=>Object.assign(Error(message),{code});
export function createHumanSelector({room,display,identity,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onEvent=()=>{}}){
  if(room.version!=='selector-2026-09-09-v2')throw fault('ADAPTER_VERSION','Load the tested Yahoo adapter');
  const owned=Array.from({length:identity.totalPicks},(_,i)=>i+1).filter(p=>(Math.floor((p-1)/identity.teamCount)%2?identity.teamCount-(p-1)%identity.teamCount:(p-1)%identity.teamCount+1)===identity.draftSlot);
  if(!identity.sessionId||!identity.leagueId||!owned.length)throw fault('IDENTITY','Verify Huddle and Yahoo identities');
  const state={version:SELECTOR_VERSION,stage:'waiting',turns:{},events:[],pending:null,failed:false,completed:false,busy:false,lastObserved:null,operations:[]};
  const emit=(type,details={})=>{const e={type,at:now(),...details};state.events.push(e);onEvent(e);};
  function fail(code,details={}){state.failed=true;emit(code,details);}
  async function call(name,fn,budget=2000){const start=now();try{return await fn({timeoutMs:budget});}finally{const duration=now()-start;state.operations.push({name,start,duration,budget});if(duration>budget){fail('operation-overrun',{name,duration,budget});}}}
  function fresh(o){const age=now()-Date.parse(o.observedAt);return age>=-1000&&age<=5000;}
  function remaining(o){return o.secondsLeft*1000-Math.max(0,now()-Date.parse(o.observedAt))-1000;}
  function validate(o){if(!fresh(o)||o.leagueKey!==identity.leagueKey||o.teamKey!==identity.teamKey)throw fault('ROOM_UNVERIFIED','Fresh matching Yahoo room required');}
  async function cycle(){
    if(state.busy)throw fault('BUSY','Previous invocation has not settled');state.busy=true;
    try{
      let o=await call('observe',options=>room.observe(options));validate(o);
      if(state.lastObserved&&now()-state.lastObserved>5000)fail('observation-gap',{durationMs:now()-state.lastObserved});state.lastObserved=now();
      emit('room-observed',{pick:o.overallPick,secondsLeft:o.secondsLeft,onClock:o.onClock,autodraft:o.autodraft});
      for(const pick of owned.filter(p=>p<o.overallPick)){const turn=state.turns[pick];if(!turn){state.turns[pick]={outcome:'missed-unobserved'};fail('owned-turn-missed',{pick});}else if(turn.outcome==='waiting-for-recommendation'){turn.outcome='expired-unsubmitted';fail('owned-turn-expired',{pick});}}
      const view=await call('display',options=>display.read(options));
      if(view.sessionId!==identity.sessionId||view.leagueId!==identity.leagueId||!fresh(view))throw fault('DISPLAY_IDENTITY','Fresh matching Huddle view required');
      if(state.pending){
        const p=state.pending,a=view.accepted.find(x=>x.overallPick===p.pick);
        if(a){const match=a.yahooPlayerId===p.player.yahooPlayerId;state.turns[p.pick].outcome=match&&p.acknowledged?'manual-accepted':match?'input-uncertain':'different-player';emit('acceptance',{pick:p.pick,outcome:state.turns[p.pick].outcome});if(!match||!p.acknowledged)fail('selection-unverified',{pick:p.pick});state.pending=null;}
        else{state.stage='acceptance-pending';return;}
      }
      // A failed run may still reconcile an issued input, but cannot issue a new one.
      if(state.failed){state.stage='blocked';return;}
      if(o.phase==='completed'){
        if(!view.completed||view.accepted.length!==owned.length)return;
        state.completed=true;state.stage='completed';emit('completed');return;
      }
      if(!o.manualModeKnown||o.autodraft){state.stage='recovery';fail('manual-mode-lost',{pick:o.overallPick});o=await call('recovery',options=>room.recoverManual(options));validate(o);if(o.autodraft||!o.manualModeKnown)throw fault('RECOVERY','Manual recovery unconfirmed');return;}
      if(o.phase!=='drafting'||!o.onClock){state.stage='waiting';return;}
      const turn=state.turns[o.overallPick]||={observedAt:now(),outcome:'waiting-for-recommendation'};
      if(view.overallPick!==o.overallPick||view.stale||!view.allPanelsInFrame){if(remaining(o)<10000)fail('recommendation-deadline',{pick:o.overallPick});return;}
      const choices=view.choices.filter(p=>/^[1-9]\d*$/.test(p.yahooPlayerId));
      if(choices.length!==3)throw fault('CHOICES','Three visible player identities required');
      if(turn.visibleRemainingMs===undefined){turn.visibleRemainingMs=remaining(o);turn.revision=view.recommendationId;emit('recommendation-visible',{pick:o.overallPick,remainingMs:turn.visibleRemainingMs,revision:turn.revision});if(turn.visibleRemainingMs<10000){fail('recommendation-deadline',{pick:o.overallPick});state.stage='blocked';return;}}
      if(remaining(o)<4000){fail('selection-budget',{pick:o.overallPick});return;}
      state.stage='prepare';
      const player=choices[0];const prepared=await call('prepare',options=>room.prepare([player],options));validate(prepared.observation);
      if(state.failed){state.stage='blocked';return;}
      if(prepared.observation.overallPick!==o.overallPick||!prepared.observation.onClock)return;
      // Preparation may change filters. Recheck the displayed recommendation before submission.
      const current=await call('confirm-display',options=>display.read(options));
      if(state.failed){state.stage='blocked';return;}
      if(!fresh(current)||current.recommendationId!==view.recommendationId||current.overallPick!==o.overallPick||current.stale||!current.allPanelsInFrame)return;
      if(remaining(prepared.observation)<2500){fail('selection-budget',{pick:o.overallPick});return;}
      const deadline=Date.parse(prepared.observation.observedAt)+prepared.observation.secondsLeft*1000-1000;
      state.pending={pick:o.overallPick,player,acknowledged:false};turn.outcome='input-pending';state.stage='submit-once';
      try{await call('submit',options=>room.submit({overallPick:o.overallPick,leagueKey:identity.leagueKey,teamKey:identity.teamKey,yahooPlayerId:player.yahooPlayerId,position:player.position,deadline},options),Math.min(2000,deadline-now()));state.pending.acknowledged=true;emit('input-returned',{pick:o.overallPick,playerId:player.yahooPlayerId});}
      catch(e){fail('input-uncertain',{pick:o.overallPick,code:e.code});}
    }catch(e){fail(e.code||'OPERATION_FAILED');state.stage=state.pending?'acceptance-pending':'blocked';}
    finally{state.busy=false;}
  }
  async function runWindow(ms=15000){emit('window-start',{requestedMs:ms});const until=now()+Math.min(ms,20000);do{await cycle();if(state.failed||state.completed||state.stage==='blocked')break;if(now()+2200>=until)break;await sleep(150);}while(now()<until);emit('window-end',{stage:state.stage});return status();}
  function status(){return structuredClone({...state,expectedOwned:owned,passed:state.completed&&!state.failed&&owned.every(p=>state.turns[p]?.outcome==='manual-accepted'&&state.turns[p].visibleRemainingMs>=10000)});}
  return Object.freeze({version:SELECTOR_VERSION,cycle,runWindow,status});
}
