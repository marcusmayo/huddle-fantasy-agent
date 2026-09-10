'use strict';
// A real-time persistence/continuity test, explicitly not Yahoo evidence.
const fs=require('node:fs'),path=require('node:path');
const {DraftTimingEvidence}=require('../src/services/draft-timing-evidence');
const dir=path.resolve(__dirname,'../.media-build/clock-validation');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'continuous-state.json');let state={simulation:true};
const log=new DraftTimingEvidence({session:()=>state,persist:()=>fs.writeFileSync(file,JSON.stringify(state)),intervalMs:5000});
const started=performance.now();log.start();let index=0;
async function tick(){
  log.readStarted();const now=new Date().toISOString();log.result({pickCount:index,requestStartedAt:now,receivedAt:now});
  if(++index===100){log.record('completed',{pickCount:100});console.log(JSON.stringify({simulation:true,elapsedMs:performance.now()-started,events:state.timingEvidence.events.length,incomplete:state.timingEvidence.incomplete,health:log.health()}));return;}
  setTimeout(tick,Math.max(0,started+index*5000-performance.now()));
}
tick();
