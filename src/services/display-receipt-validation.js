'use strict';
function validateDisplayReceipt({input,snapshot,session,now}) {
  const reject=reason=>{throw Object.assign(Error('A visible card matching its saved recommendation is required: '+reason),
    {code:'DISPLAY_RECEIPT_INVALID',details:{reason,overallPick:input.overallPick,currentPick:session.picks.length+1,recommendationId:input.recommendationId}});};
  if(!snapshot)reject('unknown-recommendation');
  if(input.overallPick!==snapshot.overallPick)reject('pick-mismatch');
  const ids=[snapshot.preferred,snapshot.alternatives?.safe,snapshot.alternatives?.upside].map(x=>x?.player?.id);
  if(ids.some(x=>!x)||JSON.stringify(ids)!==JSON.stringify(input.playerIds))reject('player-mismatch');
  if(input.visible!==true)reject('page-hidden');
  const panels=['preferred','safe','upside','reasons','recent','roster'];
  if(!panels.every(id=>input.panels?.some(p=>p.id===id&&p.visible===true)))reject('panels-incomplete');
  if(!Number.isFinite(Date.parse(input.renderedAt)))reject('invalid-render-time');
  const b=input.renderBounds;
  // Unknown client/server offset must not destroy historical visibility evidence.
  // Only calibrated bounds can establish receipt-time freshness, never pick timeliness.
  let timeStatus='unverified';
  if(b){
    if(!Number.isFinite(b.earliestMs)||!Number.isFinite(b.latestMs)||b.latestMs<b.earliestMs||b.latestMs-b.earliestMs>2200)reject('invalid-time-bounds');
    timeStatus=b.earliestMs<=now&&b.latestMs>=now-10000?'bounded':'outside-freshness-window';
  }
  return {displayState:session.status==='active'&&snapshot.reconciledPicks===session.picks.length&&snapshot.overallPick===session.picks.length+1?'current':'historical',
    timeStatus,renderBounds:b?{earliestMs:b.earliestMs,latestMs:b.latestMs}:null};
}
module.exports={validateDisplayReceipt};
