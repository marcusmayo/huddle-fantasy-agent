'use strict';
// Local wall-clock proof. A named fixture actor chooses players; the companion
// only reads DOM. This does not test installed-extension transport or Yahoo.
const fs=require('node:fs'),path=require('node:path');
const {buildApp}=require('../src/server');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {pickOwner}=require('../src/domain/league');
const {scoringFingerprint}=require('../src/domain/league-projections');
const clock=Number(process.argv[2]||30),full=clock===70,teams=full?6:8,slot=full?1:8;
const league={...require('../config/leagues/yahoo-example.json'),id:`human-browser-${clock}`,name:`Human feed rehearsal · ${clock}s`,targetTeam:'TEST ACTOR',teamCount:teams,
 roster:full?{QB:2,WR:4,RB:3,TE:1,'W/T':1,'W/R':1,K:1,DEF:2,BN:5,IR:2}:{QB:1,RB:2,WR:2,TE:1,'R/W/T':1,K:1,DEF:1,BN:6},
 provenance:{yahooLeagueKey:'nfl.l.99000123',yahooTeamKey:'nfl.l.99000123.t.2'}};
const players=Array.from({length:240},(_,i)=>({id:`p${i}`,yahooPlayerKey:`nfl.p.${1000+i}`,name:`Test Player ${i}`,position:['QB','RB','WR','TE','RB','WR','DEF','K'][i%8],team:'SEA',byeWeek:5+i%10,
 expertRank:i+1,adp:i+1,projectedPoints:400-i,floor:300-i*.5,ceiling:450-i,projectionLeagueId:league.id,projectionScoringFingerprint:scoringFingerprint(league),projectionScoringVerified:true,projectionSource:'synthetic'}));
const app=buildApp({host:'127.0.0.1',port:0,instanceName:'HUMAN FEED LOCAL TEST',draftSimulation:true,league,playerPool:{players,complete:true,season:2026,source:'synthetic'},
 fantasyProsSyncEnabled:false,yahooOAuthEnabled:false,yahooDraftAutoSyncEnabled:false,leagueOnboardingEnabled:false},
 {storeFactory:()=>new MemoryStateStore(),yahooAccount:{status:()=>({connected:false})},yahooOAuth:{enabled:false,tokenStore:{configured:false}},yahooOperations:{draftStatus:()=>({recurring:false})}});
const d=app.draftService,session=d.createSession({draftSlot:slot,sourceMode:'yahoo'}),config=d.humanFeed.pair(session.id,{clockSeconds:clock});
const picks=[];let phase='waiting',deadline=null,due=null,startedAt=null,finishedAt=null,origin;
const mine=()=>picks.length<120&&pickOwner(picks.length+1,teams)===slot;
function schedule(){deadline=Date.now()+clock*1000;due=Date.now()+(mine()?(full?3500:4500):100);}
const base=`/api/leagues/${league.id}/draft/sessions/${session.id}`;
const view=`/draft-view.html?leagueId=${league.id}&sessionId=${session.id}`;
function report(){const w=d.workspace(session.id),turns=Object.values(w.humanFeed.turns),expected=full?20:15;
 return {scope:'Actual browser DOM reader and Huddle rendering; loopback transport; synthetic test actor, no Yahoo or installed extension',clock,startedAt,finishedAt,
 completedPicks:w.session.picks.length,expectedOwned:expected,delivered:turns.filter(t=>t.delivered&&!t.failed).length,failedPicks:w.humanFeed.failedPicks,
 minimumRemainingMs:Math.min(...turns.filter(t=>t.delivered).map(t=>t.minimumRemainingMs)),controllerActive:w.controller.active,
 executionEvents:w.decisions.events.filter(e=>e.type==='submit-started').length,
 passed:w.session.picks.length===120&&turns.length===expected&&turns.every(t=>t.closed&&t.delivered&&!t.failed)&&!w.controller.active,
 audit:d.exportDecisionAudit(session.id)};}
