(function(){
  'use strict';
  const $=id=>document.getElementById(id),query=new URLSearchParams(location.search);
  const leagueId=query.get('leagueId'),sessionId=query.get('sessionId');
  const valid=Boolean(leagueId&&sessionId),supported=Boolean(window.documentPictureInPicture?.requestWindow);
  const view=new URL('/draft-view.html',location.origin);
  if(valid){view.searchParams.set('leagueId',leagueId);view.searchParams.set('sessionId',sessionId);$('normal').href=view.href;}
  view.searchParams.set('presentation','compact');view.searchParams.set('clockControl','opener');
  let receiver=null,presentation=null,opening=false,lastGeometry=null,stopCheck=()=>{};
  const capture=HuddlePresentationCapture.create({identity:{leagueId,sessionId},getTarget:()=>receiver,
    acquireMedia:()=>navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:10},audio:false}),
    onStatus:message=>{$('capture-status').textContent=message;},onState:state=>{$('connect').disabled=state!=='disconnected';$('disconnect').hidden=state==='disconnected';}});
  $('connect').onclick=()=>capture.connect().catch(error=>{$('capture-status').textContent=error.message;});
  $('disconnect').onclick=()=>capture.disconnect().catch(error=>{$('capture-status').textContent=error.message;});
  $('open').disabled=!valid||!supported;
  $('status').textContent=!valid?'Choose Draft view from an open draft session.':!supported?'This browser cannot open an always-visible draft window. Use the normal draft view.':'Ready to open this draft.';
  function check(frame){
    stopCheck();
    const child=frame.contentWindow,doc=frame.contentDocument,start=performance.now(),gaps=[];
    let last=null,raf=null,ended=false,recheck=null;
    function tick(){if(ended)return;const now=performance.now();if(last!==null)gaps.push(now-last);last=now;raf=child.requestAnimationFrame(tick);}
    raf=child.requestAnimationFrame(tick);
    const finish=()=>{
      if(ended)return;ended=true;child.cancelAnimationFrame(raf);clearTimeout(timer);
      const sorted=[...gaps].sort((a,b)=>a-b),fit=HuddlePresentationFit.measure(doc,child),panels=fit.panels;
      const result={scope:'Presentation preflight only; clock capture and live delivery remain separate gates',durationMs:performance.now()-start,frames:gaps.length,medianMs:sorted[Math.floor(sorted.length/2)]??null,maxMs:sorted.at(-1)??null,visibility:doc.visibilityState,...fit};
      result.passed=gaps.length>=30&&result.maxMs<=250&&result.visibility==='visible'&&result.pageFits&&result.reserveReady&&panels.every(p=>p.visible);
      $('result').textContent=JSON.stringify(result,null,2);
      const geometry={width:result.width,height:result.height,contentHeight:result.contentHeight,pageFits:result.pageFits,reserveReady:result.reserveReady,completed:result.completed};
      const geometryKey=JSON.stringify(geometry);if(geometryKey!==lastGeometry){lastGeometry=geometryKey;receiver?.recordPresentation?.(geometry);}
      recheck=setTimeout(()=>{if(frame.isConnected)check(frame);},1000);
      $('status').textContent=result.passed?'Draft window is open. Presentation check passed; clock and recommendation timing still need verification.':(!result.pageFits||!result.reserveReady)?'Enlarge Huddle: allow '+Math.max(result.requiredHeight,result.reserveHeight)+' pixels of height at the current width ('+result.width+' pixels).':'Presentation timing or required panel visibility did not pass.';
    };
    const timer=setTimeout(finish,5000);
    stopCheck=()=>{ended=true;child.cancelAnimationFrame(raf);clearTimeout(timer);clearTimeout(recheck);};
  }
  $('open').onclick=async()=>{
    if(opening||presentation)return;opening=true;$('open').disabled=true;
    try{
      const pip=await window.documentPictureInPicture.requestWindow({width:960,height:800});presentation=pip;
      pip.document.title='Huddle · Draft recommendations';
      const style=pip.document.createElement('style');style.textContent='html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#091c15}body{display:flex;flex-direction:column}nav{height:28px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 8px;color:#eef8ee;font:12px system-ui}button{font:inherit}iframe{display:block;width:100%;flex:1;min-height:0;border:0}';pip.document.head.append(style);
      const frame=pip.document.createElement('iframe');frame.title='Huddle draft recommendations and reconciliation';frame.allow='display-capture';
      frame.addEventListener('load',()=>{if(presentation===pip){receiver=frame.contentWindow.HuddlePresentationReceiver;const loaded=receiver;if(loaded)loaded.onStopped=()=>{if(receiver===loaded)void capture.disconnect().catch(error=>{$('capture-status').textContent=error.message;});};$('connect').hidden=!receiver;check(frame);}},{once:true});
      frame.src=view.href;pip.document.body.append(frame);
      let resizeTimer;pip.addEventListener('resize',()=>{stopCheck();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(presentation===pip)check(frame);},300);});
      $('close').hidden=false;$('normal').hidden=true;$('status').textContent='Draft window is open. Checking presentation…';
      pip.addEventListener('pagehide',()=>{if(presentation!==pip)return;clearTimeout(resizeTimer);stopCheck();receiver=null;void capture.disconnect().catch(error=>{$('capture-status').textContent=error.message;});$('connect').hidden=true;presentation=null;$('open').disabled=false;$('close').hidden=true;$('normal').hidden=false;$('status').textContent='Draft window closed. Reopen it and reconnect the Yahoo clock to continue. Saved draft results remain in Huddle.';},{once:true});
    }catch(error){$('status').textContent='Could not open the draft window: '+error.message;$('open').disabled=false;}
    finally{opening=false;}
  };
  $('close').onclick=()=>presentation?.close();
  addEventListener('pagehide',()=>{stopCheck();void capture.disconnect().catch(()=>{});presentation?.close();});
})();
