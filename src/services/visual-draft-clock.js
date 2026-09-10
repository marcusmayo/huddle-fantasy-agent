'use strict';
const {randomUUID}=require('node:crypto');
const {parse,ClockTracker}=require('../../public/yahoo-clock-model');
const {appendEvent}=require('../domain/decision-audit');
const normalize=s=>String(s||'').toLowerCase().replace(/\s*-\s*h2h\s*$/i,'').replace(/[^a-z0-9]/g,'');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
class VisualDraftClock {
  constructor(drafts){this.drafts=drafts;this.connections=new Map();}
  evidence(id,type,details={}){
    const d=this.drafts,s=d.state.sessions[id],journal=s.clockEvidence||={version:2,events:[],incomplete:false};
    if(journal.events.length>=50000){journal.incomplete=true;return;}
    journal.events.push({sequence:journal.events.length+1,type,at:d.currentIso(),...details});
    if(!this.flushTimer){this.flushTimer=setTimeout(()=>{this.flushTimer=null;try{d.store.save(d.state);}catch(e){journal.incomplete=true;journal.persistenceError=e.message;}},1000);this.flushTimer.unref?.();}
  }
  trace(id,input,token){
    const c=this.connections.get(id);
    if(!c||c.token!==token)fail('CLOCK_CONNECTION_REQUIRED','Reconnect the Yahoo clock');
    if(!Array.isArray(input.events)||input.events.length>100)fail('CLOCK_TRACE_INVALID','Invalid trace batch');
    for(const event of input.events){if(!event||typeof event.type!=='string'||event.type.length>60||JSON.stringify(event).length>3000)fail('CLOCK_TRACE_INVALID','Invalid trace event');this.evidence(id,'client-trace',{epoch:c.epoch,event});}
    if(input.lost>0){this.drafts.state.sessions[id].clockEvidence.incomplete=true;this.evidence(id,'client-trace-loss',{count:input.lost});}
    return {accepted:input.events.length};
  }
  pair(id){
    const d=this.drafts,s=d.getSession(id),p=d.league.provenance;
    if(s.sourceMode!=='yahoo'||s.status!=='active'||!p?.yahooLeagueKey||!p?.yahooTeamKey)fail('CLOCK_SESSION_REQUIRED','Connect an active Yahoo draft first');
    if(d.controllers.status(id).active)fail('CLOCK_EXECUTOR_ACTIVE','The human clock feed requires independent operation');
    const token=randomUUID();this.connections.set(id,{token,epoch:randomUUID(),tracker:new ClockTracker(),advanceTracker:new ClockTracker(),lastAdvance:0,recent:new Map(),invalidations:[],error:null});
    d.state.sessions[id].visualClock ||= {enabled:true,turns:{}};
    d.state.sessions[id].visualClock.enabled=true;d.persist();this.evidence(id,'connected');
    return {token,epoch:this.connections.get(id).epoch,roomName:d.league.name,leagueKey:p.yahooLeagueKey,teamKey:p.yahooTeamKey,draftSlot:s.draftSlot,teamCount:d.league.teamCount};
  }
  observe(id,input,token){
    const c=this.connections.get(id),d=this.drafts,s=d.getSession(id),now=d.now().getTime();
    if(!c||c.token!==token)fail('CLOCK_CONNECTION_REQUIRED','Reconnect the Yahoo clock');
    try{
      if(typeof input.headerText!=='string'||input.headerText.length>4000)fail('CLOCK_HEADER_INVALID','Yahoo clock text is invalid');
      if(!Number.isFinite(input.confidence)||!Number.isFinite(input.recognitionMs)||input.recognitionMs<0||input.recognitionMs>1500)fail('CLOCK_RECOGNITION_INVALID','Yahoo recognition timing is unverified');
      const reading=parse(input.headerText,{confidence:input.confidence});
      const {earliestMs,latestMs}=input.capturedAt||{};
      if(!Number.isFinite(earliestMs)||!Number.isFinite(latestMs)||latestMs<earliestMs||latestMs-earliestMs>1000||earliestMs>now||now-earliestMs>1500)fail('CLOCK_SAMPLE_STALE','Yahoo clock timing is stale or uncertain');
      if(!Number.isInteger(input.frame)||input.frame<= (c.lastFrame??-1))fail('CLOCK_FRAME_OLD','Waiting for a new Yahoo frame');
      c.lastFrame=input.frame;
      const room=normalize(d.league.name);
      const matched=input.headerText.split('\n').some(line=>normalize(line)===room);
      // A confirmed visual advance may request results, but never certifies a
      // clock/card against an unreconciled board. No pixels become player picks.
      if(reading.overallPick>s.picks.length+1&&reading.overallPick<=s.totalPicks){
        const advance=c.advanceTracker.observe({...reading,capturedMonoMs:earliestMs},{now,completedPicks:reading.overallPick-1,draftSlot:s.draftSlot,teamCount:d.league.teamCount,expectedRoom:room,observedRoom:matched?room:''});
        if(advance&&reading.overallPick>c.lastAdvance){
          c.lastAdvance=reading.overallPick;this.evidence(id,'board-refresh-requested',{overallPick:reading.overallPick,frame:input.frame});
          this.onBoardAdvance?.(id,reading.overallPick);
        }
      }
      const observed=c.tracker.observe({...reading,capturedMonoMs:earliestMs},{now,completedPicks:s.picks.length,draftSlot:s.draftSlot,teamCount:d.league.teamCount,expectedRoom:room,observedRoom:matched?room:''});
      if(!observed)fail('CLOCK_UNVERIFIED',c.tracker.reason);
      const key=randomUUID();const p=d.league.provenance;
      c.error=null;c.observationId=key;c.observation={observedAt:new Date(earliestMs).toISOString(),secondsLeft:reading.secondsLeft,overallPick:reading.overallPick,completedPicks:reading.overallPick-1,phase:'drafting',onClock:reading.onClock,draftSlot:s.draftSlot,leagueKey:p.yahooLeagueKey,teamKey:p.yahooTeamKey,source:'yahoo-visible-tab',timingUncertaintyMs:2000,frame:input.frame};
      Object.assign(c.observation,{epoch:c.epoch,recognitionMs:input.recognitionMs,confidence:input.confidence,capturedAt:input.capturedAt});
      c.recent.set(key,c.observation);for(const [k,o]of c.recent)if(now-Date.parse(o.observedAt)>10000)c.recent.delete(k);
      const sampleKey=reading.overallPick+':'+reading.secondsLeft;
      if(c.sampleKey!==sampleKey){this.evidence(id,'clock-observed',{observationId:key,observation:c.observation,capturedAt:input.capturedAt});c.sampleKey=sampleKey;}
      const turns=d.state.sessions[id].visualClock.turns;
      let changed=false;
      for(let pick=1;pick<=s.picks.length;pick++){
        if(!s.picks[pick-1].isMine||turns[pick]?.closed)continue;
        turns[pick]={...turns[pick],closed:true,failed:Boolean(turns[pick]?.failed)};changed=true;
      }
      if(changed)this.evidence(id,'turns-reconciled',{pickCount:s.picks.length});return this.status(id);
    }catch(e){c.error=e.message;c.observation=null;c.invalidations.push({at:now,reason:e.message});c.invalidations=c.invalidations.filter(x=>now-x.at<10000);this.evidence(id,'clock-unverified',{reason:e.message,frame:input.frame,epoch:c.epoch});throw e;}
  }
  status(id){
    const s=this.drafts.getSession(id),h=this.drafts.state.sessions[id].visualClock;
    if(!h?.enabled)return null;
    const c=this.connections.get(id),o=c?.observation,now=this.drafts.now().getTime();
    const age=now-Date.parse(o?.observedAt);
    const fresh=Boolean(!c?.error&&o&&age>=0&&age<=1500&&o.completedPicks===s.picks.length);
    const turns=structuredClone(h.turns);
    for(const pick of s.picks.filter(p=>p.isMine)){
      const old=turns[pick.overallPick];
      const advanced=this.drafts.state.sessions[id].timingEvidence?.events.find(e=>e.type==='board-reconciled'&&e.pickCount>=pick.overallPick);
      const pendingUntil=advanced?Date.parse(advanced.at)+5000:0;
      turns[pick.overallPick]={...old,closed:true,pendingUntil:!old?.delivered?pendingUntil:0,failed:Boolean(old?.failed||(!old?.delivered&&now>=pendingUntil))};
    }
    return {enabled:true,source:'yahoo-visible-tab',fresh,observation:o||null,observationId:c?.observationId,uncertaintyMs:2000,turns,traceIncomplete:Boolean(this.drafts.state.sessions[id].clockEvidence?.incomplete),failedPicks:Object.entries(turns).filter(([,v])=>v.failed).map(([k])=>Number(k)),reason:c?.error||(!fresh?'Yahoo clock is unverified':'Yahoo display clock observed')};
  }
  delivered(id,input){
    const d=this.drafts,c=this.connections.get(id),now=d.now().getTime();
    const events=d.state.draftAudit.events[id]||=[];
    const previous=events.find(e=>e.receiptId===input.receiptId&&typeof input.receiptId==='string');
    if(previous)return {applied:false,timely:previous.timely,remainingMs:previous.remainingMs,receiptId:previous.receiptId};
    try{
      const o=c?.recent.get(input.observationId),bounds=input.renderBounds;
      if(typeof input.receiptId!=='string'||input.receiptId.length>100||input.epoch!==c?.epoch)fail('CLOCK_RECEIPT_ID','The receipt must match this clock connection');
      if(!o?.onClock||o.overallPick!==input.overallPick||!bounds||!Number.isFinite(bounds.earliestMs)||!Number.isFinite(bounds.latestMs)||bounds.latestMs<bounds.earliestMs||bounds.latestMs-bounds.earliestMs>1000||bounds.earliestMs>now||bounds.latestMs>now+500||now-bounds.earliestMs>5000||bounds.earliestMs<Date.parse(o.observedAt)||bounds.latestMs-Date.parse(o.observedAt)>1500)fail('CLOCK_DELIVERY_STALE','A fresh matching Yahoo clock at the bounded render time is required');
      if(c.invalidations.some(x=>x.at>=Date.parse(o.observedAt)&&x.at<=bounds.latestMs))fail('CLOCK_DELIVERY_UNCERTAIN','The clock was unverified during rendering');
      const advanced=(d.state.sessions[id].timingEvidence?.events||[]).some(e=>e.type==='board-reconciled'&&e.pickCount>o.completedPicks&&Date.parse(e.at)<=bounds.latestMs);
      if(advanced)fail('CLOCK_DELIVERY_MISMATCH','The board advanced before this render');
      const snapshot=d.state.draftAudit.recommendations[id]?.find(x=>x.id===input.recommendationId);
      const ids=[snapshot?.preferred,snapshot?.alternatives?.safe,snapshot?.alternatives?.upside].map(x=>x?.player?.id);
      if(!snapshot||snapshot.overallPick!==o.overallPick||snapshot.reconciledPicks!==o.completedPicks||ids.some(x=>!x)||JSON.stringify(ids)!==JSON.stringify(input.playerIds)||input.visible!==true)fail('CLOCK_DELIVERY_MISMATCH','The matching recommendation and alternatives must be visible');
      const remainingMs=o.secondsLeft*1000-(bounds.latestMs-Date.parse(o.observedAt))-2000,timely=remainingMs>=10000;
      const h=d.state.sessions[id].visualClock,old=h.turns[o.overallPick],eventCount=events.length;
      h.turns[o.overallPick]={...old,delivered:Boolean(old?.delivered||timely),failed:Boolean(old?.failed||!timely),minimumRemainingMs:Math.min(old?.minimumRemainingMs??Infinity,remainingMs),revisions:[...new Set([...(old?.revisions||[]),snapshot.id])]};
      appendEvent(events,{type:'human-recommendation-visible',eventId:randomUUID(),receiptId:input.receiptId,epoch:c.epoch,observedAt:d.currentIso(),renderBounds:bounds,overallPick:o.overallPick,recommendationId:snapshot.id,playerIds:ids,remainingMs,timely,observation:o,source:'yahoo-visible-tab'});
      try{d.persist();}catch(error){if(old)h.turns[o.overallPick]=old;else delete h.turns[o.overallPick];events.splice(eventCount);throw error;}
      this.evidence(id,'receipt-accepted',{receiptId:input.receiptId,timely,remainingMs,acknowledgedAt:d.currentIso()});
      return {applied:true,timely,remainingMs,receiptId:input.receiptId};
    }catch(e){this.evidence(id,'receipt-rejected',{receiptId:input.receiptId,reason:e.message,code:e.code});throw e;}
  }
}
module.exports={VisualDraftClock};
