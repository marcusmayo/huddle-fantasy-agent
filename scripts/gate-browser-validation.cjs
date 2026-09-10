'use strict';
// Local synthetic UI fixture. No Yahoo credentials, requests or selections.
const fs=require('node:fs');
const {buildApp}=require('../src/server');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {pickOwner}=require('../src/domain/league');
const league={...require('../config/leagues/yahoo-example.json'),id:'gate-browser-fixture',name:'Synthetic Yahoo layout validation',targetTeam:'Blitzkrieg',teamCount:8,roster:{QB:1,RB:2,WR:2,TE:1,'W/R/T':1,K:1,DEF:1,BN:6},provenance:{yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1'}};
const players=Array.from({length:180},(_,i)=>({id:'p'+i,name:'Fixture Player '+i,position:['QB','RB','WR','TE','K','DEF'][i%6],team:'SEA',yahooPlayerKey:'999.p.'+(1000+i),projectedPoints:300-i,adp:i+1,expertRank:i+1}));
const app=buildApp({host:'127.0.0.1',port:0,league,playerPool:{players,complete:true,source:'synthetic'},draftSimulation:false,visualClockEnabled:false,instanceName:'SYNTHETIC VALIDATION',fantasyProsSyncEnabled:false,yahooOAuthEnabled:false,yahooDraftAutoSyncEnabled:false},
 {storeFactory:()=>new MemoryStateStore(),yahooAccount:{status:()=>({connected:false})},yahooOAuth:{enabled:false,tokenStore:{configured:false}},yahooOperations:{draftStatus:()=>({recurring:true,state:'running',lastSuccessAt:new Date().toISOString()})}});
const service=app.draftService,session=service.createSession({draftSlot:1,sourceMode:'yahoo'});
const view=`/draft-view.html?leagueId=${league.id}&sessionId=${session.id}`;
let denial=0;
const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/validation/control'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const command=JSON.parse(body);
  if(Number.isInteger(command.denial))denial=command.denial;
  const count=Math.min(120,Number(command.picks)||0);
  for(let i=service.getSession(session.id).picks.length;i<count;i++)service.recordPick(session.id,{playerId:players[i].id,eventId:'fixture:'+i,overallPick:i+1,yahooPlayerKey:players[i].yahooPlayerKey,isMine:pickOwner(i+1,8)===1,source:'synthetic'});
  res.end(JSON.stringify({picks:service.getSession(session.id).picks.length,denial}));return;
 }
 if(url.pathname==='/validation/layout'){
  const width=Math.min(1920,Math.max(320,Number(url.searchParams.get('width'))||640));
  const height=Math.min(1400,Math.max(400,Number(url.searchParams.get('height'))||900));
  res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Huddle synthetic viewport test</title><style>body{margin:0;background:#333}iframe{display:block;width:${width}px;height:${height}px;border:0}</style><iframe title="Huddle ${width} by ${height}" src="${view}"></iframe>`);return;
 }
 if(denial&&/\/workspace(?:-stream)?$/.test(url.pathname)){
  if(url.pathname.endsWith('/workspace'))denial--;res.writeHead(403,{'content-type':'text/html'});res.end('<p>Synthetic transient access response</p>');return;
 }
 original(req,res);
});
app.server.listen(0,'127.0.0.1',()=>{
 const origin=`http://127.0.0.1:${app.server.address().port}`;
 const info={origin,view:origin+view,layout:origin+'/validation/layout',scope:'Synthetic browser validation only'};
 fs.writeFileSync('.media-build/approved-browser-fixture.json',JSON.stringify(info));console.log(JSON.stringify(info));
});
