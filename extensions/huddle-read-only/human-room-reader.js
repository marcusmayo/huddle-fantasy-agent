(function(root){
  'use strict';
  // Passive DOM reader: no clicks, searches, page functions or Yahoo requests.
  function readRoom(document, location, config){
    if(location.pathname.replace(/\/$/,'')!==config.roomPath.replace(/\/$/,''))throw Error('Wrong Yahoo room');
    const header=(document.body?.innerText||'').slice(0,1500),lines=header.split('\n').map(s=>s.trim());
    const phase=/Draft Complete/i.test(header)?'completed':/Draft Starting Soon|Waiting room/i.test(header)?'waiting':'drafting';
    const pick=phase==='completed'?config.totalPicks+1:phase==='waiting'?1:Number(header.match(/ROUND\s+\d+,\s*PICK\s+(\d+)/i)?.[1]);
    if(!Number.isInteger(pick)||pick<1||pick>config.totalPicks+1)throw Error('Current draft pick is unreadable');
    const matches=[...header.matchAll(/(?:^|\n)\s*(\d{1,2}):(\d{2})\s*(?=\n|$)/g)];
    const turnLine=lines.findIndex(s=>/ROUND\s+\d+,\s*PICK\s+\d+/i.test(s));
    const short=turnLine>0&&/^\d{1,2}$/.test(lines[turnLine-1])&&Number(lines[turnLine-1])<60?Number(lines[turnLine-1]):null;
    const secondsLeft=matches.length===1&&Number(matches[0][2])<60&&short===null?Number(matches[0][1])*60+Number(matches[0][2]):matches.length===0?short:null;
    if(phase==='drafting'&&!(secondsLeft>0))throw Error('Draft clock is unreadable');
    const auto=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Autodraft' && b.getClientRects().length);
    const inactivity=(document.body?.innerText||'').includes('You have been put into autopick mode due to inactivity.');
    const observation={manualModeKnown:Boolean(auto)&&!inactivity,autodraft:Boolean(auto?.querySelector('[data-icon="checkmark-default"]')),observedAt:new Date().toISOString(),phase,overallPick:pick,completedPicks:pick-1,secondsLeft,
      onClock:phase==='drafting'&&/YOUR TURN\s*•\s*ROUND/i.test(header),leagueKey:config.leagueKey,teamKey:config.teamKey,draftSlot:config.draftSlot};
    const tables=[...document.querySelectorAll('table')].filter(t=>{const h=[...(t.tHead?.rows||[])].flatMap(r=>[...r.cells].map(c=>c.textContent.trim()));return h[0]==='Pick'&&h[1]==='Player';});
    let picks;
    if(tables.length===1){
      picks=[...tables[0].tBodies].flatMap(b=>[...b.rows]).filter(r=>[...r.cells].some(c=>c.tagName==='TD')).map(r=>{
        const player=r.querySelector('.ys-player[data-id]');
        let parts=String(r.cells[1]?.innerText||'').split('\n').map(s=>s.trim()).filter(Boolean);
        // Results may remain mounted while the human uses Players. Read leaf
        // labels if hidden-table innerText no longer supplies line separators.
        if(!parts.some(s=>/^(QB|RB|WR|TE|K|DEF)$/.test(s)))parts=player?[...player.querySelectorAll('*')].filter(e=>!e.children.length).map(c=>c.textContent.trim()).filter(Boolean):[];
        const positionAt=parts.findIndex(s=>/^(QB|RB|WR|TE|K|DEF)$/.test(s));
        const id=player?.getAttribute('data-id');
        if(!/^[1-9]\d*$/.test(id||'')||positionAt<1)throw Error('A draft result has no verified player identity');
        return {overallPick:Number(r.cells[0].textContent.trim()),yahooPlayerId:id,name:player.querySelector('[title]')?.getAttribute('title')||parts[0],
          position:parts[positionAt],team:parts[positionAt+1]||'',isMine:r.cells[2]?.textContent.trim()==='Your Team'};
      }).sort((a,b)=>a.overallPick-b.overallPick);
    }
    return {observation,...(picks?{picks}:{})};
  }
  function start({document,location,config,send,onError=()=>{}}){
    let stopped=false,busy=false,scheduled=null;
    async function tick(){if(stopped||busy)return;busy=true;try{await send(readRoom(document,location,config));}catch(e){onError(e);}finally{busy=false;}}
    const observer=new MutationObserver(()=>{if(scheduled===null)scheduled=setTimeout(()=>{scheduled=null;tick();},100);});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    const timer=setInterval(tick,500);tick();
    return ()=>{stopped=true;observer.disconnect();clearInterval(timer);clearTimeout(scheduled);};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={readRoom,start};else root.HuddleHumanRoom={readRoom,start};
})(globalThis);
