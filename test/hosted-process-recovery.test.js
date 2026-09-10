'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {fork}=require('node:child_process');const {digest}=require('../src/domain/decision-audit');
test('the actual hosted runner survives a killed process, resumes the exact picked session and exports its evidence',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'huddle-hosted-')),children=[];
 t.after(()=>{for(const child of children)if(child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});});
 const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const league={...require('../config/leagues/yahoo-example.json'),id:'hosted-process',provenance:{yahooLeagueKey:'470.l.123',yahooTeamKey:'470.l.123.t.1'}};
 const pool={source:'synthetic',complete:true,players:Array.from({length:40},(_,i)=>({id:'p'+i,yahooPlayerKey:'470.p.'+(1000+i),name:'Player '+i,position:['QB','RB','WR','TE','K','DEF'][i%6],team:'SEA',projectedPoints:300-i,expertRank:i+1,adp:i+1}))};
 const config={schemaVersion:1,league,draftSlot:1,rulesHash:digest(league),port,stateFile:path.join(dir,'state.json'),playerPoolFile:path.join(dir,'pool.json'),fixtureFeed:path.join(dir,'feed.json')};
 fs.writeFileSync(config.playerPoolFile,JSON.stringify(pool));fs.writeFileSync(config.fixtureFeed,JSON.stringify({draft_result:[]}));const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(config));
 function start(mode,id){const child=fork(path.join(__dirname,'fixtures/hosted-draft-worker.cjs'),[file,mode,...(id?[id]:[])],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});children.push(child);return new Promise((resolve,reject)=>{let errors='';child.stderr.on('data',b=>errors+=b);const timer=setTimeout(()=>{child.kill();reject(Error('Hosted startup timeout '+errors));},10000);child.once('message',m=>{clearTimeout(timer);m.event==='ready'?resolve({child,...m}):reject(Error(JSON.stringify(m)));});child.once('error',e=>{clearTimeout(timer);reject(e);});});}
 const prepared=await start('create'),first=await start('resume',prepared.sessionId);
 for(const name of ['draft-view.html','display-time-calibration.js','display-receipt-routing.js']){
  const asset=await fetch(`http://127.0.0.1:${port}/${name}`);assert.equal(asset.status,200);assert.ok((await asset.text()).length>100);
 }
 fs.writeFileSync(config.fixtureFeed,JSON.stringify({draft_result:[{pick:1,player_key:'470.p.1000',team_key:'470.l.123.t.1'}]}));
 const url=`http://127.0.0.1:${port}/api/leagues/${league.id}/draft/sessions/${prepared.sessionId}`;
 let workspace;for(let i=0;i<40;i++){workspace=await(await fetch(url+'/workspace')).json();if(workspace.session.picks.length===1)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(workspace.session.picks.length,1);
 const exited=new Promise(r=>first.child.once('exit',r));first.child.kill('SIGKILL');await exited;
 const started=Date.now(),second=await start('resume',prepared.sessionId);assert.ok(Date.now()-started<5000);
 workspace=await(await fetch(url+'/workspace')).json();assert.equal(workspace.session.id,prepared.sessionId);assert.equal(workspace.session.picks.length,1);
 const response=await fetch(url+'/decision-audit?download=1');assert.match(response.headers.get('content-disposition'),/attachment/);const artifact=await response.json();assert.equal(artifact.report.totalPicks,1);assert.equal(artifact.report.manualSelectionVerified,false);
 await assert.rejects(start('resume',prepared.sessionId),/HOSTED_OWNER/);
 second.child.send('stop');await new Promise(r=>second.child.once('exit',r));
});
