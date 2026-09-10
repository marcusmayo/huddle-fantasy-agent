(function(){
  'use strict';
  const query=new URLSearchParams(location.search),leagueId=query.get('leagueId'),sessionId=query.get('sessionId');
  const $=id=>document.getElementById(id), text=(id,value)=>{$(id).textContent=value||'';};
  const base=`/api/leagues/${encodeURIComponent(leagueId||'')}/draft/sessions/${encodeURIComponent(sessionId||'')}`;
  let workspace=null,receivedAt=0,requestedAt=0,error=null;
  let clockError=null,clockConnecting=false,receiptStatus=null,renderQueued=false;
  const clockConnection=HuddleVisualClockConnection.create({base,onClock:clock=>{if(workspace){workspace.screenClock=clock;render();}},onPreview:canvas=>{const target=$('clock-preview');target.width=canvas.width;target.height=canvas.height;target.getContext('2d').drawImage(canvas,0,0);},onStatus:message=>{clockError=message;render();},onStopped:()=>{window.HuddlePresentationReceiver?.onStopped?.();$('connect-clock').disabled=false;$('connect-clock').textContent='Reconnect Yahoo clock';}});
  const displayTime=HuddleDisplayTime.create({request:HuddleRequests.requestJSON});void displayTime.refresh();
  const model=()=>HuddleDraftView.viewModel(clockError&&workspace?.screenClock?{...workspace,screenClock:{...workspace.screenClock,fresh:false,observation:null,reason:clockError}}:workspace,{now:Date.now()+clockConnection.offsetMs,receivedAt:receivedAt+clockConnection.offsetMs,requestedAt:requestedAt+clockConnection.offsetMs,error});
  const delivery=HuddleDisplayDelivery.create({base,request:HuddleRequests.requestJSON,onStatus:message=>{receiptStatus=message;},onSettled:()=>render()});
  function recordVisible(m){

    const key=m.card.recommendationId;
    const skip=reason=>delivery.trace('receipt-skipped',{reason,recommendationId:key,overallPick:m.current});
    const displayOnly=Boolean(m.api); if((!displayOnly&&!m.human?.enabled)||m.completed)return;
    if(!displayOnly&&!m.human.observation?.onClock)return;
    if(m.stale)return skip('stale');if(document.visibilityState!=='visible')return skip('hidden');
    const choices=[m.card.preferred,m.card.alternatives?.safe,m.card.alternatives?.upside];
    if(choices.some(c=>!c?.player?.id))return skip('choices-missing');
    if(['preferred','safe','upside'].some((id,i)=>$(id).textContent!==choices[i].player.name))return skip('card-changed');
    const panels=['preferred','safe','upside','reasons','recent','roster'].map(id=>{const e=$(id),r=e.getBoundingClientRect(),style=getComputedStyle(e);return {id,visible:Boolean(e.getClientRects().length&&style.visibility==='visible'&&Number(style.opacity)>0&&r.top>=0&&r.left>=0&&r.right<=innerWidth+2&&r.bottom<=innerHeight+2)};});
    if(panels.some(p=>!p.visible))return skip('panels-clipped');
    const body={epoch:clockConnection.epoch,recommendationId:m.card.recommendationId,observationId:m.human?.observationId,overallPick:m.current,playerIds:choices.map(c=>c.player.id),renderedAt:new Date().toISOString(),remainingMs:m.humanRemainingMs,visible:true,panels};
    HuddleReceiptRouting.deliver({model:m,body,delivery,displayBounds:()=>displayTime.bounds(),clockBounds:()=>clockConnection.renderBounds(),uuid:()=>crypto.randomUUID()});
  }
  const meta=choice=>choice?`${choice.player.position} · ${choice.player.team||'team unknown'} · Bye ${choice.player.byeWeek||'unknown'} · ${choice.healthEvidence?.label||'Injury evidence unverified'}`:'No alternative';
  function render(){
    const m=model();if(!m)return;if(m.completed&&clockConnection.connected){clockConnection.stop();}
    $('connect-clock').hidden=query.get('clockControl')==='opener'||!m.context.visualClockEnabled||!m.live||m.completed;$('clock-preview-panel').hidden=!m.context.visualClockEnabled||!m.live||m.completed;
    $('connect-clock').disabled=clockConnecting;
    $('connect-clock').textContent=clockConnecting?'Connecting Yahoo clock':clockConnection.connected?'Disconnect Yahoo clock':'Connect Yahoo clock';
    text('clock-reader-status',clockError);
    document.body.dataset.complete=String(m.completed);document.body.dataset.stale=String(m.stale);
    document.body.dataset.recommendationId=m.card.recommendationId||'';
    document.body.dataset.decisionPlan=m.decision?.type==='plan'?m.decision.hash:m.decision?.planId||'';
    document.body.dataset.sessionId=sessionId;document.body.dataset.leagueId=leagueId;document.body.dataset.turnAgreement=m.turnAgreement;
    document.body.dataset.currentPick=m.current===null?'':String(m.current);
    const local=m.context.localDraft;
    text('environment',`HUDDLE / ${local?'LOCAL DRAFT / ':''}${m.context.simulation?'REPLAY / SIMULATED ROOM':m.live?'LIVE YAHOO':'PRACTICE / '+m.session.sourceMode.toUpperCase()}`);
    text('league',`${m.context.leagueName||leagueId} · ${m.context.teamName||'Team unverified'}`);
    text('identity-detail',`${m.context.instance} · ${location.host} · Seat ${m.session.draftSlot} · ${local?'Yahoo through browser':m.context.accountConnected?'Yahoo connected to this app':m.context.oauthEnabled?'Yahoo not connected to this app':'Yahoo disabled in this app'}`);
    if(local)$('back').textContent='Local draft';
    text('feed',m.feed);$('feed').parentElement.dataset.stale=String(m.stale);text('clock',m.clock);
    text('controller',m.controllerStatus);
    text('human-delivery',m.deliveryMessage);text('receipt-status',receiptStatus);
    text('turn',m.completed?'DRAFT COMPLETE':`${m.stale?'LAST RECEIVED RECOMMENDATION':m.turnAgreement==='unknown'?'LATEST RECONCILED RECOMMENDATION':'HUDDLE RECOMMENDS'} · PICK ${m.current}`);
    text('revision',m.card.recommendationId?`Saved ${m.card.recommendationId.slice(0,8)}`:'Snapshot unverified');
    for(const [id,c] of [['preferred',m.card.preferred],['safe',m.card.alternatives?.safe],['upside',m.card.alternatives?.upside]]){const e=$(id);e.dataset.playerId=c?.player?.id||'';e.dataset.position=c?.player?.position||'';e.dataset.team=c?.player?.team||'';}
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
    text('comparison',m.humanMode?'':m.recommended?`Huddle recommended ${m.recommended}`:m.decision?'Huddle recommendation was not retained for this decision.':'');
    text('decision-reason',m.reason);text('reconciled',`${m.session.picks.length}/${m.session.totalPicks}`);
    text('receipt-detail',m.live?(m.completed?'Final Yahoo results':m.api?'Built-in Yahoo connection · you select in Yahoo':m.human?.enabled?'Development feed · you select in Yahoo':local?'Yahoo results reconciled through browser':m.context.sync?.recurring?'Recurring Yahoo reads active':'Recurring Yahoo reads not active'):'Practice receipts · no live Yahoo write');
    $('recent').replaceChildren(...m.recent.map(p=>{const li=document.createElement('li'),name=document.createElement('span'),owner=document.createElement('small');name.textContent=`${p.overallPick}. ${p.playerName}`;owner.textContent=p.isMine?'YOUR PICK':p.position||'';li.append(name,owner);return li;}));
    text('owned-count',`${m.owned.length} players`);$('roster').replaceChildren(...m.owned.map(p=>{const li=document.createElement('li');li.textContent=`${p.overallPick}. ${p.playerName}`;li.dataset.overallPick=String(p.overallPick);li.dataset.playerId=p.playerId||'';return li;}));
    text('audit-status',m.integrity?`${m.auditStatus} · integrity verified`:'Decision history integrity unverified');$('audit-status').dataset.integrity=String(m.integrity);
    if(renderQueued)return;renderQueued=true;delivery.trace('render-scheduled',{recommendationId:m.card.recommendationId});
    requestAnimationFrame(()=>{const fit=document.documentElement.scrollHeight<=innerHeight+2;text('layout-status',fit?'All panels in frame':'Enlarge Huddle to show all content');$('layout-status').dataset.fit=String(fit);
      // A second frame confirms that a render opportunity occurred. Re-read
      // the model so a slow frame cannot preserve an earlier clock reserve.
      requestAnimationFrame(()=>{renderQueued=false;delivery.trace('render-frame',{recommendationId:workspace?.card.recommendationId});if(workspace?.card.recommendationId!==m.card.recommendationId)delivery.trace('render-superseded',{recommendationId:m.card.recommendationId,currentRecommendationId:workspace?.card.recommendationId});recordVisible(model());});});
  }
  $('back').href=`/?leagueId=${encodeURIComponent(leagueId||'')}`;$('audit').href=base+'/decision-audit';$('download-report').href=base+'/decision-audit?download=1';
  $('connect-clock').onclick=async()=>{if(clockConnecting)return;clockConnecting=true;$('connect-clock').disabled=true;try{if(clockConnection.connected)await clockConnection.stop();else await clockConnection.start();}catch(e){clockError=e.message;}finally{clockConnecting=false;render();}};
  if(query.get('clockControl')==='opener'){
    const button=$('connect-clock');button.hidden=true;
    window.HuddlePresentationReceiver={identity:{leagueId,sessionId},onStopped:null,recordPresentation:geometry=>clockConnection.trace('presentation-geometry',geometry),get available(){const m=model();return Boolean(m?.context.visualClockEnabled&&m.live&&!m.completed);},
      async connect(stream){
        if(clockConnecting||clockConnection.connected)throw Error('Disconnect the existing Yahoo clock first.');
        clockConnecting=true;try{await clockConnection.start({stream});}finally{clockConnecting=false;render();}
      },disconnect:()=>clockConnection.stop()};
  }
  const connection=HuddleWorkspaceConnection.create({url:base,
    request:(url,options)=>HuddleRequests.requestJSON(url,options),
    makeStream:typeof EventSource==='undefined'?null:url=>new EventSource(url),
    onWorkspace(next,timing){
      if(next.session?.id!==sessionId||next.session?.leagueId!==leagueId)throw Object.assign(Error('Draft identity mismatch; open the intended session again.'),{status:404});
      if(workspace?.card.recommendationId!==next.card.recommendationId)receiptStatus=null;
      workspace=next;receivedAt=Date.now();requestedAt=timing.requestedAt;error=null;
      text('connection-status','');$('reconnect-display').hidden=true;
      delivery.trace('workspace-received',{recommendationId:next.card.recommendationId,overallPick:next.session.picks.length+1,transport:timing.transport,...next.streamDelivery});render();
    },
    onError(e){error=e.message;delivery.trace('connection-error',{reason:e.message,status:e.status,code:e.code,recovering:e.recovering===true,attempt:e.attempt,...e.diagnostics});
      text('connection-status',e.recovering?e.message:[401,403].includes(e.status)?'Sign in if required, then reconnect this view.':e.message);
      $('reconnect-display').hidden=false;render();}
  });
  function connect(){connection.start();}
  $('reconnect-display').onclick=connect;
  if(leagueId&&sessionId)connect();else text('feed','Choose Draft view from an open draft session.');
  let ageTimer=setInterval(()=>{displayTime.tick();render();delivery.tick();},1000);addEventListener('resize',render);
  addEventListener('visibilitychange',()=>{delivery.trace(document.visibilityState==='visible'?'page-visible':'page-hidden');delivery.tick();});
  addEventListener('pagehide',()=>{delivery.flush();clockConnection.stop();connection.stop();clearInterval(ageTimer);});
  addEventListener('pageshow',event=>{if(event.persisted&&leagueId&&sessionId){ageTimer=setInterval(()=>{render();delivery.tick();},1000);connect();}});
})();