const send=(res,data)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/proof/state')return send(res,{phase,picks,secondsLeft:deadline?Math.max(0,Math.ceil((deadline-Date.now())/1000)):null,mine:mine()});
 if(url.pathname==='/proof/report'){const r=report();fs.mkdirSync(path.resolve(__dirname,'../.media-build'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,`../.media-build/human-browser-${clock}.json`),JSON.stringify(r,null,2));return send(res,r);}
 if(url.pathname==='/proof/start'&&req.method==='POST'){if(phase==='waiting'){phase='drafting';startedAt=new Date().toISOString();schedule();}return send(res,{phase});}
 if(url.pathname===config.roomPath){
   res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(`<!doctype html><html><meta charset="utf-8"><title>Human feed ${clock}s · LOCAL TEST</title>
   <style>body{margin:0;font:14px system-ui;display:grid;grid-template-columns:1fr 1fr;height:100vh;background:#eff4f0}.room{padding:12px;overflow:auto}iframe{border:0;width:100%;height:100%}td{padding:3px}button{padding:10px}.ys-player span{display:block}</style>
   <section class="room"><h2>Independent human feed · ${clock}s test</h2><p>A fixture actor makes picks. The companion only reads this screen.</p><div id="clock">Waiting</div><div id="turn">Draft Starting Soon</div><button id="start">Start full-draft test</button><p id="status"></p><table><thead><tr><th>Pick</th><th>Player</th><th>Team</th></tr></thead><tbody></tbody></table></section><iframe title="Huddle" src="${view}"></iframe>
   <script src="/human-room-reader.js"></script><script>
   const config=${JSON.stringify(config)},base=${JSON.stringify(base)},teams=${teams};
   document.getElementById('start').onclick=()=>fetch('/proof/start',{method:'POST'});
   let rendered=-1;async function update(){try{const s=await(await fetch('/proof/state')).json();document.getElementById('clock').textContent=s.phase==='drafting'?Math.floor(s.secondsLeft/60)+':'+String(s.secondsLeft%60).padStart(2,'0'):s.phase;
   document.getElementById('turn').textContent=s.phase==='waiting'?'Draft Starting Soon':s.phase==='completed'?'Draft Complete':(s.mine?'Your Turn • ':'')+'Round '+Math.ceil((s.picks.length+1)/teams)+', Pick '+(s.picks.length+1);
   document.getElementById('start').hidden=s.phase!=='waiting';if(rendered!==s.picks.length){rendered=s.picks.length;document.querySelector('tbody').replaceChildren(...s.picks.map(p=>{const r=document.createElement('tr');for(const value of [p.overallPick,null,p.isMine?'Your Team':'Other Team']){const c=document.createElement('td');if(value!==null)c.textContent=value;else{const e=document.createElement('div');e.className='ys-player';e.dataset.id=p.yahooPlayerId;for(const v of [p.name,p.position,p.team]){const n=document.createElement('span');n.textContent=v;e.append(n);}c.append(e);}r.append(c);}return r;}));}}finally{setTimeout(update,200);}}update();
   HuddleHumanRoom.start({document,location,config,send:async snapshot=>{const response=await fetch(base+'/human-feed',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+config.token},body:JSON.stringify(snapshot)});if(!response.ok)throw Error((await response.json()).message);},onError:e=>{document.getElementById('status').textContent=e.message;}});
   </script></html>`);return;
 }
 original(req,res);
});
const timer=setInterval(()=>{if(phase!=='drafting'||Date.now()<due)return;
 const p=mine()?d.recommendation(session.id).preferred?.player:players.find(p=>!picks.some(x=>x.yahooPlayerId===p.yahooPlayerKey.split('.p.')[1]));
 if(!p){due=Date.now()+1000;return;}
 picks.push({overallPick:picks.length+1,yahooPlayerId:p.yahooPlayerKey.split('.p.')[1],name:p.name,position:p.position,team:p.team,isMine:mine()});
 if(picks.length===120){phase='completed';deadline=null;finishedAt=new Date().toISOString();}else schedule();
},50);
app.server.on('close',()=>clearInterval(timer));
app.server.listen(0,'127.0.0.1',()=>{origin=`http://127.0.0.1:${app.server.address().port}`;console.log(JSON.stringify({url:origin+config.roomPath,report:origin+'/proof/report',view:origin+view}));});
