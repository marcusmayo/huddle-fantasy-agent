'use strict';
// Isolated API + visible-clock fixture. No Yahoo account, network or picks.
const fs=require('node:fs'),path=require('node:path');
const {buildApp}=require('../src/server');
const {JsonStateStore}=require('../src/storage/json-state-store');
const {YahooReadOnlyClient}=require('../src/providers/yahoo');
const {pickOwner}=require('../src/domain/league');
const league={...require('../config/leagues/yahoo-example.json'),id:'visual-clock-fixture',name:'Clock reader validation',targetTeam:'Blitzkrieg',teamCount:2,roster:{QB:1,RB:1,BN:1},provenance:{yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1',verificationStatus:'verified'}};
const players=Array.from({length:40},(_,i)=>({id:`p${i}`,yahooPlayerKey:`999.p.${1000+i}`,name:`Fixture Player ${i}`,position:['QB','RB','WR','TE'][i%4],projectedPoints:300-i,floor:250-i,ceiling:350-i,expertRank:i+1,adp:i+1}));
const durations=process.env.HUDDLE_FIXTURE_FAST ? [3,3,3,3,3,3] : [30,45,30,70,30,30];let started=null;
function state(){let elapsed=started===null?0:Date.now()-started,index=0;while(index<6&&elapsed>=durations[index]*1000){elapsed-=durations[index++]*1000;}return {started:started!==null,index,seconds:index<6?Math.ceil(durations[index]-elapsed/1000):0,owner:index<6?pickOwner(index+1,2):null};}
const client=new YahooReadOnlyClient({accessToken:'fixture-only',fetchImpl:async()=>({ok:true,json:async()=>({draft_result:Array.from({length:state().index},(_,i)=>({pick:i+1,team_key:`999.l.123.t.${pickOwner(i+1,2)}`,player_key:`999.p.${1000+i}`}))})})});
const output=path.resolve(process.env.HUDDLE_FIXTURE_STATE||'.media-build/clock-validation/controlled-v2-state.json');
const store=new JsonStateStore(output);
const runtime={host:'127.0.0.1',port:0,draftSimulation:process.env.HUDDLE_FIXTURE_CLOCK!=='false',visualClockEnabled:process.env.HUDDLE_FIXTURE_CLOCK!=='false',instanceName:'SIMULATED CLOCK INTEGRATION',league,defaultLeagueId:league.id,leagues:[{id:league.id,config:league,yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1',verificationStatus:'verified',stateFile:'unused-fixture.json'}],playerPool:{players,source:'synthetic',complete:true,season:2026},yahooOAuthEnabled:false,yahooDraftAutoSyncEnabled:true,yahooDraftPollIntervalMs:5000,fantasyProsSyncEnabled:false};
const app=buildApp(runtime,{storeFactory:()=>store,yahooAccount:{status:()=>({connected:false}),readClient:()=>client},yahooOAuth:{enabled:false,tokenStore:{configured:false}}});
const previous=Object.values(app.draftService.state.sessions).find(s=>s.status==='active');
if(previous?.picks.length)throw Error('A fixture already has picks; preserve its evidence before creating another run');
const session=previous||app.draftService.createSession({draftSlot:1,sourceMode:'yahoo'});
const handlers=app.server.listeners('request');app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
 if(req.url==='/fixture-state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(state()));return;}
 if(req.url==='/fixture-start'&&req.method==='POST'){if(started===null){started=Date.now();app.draftService.state.sessions[session.id].fixtureTiming={startedAt:started,durations,simulation:true};app.draftService.persist();}res.end('{}');return;}
 if(req.url==='/fixture-source'){
 res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><title>Huddle integrated clock source · simulated</title><style>body{margin:0;background:#171a23;color:#f3f5fa;font:18px Arial}.header{height:100px;display:flex;align-items:center;justify-content:space-around}.clock{text-align:center;font-size:26px;font-weight:bold}.turn{font-size:18px}aside{margin:60px;color:#e4d784}button{font:inherit;padding:12px}</style><div class="header"><div>YAHOO FANTASY FOOTBALL DRAFT<br><small>Clock reader validation - H2H</small></div><div class="clock"><div id="clock"></div><div id="turn" class="turn"></div></div></div><aside><h1>Simulated integration — no Yahoo draft</h1><p>Six automatic fixture picks. Includes a 70-second owned turn.</p><button id="start">Start fixture</button></aside><script>document.querySelector('#start').onclick=()=>fetch('/fixture-start',{method:'POST'});async function update(){try{const s=await(await fetch('/fixture-state')).json();document.querySelector('#clock').textContent=String(Math.floor(s.seconds/60)).padStart(2,'0')+':'+String(s.seconds%60).padStart(2,'0');document.querySelector('#turn').textContent=!s.started?'Waiting to start':s.index===6?'Draft complete':(s.owner===1?'YOUR TURN':"Opponent’s Pick • You're up in 1 Pick")+' • ROUND '+Math.ceil((s.index+1)/2)+', PICK '+(s.index+1);document.querySelector('#start').disabled=s.started;}finally{setTimeout(update,100);}}update();</script>`);return;
 }
 for(const handler of handlers)handler(req,res);
});
app.yahooOperations.startDraftSync({leagueId:league.id,sessionId:session.id});
app.server.listen(Number(process.env.HUDDLE_FIXTURE_PORT)||0,'127.0.0.1',()=>console.log(JSON.stringify({source:`http://127.0.0.1:${app.server.address().port}/fixture-source`,view:`http://127.0.0.1:${app.server.address().port}/draft-view.html?leagueId=${league.id}&sessionId=${session.id}`})));
