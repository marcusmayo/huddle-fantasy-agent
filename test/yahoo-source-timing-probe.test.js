'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('source probe preserves complete boards and stops before mock expiry',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'huddle-source-probe-'));
  try {
    for(const d of ['src/providers','src/services'])fs.mkdirSync(path.join(root,d),{recursive:true});
    fs.writeFileSync(path.join(root,'src/config.js'),'exports.loadRuntimeConfig=()=>({leagues:[{yahooLeagueKey:"470.l.123"}]});');
    fs.writeFileSync(path.join(root,'src/providers/yahoo-oauth.js'),'exports.createYahooOAuthRuntime=()=>({});');
    fs.writeFileSync(path.join(root,'src/services/yahoo-account-service.js'),`
      exports.YahooAccountService=class {
        status(){return {connected:true};}
        readClient(){return {
          async draftResults(key){
            await this.fetch('data:application/json,{}');
            return {payload:{draft_status:'postdraft'},picks:Array.from({length:120},(_,i)=>({overallPick:i+1,yahooPlayerKey:'470.p.'+(i+1),teamKey:key+'.t.1'}))};
          }
        };}
      };
    `);
    const run=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/yahoo-source-timing-probe.cjs'),'456','120'],{cwd:root,encoding:'utf8',timeout:5000});
    assert.equal(run.status,0,run.stderr||run.error?.message);
    const saved=JSON.parse(fs.readFileSync(path.join(root,'.media-build/source-timing-456/api-evidence.json')));
    assert.deepEqual(saved.records.map(r=>r.phase),['control-before','mock-before','mock-before','control-after']);
    assert.equal(saved.records[1].picks.length,120);
    assert.match(run.stdout,/"completedSources":\["470.l.456","nfl.l.456"\]/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
