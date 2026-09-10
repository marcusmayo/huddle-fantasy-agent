'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildApp}=require('../src/server');
const {MemoryStateStore}=require('../src/storage/json-state-store');
const league=require('../config/leagues/yahoo-example.json');
test('clock evidence responds once and leaves the server available',async()=>{
  const app=buildApp({host:'127.0.0.1',port:0,league,defaultLeagueId:league.id,
    leagues:[{id:league.id,config:league}],playerPool:require('../config/fixtures/demo-players.json'),
    yahooDraftAutoSyncEnabled:false,fantasyProsSyncEnabled:false},
    {storeFactory:()=>new MemoryStateStore()});
  const session=app.draftService.createSession({draftSlot:1,sourceMode:'manual'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;
  try{
    for(let i=0;i<2;i++){
      const r=await fetch(origin+'/api/leagues/'+league.id+'/draft/sessions/'+session.id+'/clock-evidence');
      assert.equal(r.status,200);assert.equal(await r.json(),null);
      const health=await fetch(origin+'/health');assert.equal(health.status,200);await health.json();
    }
  }finally{await new Promise(resolve=>app.server.close(resolve));}
});
