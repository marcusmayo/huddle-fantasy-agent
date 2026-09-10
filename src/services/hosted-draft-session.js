'use strict';
const {digest}=require('../domain/decision-audit');
function openHostedSession({service,mode,sessionId,draftSlot,leagueKey,teamKey,rulesHash}){
  const fail=message=>{throw Object.assign(Error(message),{code:'HOSTED_SESSION_IDENTITY'});};
  const provenance=service.league.provenance;
  if(provenance?.yahooLeagueKey!==leagueKey||provenance?.yahooTeamKey!==teamKey||digest(service.league)!==rulesHash)fail('Hosted league, team or rules do not match the prepared configuration');
  if(!Number.isInteger(draftSlot)||draftSlot<1||draftSlot>service.league.teamCount)fail('Invalid draft slot');
  if(mode==='create'){
    if(Object.keys(service.state.sessions).length)fail('Existing state requires explicit resume');
    return service.createSession({draftSlot,sourceMode:'yahoo'},{hostedIdentity:{version:1,draftSlot,leagueKey,teamKey,rulesHash,buildIdentity:require('./draft-continuity').codeIdentity(),poolIdentity:digest(service.playerPool)}});
  }
  if(mode!=='resume'||!sessionId)fail('Choose create or resume with the exact saved session ID');
  const s=service.getSession(sessionId);
  const pinned=service.state.hostedDraftIdentity;
  if(!pinned||pinned.version!==1||pinned.sessionId!==sessionId||pinned.rulesHash!==rulesHash||pinned.leagueKey!==leagueKey||pinned.teamKey!==teamKey||pinned.draftSlot!==draftSlot)fail('Persisted hosted identity does not match this resume request');
  if(pinned.buildIdentity!==require('./draft-continuity').codeIdentity()||pinned.poolIdentity!==digest(service.playerPool))fail('Hosted build or player pool differs from the prepared session');
  if(s.leagueId!==service.league.id||s.draftSlot!==draftSlot||s.sourceMode!=='yahoo'||!['active','completed'].includes(s.status))fail('Saved session does not match the prepared draft');
  if(!service.decisionSummary(sessionId).integrityVerified)fail('Saved draft evidence failed integrity validation');
  const picks=s.picks.map(p=>p.overallPick);
  if(new Set(picks).size!==picks.length||picks.some((p,i)=>p!==i+1))fail('Saved picks are not a contiguous unique board');
  if(new Set(s.picks.map(p=>p.playerId)).size!==s.picks.length)fail('Saved board contains duplicate players');
  return s;
}
module.exports={openHostedSession};
