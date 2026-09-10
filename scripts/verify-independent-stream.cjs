'use strict';
// API-shaped, loopback-only fixture: no extension, credentials or Yahoo traffic.
const {buildApp}=require('../src/server');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const {YahooReadOnlyClient}=require('../src/providers/yahoo');
const league={...require('../config/leagues/yahoo-example.json'),id:'integrated-api-fixture',name:'Built-in API rehearsal · synthetic',targetTeam:'Test team',teamCount:2,roster:{QB:1,RB:1,BN:14},
 provenance:{yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1',verificationStatus:'verified'}};
const players=Array.from({length:40},(_,i)=>({id:`p${i}`,yahooPlayerKey:`999.p.${1000+i}`,name:`Fixture Player ${i}`,position:['QB','RB','WR','TE'][i%4],team:'SEA',projectedPoints:300-i,floor:250-i,ceiling:350-i,expertRank:i+1,adp:i+1}));
let reads=0;const client=new YahooReadOnlyClient({accessToken:'fixture-only',fetchImpl:async()=>({ok:true,json:async()=>({draft_result:Array.from({length:Math.min(++reads,32)},(_,i)=>({pick:i+1,team_key:`999.l.123.t.${Math.floor(i/2)%2?2-i%2:1+i%2}`,player_key:`999.p.${1000+i}`}))})})});
const runtime={host:'127.0.0.1',port:0,instanceName:'LOCAL API FIXTURE · no Yahoo account',league,defaultLeagueId:league.id,
 leagues:[{id:league.id,config:league,yahooLeagueKey:'999.l.123',yahooTeamKey:'999.l.123.t.1',verificationStatus:'verified',stateFile:'unused-fixture.json'}],
 playerPool:{players,source:'synthetic',complete:true,season:2026},yahooOAuthEnabled:false,yahooDraftAutoSyncEnabled:true,yahooDraftPollIntervalMs:5000,fantasyProsSyncEnabled:false};
const app=buildApp(runtime,{storeFactory:()=>new MemoryStateStore(),yahooAccount:{status:()=>({connected:false}),readClient:()=>client},yahooOAuth:{enabled:false,tokenStore:{configured:false}}});
const session=app.draftService.createSession({draftSlot:1,sourceMode:'yahoo'});
app.yahooOperations.startDraftSync({leagueId:league.id,sessionId:session.id});
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${app.server.address().port}/draft-view.html?leagueId=${league.id}&sessionId=${session.id}`})));

// A real-time transport check, not Yahoo acceptance or a simulated draft clock.
const fs=require('node:fs');
const delivered=[];
app.server.on('listening',async()=>{
 const origin='http://127.0.0.1:'+app.server.address().port;
 const url=origin+'/api/leagues/'+league.id+'/draft/sessions/'+session.id+'/workspace-stream';
 const abort=new AbortController(),started=Date.now();
 const deadline=setTimeout(()=>abort.abort(),65000);
 try{
  const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('Stream HTTP '+response.status);
  let buffer='';
  for await(const chunk of response.body){buffer+=Buffer.from(chunk).toString();let at;
   while((at=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,at);buffer=buffer.slice(at+2);
    if(block.startsWith('event: workspace')){const w=JSON.parse(block.split('\ndata: ')[1]);delivered.push({elapsedMs:Date.now()-started,picks:w.session.picks.length,preferred:w.card.preferred?.player.id,source:w.apiFeed?.source,clockVerified:w.apiFeed?.selectionWindowVerified});}
   }
  }
 }catch(error){if(error.name!=='AbortError')console.error(error.message);}
 finally{
  clearTimeout(deadline);app.yahooOperations.stopDraftSync({leagueId:league.id,sessionId:session.id});
  const result={scope:'65-second real-time local API transport test; no Yahoo data or human-clock proof',delivered,passed:delivered.some(x=>x.elapsedMs>=60000&&x.picks>=12)};
  fs.writeFileSync('.media-build/independent-stream-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,events:delivered.length,last:delivered.at(-1)}));
  app.server.closeAllConnections();app.server.close();process.exitCode=result.passed?0:1;
 }
});
