'use strict';
const crypto=require('node:crypto');
const {appendEvent}=require('../domain/decision-audit');
const {pickOwner}=require('../domain/league');
const {isFreshObservation}=require('../domain/observation-time');
const {assertAuthority,authorityBlock}=require('./draft-continuity');
const TTL=10000;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const text=(value,max=120)=>String(value||'').trim().slice(0,max);
const stages=new Set(['watching','preparing','planned','submitting','verifying','uncertain','handoff','stopped']);

function roleManifest(roles, leagueKey, { simulation = false } = {}){
  if(!Array.isArray(roles))fail('CONTROLLER_ROLES_REQUIRED','Identify the Yahoo and Huddle tabs before activating control');
  const result=roles.map(role=>{
    let url;try{url=new URL(role.url);}catch{fail('INVALID_CONTROLLER_ROLE','Each browser role needs an observed URL');}
    if(!['http:','https:'].includes(url.protocol)||!text(role.browserId)||!text(role.tabId))fail('INVALID_CONTROLLER_ROLE','Each browser role needs an exact browser, tab and HTTP location');
    // A Yahoo draft URL may contain an auth token. Never retain its query.
    const frameSelector = text(role.frameSelector, 240);
    if(frameSelector && role.role!=='huddle')fail('INVALID_CONTROLLER_ROLE','Only the Huddle display role may identify an embedded frame');
    return {role:text(role.role),browserId:text(role.browserId),tabId:text(role.tabId),...(frameSelector?{frameSelector}:{}),origin:url.origin,path:url.pathname,protected:true};
  });
  for(const name of ['yahoo','huddle'])if(result.filter(r=>r.role===name).length!==1)fail('CONTROLLER_ROLES_REQUIRED',`Exactly one ${name} role is required`);
  if(new Set(result.map(r=>`${r.browserId}:${r.tabId}:${r.frameSelector||'top'}`)).size!==result.length)fail('CONTROLLER_ROLE_COLLISION','Protected browser roles must have distinct observed surfaces');
  const yahoo=result.find(r=>r.role==='yahoo');
  const allowedOrigin = simulation ? ['127.0.0.1','localhost','[::1]'].includes(new URL(yahoo.origin).hostname) : yahoo.origin==='https://football.fantasysports.yahoo.com';
  if(!allowedOrigin||!/^\/draftclient\/f1\/\d+\/\d+\/?$/.test(yahoo.path))fail('CONTROLLER_YAHOO_ROOM_REQUIRED',simulation?'A simulated room must be on loopback':'The Yahoo role must identify the actual draft room');
  if(simulation)yahoo.simulation=true;
  if(leagueKey&&yahoo.path.split('/')[3]!==String(leagueKey).split('.l.').at(-1))fail('CONTROLLER_ROOM_MISMATCH','The protected Yahoo tab belongs to another league');
  return result;
}

