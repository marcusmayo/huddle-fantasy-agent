'use strict';
const {randomUUID}=require('node:crypto');
// Compact normalized evidence lives with the session and is persisted on each
// event. It does not depend on an editor, browser-control turn or probe timeout.
class DraftTimingEvidence {
  constructor({session,persist,now=Date.now,mono=()=>performance.now(),intervalMs=5000}){
    this.session=session;this.persist=persist;this.now=now;this.mono=mono;this.intervalMs=intervalMs;
    this.runId=randomUUID();this.lastStart=null;
  }
  record(type,details={}){
    const state=this.session();
    const previous=structuredClone(state.timingEvidence);
    const evidence=state.timingEvidence||={version:1,events:[],incomplete:false};
    if(evidence.events.length>=20000){evidence.incomplete=true;this.persist();throw Error('Draft timing evidence capacity reached');}
    const event={sequence:evidence.events.length+1,runId:this.runId,type,at:new Date(this.now()).toISOString(),monoMs:this.mono(),...details};
    evidence.events.push(event);
    if(['interruption','sampling-gap','read-error'].includes(type))evidence.incomplete=true;
    try{this.persist();}catch(error){state.timingEvidence=previous;throw error;}
    return event;
  }
  start(){
    const history=this.session().timingEvidence;
    if(history?.events.length&&!history.events.some(e=>e.type==='completed'))this.record('interruption',{reason:'Collector restarted; intervening coverage is unverified'});
    return this.record('started',{intervalMs:this.intervalMs});
  }
  readStarted(){
    const now=this.mono();
    if(this.lastStart!==null&&now-this.lastStart>this.intervalMs+1000)this.record('sampling-gap',{startToStartMs:now-this.lastStart});
    this.lastStart=now;return this.record('read-started');
  }
  result({pickCount,requestStartedAt,receivedAt}){return this.record('results-received',{pickCount,requestStartedAt,receivedAt,requestElapsedMs:this.lastStart===null?null:this.mono()-this.lastStart});}
  health(){
    const history=this.session().timingEvidence;
    const last=history?.events.at(-1);
    const age=last?Math.max(0,this.now()-Date.parse(last.at)):Infinity;
    const complete=last?.type==='completed';
    return {runId:this.runId,sequence:last?.sequence||0,incomplete:Boolean(history?.incomplete),complete,healthy:complete||age<=this.intervalMs+5000,ageMs:Number.isFinite(age)?age:null};
  }
}
module.exports={DraftTimingEvidence};
