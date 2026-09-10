// Real Huddle and model-driven browser inputs; four-pick synthetic provider.
// Actual clock reader uses a synthetic canvas stream; this is not Yahoo capture.
import {connectSyntheticClock} from './synthetic-clock-stream.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {runPersistentModelLoop} from './persistent-model-loop.mjs';
import {createPaidSession} from './api-paid-session.mjs';
import {readHuddleDraftDocument} from '../huddle-draft-display-cua.mjs';
import {exactPlayerRow} from './exact-player-row.mjs';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/marcu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const runId=randomUUID(),dir=path.resolve('.media-build/api-huddle-'+runId);fs.mkdirSync(dir,{recursive:true});
const tools=[{type:'function',name:'exec_browser',description:'code is a JSON array, 1-3 commands: {"action":"observe"}, {"action":"start"}, {"action":"clear_search"}, {"action":"wait","ms":500}, {"action":"draft","player":"exact Huddle preferred player name"}. These execute real browser UI controls. Wait <=1500 ms. Observe both room and Huddle. Never draft on an opponent turn or when the displayed Huddle pick differs from the room pick. No API/hidden-state commands.',parameters:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},strict:true}];
const paid=createPaidSession({runId,dir,tools}),observations=[],huddleSamples=[],inputs=[],events=[];
let child,browser,room,huddle,launch,lastObservation,auditTimer,auditBusy=false,result,error,truth,appReport;
const progress=()=>fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({runId,at:Date.now(),observations:observations.length,inputs:inputs.length,requests:paid.status().requests.length}));
const huddleRead=()=>huddle.evaluate(readHuddleDraftDocument);
async function readRoom(){return room.evaluate(()=>({text:document.body.innerText.slice(0,5000),header:document.getElementById('turn').textContent,seconds:Number(document.getElementById('clock').textContent.split(':').reduce((a,v)=>a*60+Number(v),0)),autodraft:!!document.querySelector('#auto [data-icon="checkmark-default"]'),search:document.querySelector('input').value}));}
async function observe(){
  const r=await readRoom(),v=await huddleRead();
  const snapshot={at:Date.now(),room:{...r,pick:Number(r.header.match(/PICK (\d+)/)?.[1]||0),onClock:r.header.startsWith('YOUR TURN'),completed:r.header==='Draft Complete'},huddle:v};
  snapshot.gapMs=lastObservation?snapshot.at-lastObservation.at:0;observations.push(snapshot);
  const previous=lastObservation;lastObservation=snapshot;progress();
  if(previous?.room.pick&&!previous.room.completed&&snapshot.gapMs>5000)throw Error('Selector observation gap exceeded five seconds: '+snapshot.gapMs);
  if(r.autodraft)throw Error('Autodraft observed; test failed');return snapshot;
}
try{
  child=spawn(process.execPath,['scripts/experiments/huddle-selector-fixture.cjs','30','0'],{cwd:process.cwd(),env:{...process.env,HUDDLE_TEST_CLOCK:'true'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  launch=await new Promise((resolve,reject)=>{let text='',done=false;const timer=setTimeout(()=>{if(!done)reject(Error('Fixture startup timed out'));},15000);child.stderr.on('data',b=>fs.appendFileSync(path.join(dir,'fixture-stderr.log'),b));child.once('error',reject);child.once('exit',code=>{if(!done){clearTimeout(timer);reject(Error('Fixture exited '+code));}});child.stdout.on('data',b=>{text+=b;for(const line of text.split(/\r?\n/)){try{const x=JSON.parse(line);if(x.origin&&!done){done=true;clearTimeout(timer);resolve(x);}}catch{}}});});
  fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify(launch,null,2));
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000}});
  await context.tracing.start({screenshots:true,snapshots:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===launch.origin?route.continue():route.abort());
  room=await context.newPage();await room.addInitScript(()=>{window.huddleInputTrace=[];for(const type of ['pointerdown','pointerup','click','keydown'])document.addEventListener(type,e=>window.huddleInputTrace.push({type,at:Date.now(),playerId:e.target?.closest('button')?.dataset.id??null}),true);});await room.goto(launch.room);huddle=await context.newPage();await huddle.goto(launch.huddle+'&presentation=compact&clockControl=opener');
  await huddle.waitForFunction(()=>document.body.dataset.sessionId&&document.getElementById('preferred').dataset.playerId,{},{timeout:10000});
  await connectSyntheticClock(huddle);
  const initial=await observe();if(!initial.huddle.allPanelsInFrame)throw Error('Huddle initial panels do not fit');
  await huddle.screenshot({path:path.join(dir,'huddle-before.png')});await room.screenshot({path:path.join(dir,'room-before.png')});
  // Independent audit reads only. These samples are NOT model-selector observations.
  auditTimer=setInterval(async()=>{if(auditBusy)return;auditBusy=true;try{const view=await huddleRead();huddleSamples.push({at:Date.now(),view});}catch(e){huddleSamples.push({at:Date.now(),error:e.message});}finally{auditBusy=false;}},100);
  result=await runPersistentModelLoop({prompt:'You are the API computer-use selector in a controlled Huddle integration test, not Yahoo. The actual Huddle app independently recommends players from a synthetic provider. Clear stale search using the browser command, start the draft, and promptly select Huddle preferred on your two owned turns (picks 2 and 3, clocks 30 and 70). Observe after each input and wait for Huddle reconciliation. Use only visible UI observations. If Huddle overallPick differs from the room pick, wait and observe; never choose an old recommendation. Do not choose on opponent turns. Finish only when both room and Huddle report complete and Huddle has two accepted picks. Commands are restricted JSON, not JavaScript. Initial observation: '+JSON.stringify(initial),respond:paid.respond,maxResponses:16,operationBudgetMs:55000,completeAfterTool:true,
    execute:async({code,callId,signal})=>{
      const commands=JSON.parse(code);if(!Array.isArray(commands)||!commands.length||commands.length>3)throw Error('Invalid command program');
      for(const command of commands){if(signal.aborted)throw Error('Execution stopped');
        if(command.action==='observe')await observe();
        else if(command.action==='wait'){if(!Number.isInteger(command.ms)||command.ms<0||command.ms>1500)throw Error('Invalid wait');await room.waitForTimeout(command.ms);await observe();}
        else if(command.action==='clear_search'){await room.locator('#clear').click({timeout:2000});await observe();}
        else if(command.action==='start'){await observe();await room.getByRole('button',{name:'Start controlled draft',exact:true}).click({timeout:2000});inputs.push({callId,action:'start',at:Date.now()});await observe();}
        else if(command.action==='draft'){
          await room.bringToFront();
          const s=await observe(),v=s.huddle;
          if(!s.room.onClock||s.room.pick!==v.overallPick||v.stale||!v.allPanelsInFrame||v.sessionId!==launch.sessionId)throw Error('Current matching visible Huddle recommendation required');
          if(command.player!==v.preferred)throw Error('Requested player differs from Huddle preferred');
          if(s.room.seconds<11)throw Error('Ten-second guarded selection reserve unavailable');
          if(inputs.some(e=>e.pick===s.room.pick))throw Error('Input already issued for this pick');
          const target=exactPlayerRow(room,command.player);
          if(await target.count()!==1)throw Error('Exact player row not unique');
          const event={callId,action:'draft',pick:s.room.pick,player:command.player,revision:v.recommendationId,remainingSeconds:s.room.seconds,at:Date.now(),acknowledged:false};inputs.push(event);
          await target.getByRole('button',{name:'Draft',exact:true}).click({timeout:2000});event.acknowledged=true;event.finishedAt=Date.now();await observe();
        }else throw Error('Unsupported command');
      }return JSON.stringify(await observe());
    },verifyComplete:async()=>{const s=await observe();return s.room.completed&&s.huddle.completed&&s.huddle.accepted.length===2&&inputs.filter(e=>e.action==='draft'&&e.acknowledged).length===2;},onEvent:e=>{events.push(e);progress();}
  });
}catch(e){error=e.message;}
finally{
  clearInterval(auditTimer);
  if(launch){try{truth=await(await fetch(launch.origin+'/validation/report')).json();const clockEvidence=await(await fetch(launch.origin+'/api/leagues/'+launch.leagueId+'/draft/sessions/'+launch.sessionId+'/clock-evidence')).json();fs.writeFileSync(path.join(dir,'clock-evidence.json'),JSON.stringify(clockEvidence,null,2));appReport=await(await fetch(launch.origin+'/api/leagues/'+launch.leagueId+'/draft/sessions/'+launch.sessionId+'/decision-audit?download=1')).json();fs.writeFileSync(path.join(dir,'huddle-report.json'),JSON.stringify(appReport,null,2));}catch(e){events.push({type:'evidence-error',message:e.message});}}
  for(const [name,page]of [['huddle',huddle],['room',room]])if(page&&!page.isClosed())await page.screenshot({path:path.join(dir,name+'-after.png')}).catch(()=>{});
  if(room&&!room.isClosed())await room.evaluate(()=>window.huddleInputTrace).then(data=>fs.writeFileSync(path.join(dir,'browser-input-events.json'),JSON.stringify(data,null,2))).catch(()=>{});
  if(browser)await browser.contexts()[0].tracing.stop({path:path.join(dir,'browser-trace.zip')}).catch(()=>{});
  await browser?.close();child?.kill();
  const turns=(truth?.turns||[]).map(t=>{const first=huddleSamples.find(s=>s.at>=t.start&&s.view?.overallPick===t.pick&&!s.view.stale&&s.view.allPanelsInFrame);return {...t,firstMatchingSampleAt:first?.at??null,turnToVisibleSampleMs:first?first.at-t.start:null,selectionMs:t.acceptedAt?t.acceptedAt-t.start:null};});
  const summary={runId,scope:'Real API model and real Huddle UI; synthetic draft provider; actual clock reader with synthetic stream; not Yahoo',...paid.status(),result:result||null,error:error||null,truth,turns,inputs,observations,huddleSamples,events,sessionBuildIdentity:appReport?.report?.buildIdentity??null,exporterBuildIdentity:appReport?.report?.exporterBuildIdentity??null};
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({dir,completed:!!result?.completed,error:error||null,turns,requests:summary.requests.length,runUsageEstimatedUsd:summary.runUsageEstimatedUsd,accountedUsd:summary.accountedUsd}));if(error)process.exitCode=1;
}
