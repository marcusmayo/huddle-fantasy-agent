(function(){
  'use strict';
  const query=new URLSearchParams(location.search),leagueId=query.get('leagueId'),sessionId=query.get('sessionId');
  const $=id=>document.getElementById(id), text=(id,value)=>{$(id).textContent=value||'';};
  const base=`/api/leagues/${encodeURIComponent(leagueId||'')}/draft/sessions/${encodeURIComponent(sessionId||'')}`;
  let workspace=null,receivedAt=0,requestedAt=0,error=null,running=false,timer=null;
  const meta=choice=>choice?`${choice.player.position} · ${choice.player.team||'team unknown'} · Bye ${choice.player.byeWeek||'unknown'} · ${choice.healthEvidence?.label||'Injury evidence unverified'}`:'No alternative';
  function render(){
    const m=HuddleDraftView.viewModel(workspace,{receivedAt,requestedAt,error});if(!m)return;
    document.body.dataset.complete=String(m.completed);document.body.dataset.stale=String(m.stale);
    document.body.dataset.recommendationId=m.card.recommendationId||'';
    document.body.dataset.decisionPlan=m.decision?.type==='plan'?m.decision.hash:m.decision?.planId||'';
    document.body.dataset.currentPick=m.current===null?'':String(m.current);
    const local=m.context.localDraft;
    text('environment',`HUDDLE / ${local?'LOCAL DRAFT / ':''}${m.context.simulation?'REPLAY / SIMULATED ROOM':m.live?'LIVE YAHOO':'PRACTICE / '+m.session.sourceMode.toUpperCase()}`);
    text('league',`${m.context.leagueName||leagueId} · ${m.context.teamName||'Team unverified'}`);
    text('identity-detail',`${m.context.instance} · ${location.host} · Seat ${m.session.draftSlot} · ${local?'Yahoo through browser':m.context.accountConnected?'Yahoo connected to this app':m.context.oauthEnabled?'Yahoo not connected to this app':'Yahoo disabled in this app'}`);
    if(local)$('back').textContent='Local draft';
    text('feed',m.feed);$('feed').parentElement.dataset.stale=String(m.stale);text('clock',m.clock);
    text('controller',m.controllerStatus);
    text('turn',m.completed?'DRAFT COMPLETE':`${m.stale?'LAST RECEIVED RECOMMENDATION':'HUDDLE RECOMMENDS'} · PICK ${m.current}`);
    text('revision',m.card.recommendationId?`Saved ${m.card.recommendationId.slice(0,8)}`:'Snapshot unverified');
    text('preferred',m.completed?'All results reconciled':m.card.preferred?.player.name||'Recommendation unavailable');text('score',m.card.preferred?`${m.card.preferred.score} score`:'');
    text('preferred-meta',m.completed?`${m.owned.length} owned picks · final receipts below`:meta(m.card.preferred));
    const health=m.card.preferred?.healthEvidence;
    const healthLine=health&&(health.designation?.value!=='NONE'||health.practice||health.role)?[health.summary]:[];
    $('reasons').replaceChildren(...(m.completed?[]:[...healthLine,...(m.card.preferred?.why||[])].slice(0,2)).map(reason=>{const li=document.createElement('li');li.textContent=reason;return li;}));
    text('quality',m.completed?'Saved evidence remains available for review.':local?`Saved data: ${new Date(local.sourceFetchedAt).toLocaleString()} · ${Date.now()-Date.parse(local.sourceFetchedAt)>36*3600000?'Source data stale. ':''}${m.card.evidence?.warning||(!m.card.evidence?.complete?'Player evidence incomplete.':'Verify availability in Yahoo.')}`:m.card.evidence?.warning||(!m.card.evidence?.complete?'Player evidence incomplete; review uncertainty.':'Wait estimates are uncalibrated.'));
    for(const key of ['safe','upside']){const choice=m.completed?null:m.card.alternatives?.[key];text(key,choice?.player.name||'—');text(key+'-meta',m.completed?'Draft complete':meta(choice));}
    if(!m.completed&&m.card.alternatives?.safe?.player.id===m.card.alternatives?.upside?.player.id&&m.card.alternatives?.safe)text('upside-meta',$('upside-meta').textContent+' · leads both styles');
    text('decision-type',m.classification);text('decision-status',m.decisionStatus);text('selected',m.decision?.playerName||'No decision recorded for this turn');
    $('selected').closest('section').dataset.classification=m.decision?.classification||'';
    text('comparison',m.recommended?`Huddle recommended ${m.recommended}`:m.decision?'Huddle recommendation was not retained for this decision.':'');
    text('decision-reason',m.reason);text('reconciled',`${m.session.picks.length}/${m.session.totalPicks}`);
    text('receipt-detail',m.live?(m.completed?'Final Yahoo results':local?'Yahoo results reconciled through browser':m.context.sync?.recurring?'Recurring Yahoo reads active':'Recurring Yahoo reads not active'):'Practice receipts · no live Yahoo write');
    $('recent').replaceChildren(...m.recent.map(p=>{const li=document.createElement('li'),name=document.createElement('span'),owner=document.createElement('small');name.textContent=`${p.overallPick}. ${p.playerName}`;owner.textContent=p.isMine?'YOUR PICK':p.position||'';li.append(name,owner);return li;}));
    text('owned-count',`${m.owned.length} players`);$('roster').replaceChildren(...m.owned.map(p=>{const li=document.createElement('li');li.textContent=`${p.overallPick}. ${p.playerName}`;return li;}));
    text('audit-status',m.integrity?`${m.decisions.recommendationSnapshots} saved recommendations · integrity verified`:'Decision history integrity unverified');$('audit-status').dataset.integrity=String(m.integrity);
    requestAnimationFrame(()=>{const fit=document.documentElement.scrollHeight<=innerHeight+2;text('layout-status',fit?'All panels in frame':'More height needed to show every panel');$('layout-status').dataset.fit=String(fit);});
  }
  async function refresh(){
    if(running)return;running=true;const startedAt=Date.now();
    try{const next=await HuddleRequests.requestJSON(base+'/workspace',{timeoutMs:3500});
      if(next.session.id!==sessionId||next.session.leagueId!==leagueId)throw Error('Draft identity mismatch; open the intended session again.');
      workspace=next;receivedAt=Date.now();requestedAt=startedAt;error=null;
    }catch(e){error=e.message;text('feed',error);}finally{running=false;render();timer=setTimeout(refresh,1000);}
  }
  $('back').href=`/?leagueId=${encodeURIComponent(leagueId||'')}`;$('audit').href=base+'/decision-audit';
  if(leagueId&&sessionId)refresh();else text('feed','Choose Draft view from an open draft session.');
  const ageTimer=setInterval(render,1000);addEventListener('resize',render);
  addEventListener('pagehide',()=>{clearTimeout(timer);clearInterval(ageTimer);});
})();
