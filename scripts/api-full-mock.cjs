'use strict';
// Controlled full draft. Synthetic API and actor; never connects to Yahoo.
const fs=require('node:fs'),path=require('node:path');
const {buildApp}=require('../src/server');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {YahooReadOnlyClient}=require('../src/providers/yahoo');
const {pickOwner}=require('../src/domain/league');
const {scoringFingerprint}=require('../src/domain/league-projections');
const clock=Number(process.argv[2]||30),lag=Number(process.argv[3]||0),total=120,slot=8;
if(!Number.isFinite(clock)||clock<10||!Number.isFinite(lag)||lag<0)throw Error('Invalid clock or publication lag');
const league={...require('../config/leagues/yahoo-example.json'),id:'api-full-mock',name:'CONTROLLED MOCK — synthetic API',targetTeam:'TEST ACTOR',teamCount:8,roster:{QB:1,RB:2,WR:2,TE:1,'R/W/T':1,K:1,DEF:1,BN:6},provenance:{yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.8',verificationStatus:'verified'}};
const players=Array.from({length:300},(_,i)=>({id:'p'+i,yahooPlayerKey:'999.p.'+(1000+i),name:'Fixture Player '+i,position:['QB','RB','WR','TE','RB','WR','DEF','K'][i%8],team:'SEA',byeWeek:5+i%10,expertRank:i+1,adp:i+1,projectedPoints:400-i,floor:300-i*.5,ceiling:450-i,projectionLeagueId:league.id,projectionScoringFingerprint:scoringFingerprint(league),projectionScoringVerified:true,projectionSource:'synthetic'}));
let phase='waiting',deadline=0,due=0,startedAt=null,finishedAt=null,reads=0;const board=[],turns=[],receipts=[];
const mine=()=>pickOwner(board.length+1,8)===slot;
const client=new YahooReadOnlyClient({accessToken:'fixture',fetchImpl:async()=>{reads++;return {ok:true,json:async()=>({draft_result:board.filter(p=>Date.now()-p.acceptedAt>=lag).map(p=>({pick:p.pick,player_key:p.key,team_key:p.team}))})};}});
const runtime={host:'127.0.0.1',port:0,instanceName:'CONTROLLED MOCK · synthetic feed · no Yahoo traffic',league,defaultLeagueId:league.id,leagues:[{id:league.id,config:league,yahooLeagueKey:league.provenance.yahooLeagueKey,yahooTeamKey:league.provenance.yahooTeamKey,verificationStatus:'verified',stateFile:'unused.json'}],playerPool:{players,source:'synthetic',complete:true,season:2026},yahooOAuthEnabled:false,yahooDraftAutoSyncEnabled:true,yahooDraftPollIntervalMs:5000,fantasyProsSyncEnabled:false};
const app=buildApp(runtime,{storeFactory:()=>new MemoryStateStore(),yahooAccount:{status:()=>({connected:false}),readClient:()=>client},yahooOAuth:{enabled:false,tokenStore:{configured:false}}});
const d=app.draftService,s=d.createSession({draftSlot:slot,sourceMode:'yahoo'});
function next(){deadline=Date.now()+clock*1000;due=Date.now()+150;if(mine())turns.push({pick:board.length+1,startedAt:Date.now(),deadline,receipt:null,selection:null});}
function report(){const session=d.getSession(s.id),owned=turns.filter(t=>t.receipt);return {scope:'Controlled synthetic API full draft, not live Yahoo',clockSeconds:clock,publicationLagMs:lag,startedAt,finishedAt,sourcePicks:board.length,reconciledPicks:session.picks.length,expectedOwned:15,ownedTurns:turns.length,timelyVisible:owned.filter(t=>t.receipt.remainingMs>=10000).length,selectedFollowingVisible:turns.filter(t=>t.selection==='visible-recommendation').length,autodrafts:turns.filter(t=>t.selection==='autodraft').length,minimumRemainingMs:owned.length?Math.min(...owned.map(t=>t.receipt.remainingMs)):null,apiReads:reads,controllerActive:d.workspace(s.id).controller.active,integrityVerified:d.decisionSummary(s.id).integrityVerified,turns,passed:board.length===total&&session.picks.length===total&&turns.length===15&&turns.every(t=>t.receipt?.remainingMs>=10000&&t.selection==='visible-recommendation')};}
const send=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/proof/start'&&req.method==='POST'){if(phase==='waiting'){phase='drafting';startedAt=new Date().toISOString();next();app.yahooOperations.startDraftSync({leagueId:league.id,sessionId:s.id});}return send(res,{phase});}
 if(url.pathname==='/proof/report'){const r=report();fs.mkdirSync(path.resolve(__dirname,'../.media-build'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,`../.media-build/api-full-${clock}-${lag}.json`),JSON.stringify(r,null,2));return send(res,r);}
 if(url.pathname==='/proof/visible'&&req.method==='POST'){let data='';for await(const c of req)data+=c;if(data.length>8000)return send(res,{error:'large'},400);const x=JSON.parse(data),turn=turns.at(-1),w=d.workspace(s.id),names=[w.card.preferred,w.card.alternatives.safe,w.card.alternatives.upside].map(c=>c?.player.name);
  if(phase==='drafting'&&mine()&&turn&&!turn.receipt&&x.visible&&x.pick===board.length+1&&w.session.picks.length===board.length&&x.recommendationId===w.card.recommendationId&&JSON.stringify(x.names)===JSON.stringify(names)&&names.every(Boolean)&&Date.now()<=deadline){turn.receipt={receivedAt:Date.now(),remainingMs:deadline-Date.now(),recommendationId:x.recommendationId,names,playerId:w.card.preferred.player.id};due=Date.now()+10000;receipts.push(turn.receipt);}
  return send(res,{ok:true});}
 if(url.pathname==='/draft-view.html'){let html=fs.readFileSync(path.resolve(__dirname,'../public/draft-view.html'),'utf8');html=html.replace('</body>',`<script>
 const sent=new Set();setInterval(async()=>{if(document.visibilityState!=='visible'||document.body.dataset.stale==='true')return;const ids=['preferred','safe','upside','reasons','recent','roster'];const visible=ids.every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.getClientRects().length&&s.visibility==='visible'&&Number(s.opacity)>0&&r.top>=0&&r.left>=0&&r.bottom<=innerHeight+2&&r.right<=innerWidth+2;});if(!visible)return;const recommendationId=document.body.dataset.recommendationId,pick=Number(document.body.dataset.currentPick),names=ids.slice(0,3).map(id=>document.getElementById(id).textContent);if(!pick||!recommendationId)return;await fetch('/proof/visible',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pick,recommendationId,names,visible})});},250);
 </script></body>`);res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});return res.end(html);}
 return original(req,res);
});
const timer=setInterval(()=>{if(phase!=='drafting')return;const own=mine(),t=own?turns.at(-1):null;if(own?Date.now()<deadline&&(!t.receipt||Date.now()<due):Date.now()<due)return;
 let p=t?.receipt&&Date.now()<deadline?players.find(p=>p.id===t.receipt.playerId):null;
 if(p&&board.some(x=>x.key===p.yahooPlayerKey))p=null;
 if(t)t.selection=p?'visible-recommendation':'autodraft';p ||= players.find(p=>!board.some(x=>x.key===p.yahooPlayerKey));
 board.push({pick:board.length+1,key:p.yahooPlayerKey,team:'999.l.123.t.'+pickOwner(board.length+1,8),acceptedAt:Date.now()});
 if(board.length===total){phase='completed';finishedAt=new Date().toISOString();}else next();
},50);
app.server.on('close',()=>clearInterval(timer));app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}/draft-view.html?leagueId=${league.id}&sessionId=${s.id}`,origin:`http://127.0.0.1:${app.server.address().port}`})));
