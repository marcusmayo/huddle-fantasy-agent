'use strict';
// Local controlled validation. Real app and browser adapter; synthetic provider.
const fs=require('node:fs'),path=require('node:path');
const {buildApp}=require('../src/server');const {JsonStateStore}=require('../src/storage/json-state-store');
const {YahooReadOnlyClient}=require('../src/providers/yahoo');const {pickOwner}=require('../src/domain/league');
const {scoringFingerprint}=require('../src/domain/league-projections');
const clock=Number(process.argv[2]||30),lag=Number(process.argv[3]||0),run=Date.now();
const league={...require('../config/leagues/yahoo-example.json'),id:'selector-validation',name:'Controlled browser validation',targetTeam:'Blitzkrieg',teamCount:8,roster:{QB:1,RB:2,WR:2,TE:1,'R/W/T':1,K:1,DEF:1,BN:6},provenance:{yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.8',verificationStatus:'verified'}};
const players=Array.from({length:300},(_,i)=>({id:'yahoo:999.p.'+(1000+i),yahooPlayerKey:'999.p.'+(1000+i),name:'Fixture Player '+i,position:['QB','RB','WR','TE','RB','WR','DEF','K'][i%8],team:'SEA',byeWeek:6,expertRank:i+1,adp:i+1,projectedPoints:400-i,floor:300-i*.5,ceiling:450-i,projectionLeagueId:league.id,projectionScoringFingerprint:scoringFingerprint(league),projectionScoringVerified:true,projectionSource:'synthetic'}));
const dir=path.resolve('.media-build/selector-validation-'+run);fs.mkdirSync(dir,{recursive:true});
let phase='waiting',deadline=0,due=0,autodraft=false,outageUntil=0;const picks=[],turns=[],browserEvents=[],streams=new Set();
const available=()=>players.filter(p=>!picks.some(x=>x.playerId===p.id));const mine=()=>pickOwner(picks.length+1,8)===8;
const client=new YahooReadOnlyClient({accessToken:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({draft_result:picks.filter(p=>Date.now()-p.at>=lag).map(p=>({pick:p.pick,player_key:p.key,team_key:p.teamKey}))})})});
const runtime={host:'127.0.0.1',port:0,draftSimulation:false,visualClockEnabled:false,instanceName:'CONTROLLED ONLY · no Yahoo connection',league,defaultLeagueId:league.id,leagues:[{id:league.id,config:league,yahooLeagueKey:league.provenance.yahooLeagueKey,yahooTeamKey:league.provenance.yahooTeamKey,verificationStatus:'verified',stateFile:'unused'}],playerPool:{players,source:'synthetic',complete:true,season:2026},yahooOAuthEnabled:false,yahooDraftAutoSyncEnabled:true,yahooDraftPollIntervalMs:5000,fantasyProsSyncEnabled:false};
const app=buildApp(runtime,{storeFactory:()=>new JsonStateStore(path.join(dir,'state.json')),yahooAccount:{status:()=>({connected:false}),readClient:()=>client},yahooOAuth:{enabled:false,tokenStore:{configured:false}}});
const service=app.draftService,session=service.createSession({draftSlot:8,sourceMode:'yahoo'});
function next(){deadline=Date.now()+clock*1000;due=Date.now()+750;if(mine())turns.push({pick:picks.length+1,start:Date.now(),deadline});}
function accept(player,manual){const pick=picks.length+1;if(mine())Object.assign(turns.at(-1),{selection:manual?'manual':'autodraft',playerId:player.id,acceptedAt:Date.now()});picks.push({pick,playerId:player.id,key:player.yahooPlayerKey,teamKey:'999.l.123.t.'+pickOwner(pick,8),at:Date.now()});if(picks.length===120)phase='completed';else next();}
function report(){const out={scope:'Controlled browser simulation; not Yahoo',clock,publicationLagMs:lag,phase,picks:picks.length,turns,browserEvents,reconciled:service.getSession(session.id).picks.length};fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(out,null,2));return out;}
const send=(res,x,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(x));};
const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/validation/transport-outage'&&req.method==='POST'){
  outageUntil=Date.now()+4000;for(const stream of streams)stream.end();
  browserEvents.push({at:Date.now(),action:'controlled-transport-outage',outageUntil});
  return send(res,{scope:'simulation only',outageUntil});
 }
 if(/\/workspace(?:-stream)?$/.test(url.pathname)){
  if(Date.now()<outageUntil)return send(res,{message:'Controlled service outage'},503);
  if(url.pathname.endsWith('/workspace-stream')){streams.add(res);res.once('close',()=>streams.delete(res));}
 }
 if(url.pathname==='/validation/source'){
  const source=['yahoo-live-cua-adapter.mjs','huddle-draft-display-cua.mjs','independent-human-selector.mjs'].map(f=>fs.readFileSync(path.resolve('scripts',f),'utf8')).join('\n');
  res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});return res.end(source);
 }
 if(url.pathname==='/validation/state')return send(res,{phase,autodraft,pick:picks.length+1,seconds:Math.max(0,Math.ceil((deadline-Date.now())/1000)),mine:mine(),available:available(),accepted:picks});
 if(url.pathname==='/validation/report')return send(res,report());
 if(url.pathname==='/validation/action'&&req.method==='POST'){
  let data='';for await(const c of req)data+=c;const b=JSON.parse(data);browserEvents.push({at:Date.now(),...b});
  if(b.action==='start'&&phase==='waiting'){phase='drafting';next();}
  if(b.action==='auto')autodraft=!autodraft;
  if(b.action==='draft'){const p=available().find(p=>p.yahooPlayerKey.split('.p.')[1]===b.id);if(phase!=='drafting'||!mine()||autodraft||Date.now()>=deadline||!p)return send(res,{error:'turn changed'},409);accept(p,true);}
  report();return send(res,{ok:true});
 }
 if(url.pathname==='/draftclient/f1/123/8'){
  res.writeHead(200,{'content-type':'text/html'});return res.end(fs.readFileSync(path.resolve('test/fixtures/selector-browser.html'),'utf8'));
 }
 return original(req,res);
});
const timer=setInterval(()=>{if(phase!=='drafting')return;if(mine()?(autodraft||Date.now()>=deadline):Date.now()>=due){if(mine())autodraft=true;accept(available()[0],false);report();}},100);
app.server.on('close',()=>clearInterval(timer));app.server.listen(0,'127.0.0.1',()=>{const origin='http://127.0.0.1:'+app.server.address().port;const out={origin,room:origin+'/draftclient/f1/123/8',huddle:origin+'/draft-view.html?leagueId='+league.id+'&sessionId='+session.id,sessionId:session.id,leagueId:league.id,output:dir};fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify(out));console.log(JSON.stringify(out));app.yahooOperations.startDraftSync({leagueId:league.id,sessionId:session.id});});
