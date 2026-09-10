'use strict';
// Prepare once with `create`; launch/supervise `resume` with the returned session ID.
const fs=require('node:fs'),path=require('node:path');
const {buildApp}=require('../src/server');
const {loadRuntimeConfig}=require('../src/config');
const {JsonStateStore}=require('../src/storage/json-state-store');
const {digest}=require('../src/domain/decision-audit');
const {openHostedSession}=require('../src/services/hosted-draft-session');
async function runHosted({config,mode,sessionId,runtime=loadRuntimeConfig(),dependencies={}}){
  if(config.schemaVersion!==1||!path.isAbsolute(config.stateFile)||!path.isAbsolute(config.playerPoolFile))throw Error('Versioned configuration with absolute state and player-pool paths required');
  const league=config.league,entry={id:league.id,config:league,stateFile:config.stateFile,...league.provenance};
  const runtimeConfig={...runtime,league,leagues:[entry],defaultLeagueId:league.id,playerPool:JSON.parse(fs.readFileSync(config.playerPoolFile)),
    yahooDraftAutoSyncEnabled:true,weeklyAutoRefreshEnabled:false,fantasyProsSyncEnabled:false,
    host:config.host||'127.0.0.1',port:config.port||8790};
  // A host-network OS lease releases on process death, including SIGKILL. All
  // workers sharing this state must share the host network and canonical path.
  // Hash collisions conservatively refuse startup instead of sharing ownership.
  const lease=require('node:net').createServer(socket=>socket.destroy());
  const canonical=path.resolve(config.stateFile).replace(/\\/g,'/');
  const leasePort=20000+(parseInt(digest(canonical).slice(0,8),16)%40000);
  try{await new Promise((resolve,reject)=>{lease.once('error',reject);lease.listen({host:'127.0.0.1',port:leasePort,exclusive:true},resolve);});}
  catch(e){throw Object.assign(Error('Hosted draft state lease is occupied'),{code:'HOSTED_OWNER',cause:e});}
  let app;const release=()=>new Promise(resolve=>lease.close(resolve));
  try{
    app=buildApp(runtimeConfig,{...dependencies,storeFactory:()=>new JsonStateStore(config.stateFile)});
    app.server.prependListener('request',(request,response)=>{
      const route=new URL(request.url,'http://localhost').pathname;
      if(!/\/(workspace|workspace-stream|decision-audit)$/.test(route))return;
      const requestId=require('node:crypto').randomUUID(),started=performance.now();
      response.setHeader('x-request-id',requestId);
      // Metadata only: never log query parameters, cookies, tokens or bodies.
      console.log(JSON.stringify({event:'draft-request-arrived',requestId,route:route.split('/').at(-1),at:new Date().toISOString()}));
      response.once('finish',()=>console.log(JSON.stringify({event:'draft-response-finished',requestId,status:response.statusCode,elapsedMs:Math.round(performance.now()-started)})));
    });
    const session=openHostedSession({service:app.draftService,mode,sessionId,draftSlot:config.draftSlot,
      leagueKey:league.provenance.yahooLeagueKey,teamKey:league.provenance.yahooTeamKey,rulesHash:config.rulesHash});
    if(mode==='create'){await release();return {sessionId:session.id,rulesHash:digest(league)};}
    const {saveDraftReport}=require('../src/services/draft-report');
    let reportTimer;
    const saveCompleted=()=>{if(app.draftService.getSession(session.id).status==='completed')saveDraftReport(app.draftService,session.id);};
    const unsubscribe=app.draftService.subscribe(()=>{
      if(app.draftService.getSession(session.id).status!=='completed')return;
      clearTimeout(reportTimer);reportTimer=setTimeout(()=>{try{saveCompleted();}catch(e){console.error(JSON.stringify({event:'report-save-failed',code:e.code||'REPORT_STORAGE_ERROR'}));}},6000);reportTimer.unref?.();
    });
    saveCompleted();
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(runtimeConfig.port,runtimeConfig.host,resolve);});
    if(session.status!=='completed')app.yahooOperations.startDraftSync({leagueId:league.id,sessionId:session.id});
    const close=async()=>{unsubscribe();clearTimeout(reportTimer);app.yahooOperations.stopDraftSync({leagueId:league.id,sessionId:session.id});try{saveCompleted();}finally{await new Promise(r=>app.server.close(r));await release();}};
    return {app,sessionId:session.id,close};
  }catch(e){app?.server.close();await release();throw e;}
}
if(require.main===module){
  const [mode,file,sessionId]=process.argv.slice(2);
  runHosted({mode,sessionId,config:JSON.parse(fs.readFileSync(file))}).then(result=>{
    console.log(JSON.stringify({event:mode==='create'?'prepared':'ready',sessionId:result.sessionId,pid:process.pid,at:new Date().toISOString()}));
    if(result.close)for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>result.close().then(()=>process.exit(0)));
  }).catch(e=>{console.error(JSON.stringify({event:'startup-failed',code:e.code||'STARTUP_ERROR',message:e.message}));process.exitCode=1;});
}
module.exports={runHosted};