class DraftControllerService{
  constructor(drafts){this.drafts=drafts;this.leases=new Map();this.instanceId=crypto.randomUUID();}
  observation(id,input){
    const session=this.drafts.getSession(id),o=input||{},now=this.drafts.now().getTime();
    const age=now-Date.parse(o.observedAt);
    if(!isFreshObservation(o.observedAt,now))fail('CONTROLLER_OBSERVATION_STALE','Read Yahoo again before reporting active draft control');
    if(Number(o.completedPicks)!==session.picks.length||Number(o.overallPick)!==session.picks.length+1)fail('CONTROLLER_BOARD_MISMATCH','Reconcile Yahoo’s completed board before activating control');
    if(!['waiting','drafting'].includes(o.phase)||o.autodraft!==false||o.manualModeKnown!==true)fail('CONTROLLER_MANUAL_MODE_UNVERIFIED','Confirm the room phase and Yahoo Autodraft OFF');
    const league=this.drafts.league;
    if(session.sourceMode==='yahoo'&&(!league.provenance?.yahooLeagueKey||o.leagueKey!==league.provenance.yahooLeagueKey||!league.provenance?.yahooTeamKey||o.teamKey!==league.provenance.yahooTeamKey))fail('CONTROLLER_ROOM_MISMATCH','The observed Yahoo league and team must match this draft');
    if(!Number.isInteger(Number(o.draftSlot))||Number(o.draftSlot)!==session.draftSlot)fail('CONTROLLER_SEAT_MISMATCH','The observed Yahoo seat must match this session');
    if(o.phase==='drafting'&&(!Number.isFinite(Number(o.secondsLeft))||Number(o.secondsLeft)<=0))fail('CONTROLLER_CLOCK_UNREADABLE','Read a positive Yahoo clock before reporting active control');
    if(o.phase==='drafting'&&o.onClock!==(pickOwner(session.picks.length+1,league.teamCount)===session.draftSlot))fail('CONTROLLER_TURN_MISMATCH','Yahoo turn ownership disagrees with the reconciled snake order');
    return {observedAt:o.observedAt,completedPicks:Number(o.completedPicks),overallPick:Number(o.overallPick),phase:o.phase,
      autodraft:false,manualModeKnown:true,draftSlot:session.draftSlot,secondsLeft:o.phase==='drafting'?Number(o.secondsLeft):null,
      onClock:o.onClock===true,leagueKey:text(o.leagueKey),teamKey:text(o.teamKey)};
  }
  status(id){
    const session=this.drafts.getSession(id),lease=this.leases.get(id),now=this.drafts.now().getTime();
    const heartbeatAgeMs=lease?Math.max(0,now-lease.heartbeatAt):null;
    const ended=session.status==='completed';
    const transferred=Boolean(authorityBlock(this.drafts));
    const active=Boolean(!transferred&&!ended&&lease&&heartbeatAgeMs<TTL&&!['uncertain','handoff','stopped'].includes(lease.stage));
    return {active,instanceId:this.instanceId,controllerId:lease?.controllerId||null,runId:lease?.runId||null,stage:ended?'completed':lease?.stage||'inactive',
      reason:transferred?'Control transferred to local Huddle':ended?'Draft completed':active?'Fresh controller observation':lease?.stage==='uncertain'?'Submission uncertain · verify Yahoo before takeover':lease&&heartbeatAgeMs>=TTL?'Controller heartbeat expired · takeover required':'Draft controller not confirmed · takeover required',
      heartbeatAgeMs,expiresAfterMs:TTL,observation:lease?.observation||null,prepared:lease?.prepared||[],
      roles:lease?.roles||session.controllerCheckpoint?.roles||[],lastCheckpoint:session.controllerCheckpoint||null};
  }
  update(id,input){
    const session=this.drafts.state.sessions[id];if(!session)return this.drafts.getSession(id);
    if(session.status!=='active')fail('DRAFT_SESSION_COMPLETED','Completed drafts cannot activate control');
    let lease=this.leases.get(id);
    const action=input.action;
    if(action!=='stop')assertAuthority(this.drafts,id);
    if(action==='start'){
      if(this.status(id).active)fail('CONTROLLER_ALREADY_ACTIVE','Another controller already holds this draft');
      const events=this.drafts.state.draftAudit.events[id]||[];
      if(events.some(e=>e.type==='submit-started'&&!events.some(a=>(a.type==='accepted'&&a.overallPick===e.overallPick)
        ||(a.type==='input-not-dispatched'&&a.planId===e.planId))))fail('CONTROLLER_PENDING_SUBMISSION','Reconcile the previous submission before another controller can act');
      if(input.handoffAccepted!==true)fail('CONTROLLER_HANDOFF_REQUIRED','An accepted execution handoff is required; readiness alone does not activate control');
      const roles=roleManifest(input.roles,session.sourceMode==='yahoo'?this.drafts.league.provenance?.yahooLeagueKey:null,{simulation:this.drafts.simulation}),observation=this.observation(id,input.observation);
      const local=session.executionAuthority;
      if(local?.mode==='local'&&roles.find(role=>role.role==='huddle')?.origin!==local.origin)fail('LOCAL_DRAFT_DISPLAY_REQUIRED','Use the prepared local Huddle display for this controller');
      const prepared=(input.prepared||[]).map(p=>({yahooPlayerId:text(p.yahooPlayerId,24),name:text(p.name),position:text(p.position,8)}));
      if(prepared.length<(session.picks.length===0?2:1)||new Set(prepared.map(p=>p.yahooPlayerId)).size!==prepared.length||prepared.some(p=>!/^\d+$/.test(p.yahooPlayerId)||!p.name||!['QB','RB','WR','TE','K','DEF'].includes(p.position)))fail('CONTROLLER_PREPARED_PICK_REQUIRED','Prepare an identified first choice and distinct fallback before countdown ends');
      const seen=input.availableObservation;
      const age=this.drafts.now().getTime()-Date.parse(seen?.observedAt);
      if(!seen||!isFreshObservation(seen.observedAt,this.drafts.now().getTime())||seen.overallPick!==observation.overallPick
        ||seen.leagueKey!==observation.leagueKey||seen.teamKey!==observation.teamKey||!Array.isArray(seen.players))fail('CONTROLLER_AVAILABILITY_REQUIRED','Read available Yahoo players for this league, team and board before preparing control');
      for(const choice of prepared){
        const rows=seen.players.filter(p=>String(p.yahooPlayerId)===choice.yahooPlayerId);
        if(rows.length!==1||rows[0].available!==true||text(rows[0].name)!==choice.name||rows[0].position!==choice.position
          ||session.picks.some(p=>String(p.yahooPlayerKey||'').split('.p.').at(-1)===choice.yahooPlayerId))fail('CONTROLLER_PREPARED_IDENTITY_MISMATCH','A prepared choice must match exactly one observed available Yahoo player');
      }
      lease={controllerId:text(input.controllerId)||crypto.randomUUID(),runId:crypto.randomUUID(),token:crypto.randomUUID(),roles,prepared,observation,stage:'watching',heartbeatAt:this.drafts.now().getTime()};
    }else{
      if(!lease||input.token!==lease.token)fail('CONTROLLER_LEASE_REQUIRED','This controller lease is not valid for this running service');
      if(action==='stop'){lease={...lease,stage:'stopped'};}
      else if(action==='heartbeat'){
        if(['uncertain','handoff','stopped'].includes(lease.stage))fail('CONTROLLER_HANDOFF_REQUIRED','Stopped or uncertain control requires a fresh verified handoff');
        if(this.drafts.now().getTime()-lease.heartbeatAt>=TTL)fail('CONTROLLER_LEASE_EXPIRED','Re-verify the board and execution handoff after a control gap');
        const stage=text(input.stage)||lease.stage;
        if(!stages.has(stage))fail('INVALID_CONTROLLER_STAGE','Unknown controller stage');
        lease={...lease,stage,observation:this.observation(id,input.observation),heartbeatAt:this.drafts.now().getTime()};
      }else fail('INVALID_CONTROLLER_ACTION','Controller action must be start, heartbeat or stop');
    }
    const previous=this.leases.get(id);
    // Heartbeat liveness is in memory. Save starts, stage transitions and stops;
    // a process restart must never resurrect an old active-control claim.
    if(action!=='heartbeat'||previous?.stage!==lease.stage){
      const checkpoint={controllerId:lease.controllerId,runId:lease.runId,instanceId:this.instanceId,stage:lease.stage,at:this.drafts.currentIso(),roles:lease.roles,
        prepared:lease.prepared,observation:lease.observation,handoffAccepted:action==='start'||session.controllerCheckpoint?.handoffAccepted===true};
      const old=session.controllerCheckpoint;
      const events=this.drafts.state.draftAudit.events[id]||=[];
      const length=events.length;
      if(!this.drafts.decisionSummary(id).integrityVerified)fail('DECISION_AUDIT_CORRUPT','Decision history integrity must be verified before control changes');
      session.controllerCheckpoint=checkpoint;
      appendEvent(events,{type:'controller-checkpoint',eventId:crypto.randomUUID(),observedAt:checkpoint.at,...checkpoint});
      try{this.drafts.persist();}catch(error){if(old)session.controllerCheckpoint=old;else delete session.controllerCheckpoint;events.splice(length);throw error;}
    }
    this.leases.set(id,lease);
    return {...this.status(id),...(action==='start'?{token:lease.token}:{})};
  }
  assertLease(id,token,expected){
    assertAuthority(this.drafts,id);
    const lease=this.leases.get(id);
    if(!lease||token!==lease.token||!this.status(id).active)fail('CONTROLLER_LEASE_REQUIRED','A fresh active controller lease is required for computer-use submission');
    if(expected&&(lease.controllerId!==expected.controllerId||lease.runId!==expected.controllerRunId))fail('CONTROLLER_RUN_MISMATCH','Create a new decision under this controller run; an old run cannot authorize submission');
    return lease.controllerId;
  }
  assertOwner(id,token,expected){
    const lease=this.leases.get(id);
    // Expiry prevents new input but not an authenticated cancellation receipt.
    if(!lease||token!==lease.token||lease.controllerId!==expected?.controllerId||lease.runId!==expected?.controllerRunId) {
      fail('CONTROLLER_RUN_MISMATCH','Only the original controller run can attest that it issued no browser input');
    }
    return lease.controllerId;
  }
}
module.exports={DraftControllerService,roleManifest,CONTROLLER_TTL_MS:TTL};
