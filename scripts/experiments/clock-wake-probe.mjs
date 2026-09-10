// Local browser-only comparison; no model requests or API credential access.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {readHuddleDraftDocument} from '../huddle-draft-display-cua.mjs';import {exactPlayerRow} from './exact-player-row.mjs';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/marcu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve('.media-build/clock-wake-'+Date.now());fs.mkdirSync(dir,{recursive:true});const rows=[];
for(const mode of ['clock-wake']){
  let child,browser,timer,busy=false,launch,page,view;const record={mode,events:[]};
  try{
    child=spawn(process.execPath,['scripts/experiments/huddle-selector-fixture.cjs'],{env:{...process.env,HUDDLE_TEST_CLOCK:'true'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    launch=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('fixture timeout')),15000);child.stderr.on('data',x=>fs.appendFileSync(path.join(dir,mode+'-stderr.txt'),x));child.once('exit',code=>{clearTimeout(timeout);reject(Error('fixture exit '+code));});child.stdout.on('data',x=>{text+=x;for(const line of text.split(/\r?\n/))try{const v=JSON.parse(line);if(v.origin){clearTimeout(timeout);resolve(v);}}catch{}});});
    browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000}});
    await context.tracing.start({screenshots:true,snapshots:true});
    await context.route('**/*',route=>new URL(route.request().url()).origin===launch.origin?route.continue():route.abort());
    page=await context.newPage();await page.addInitScript(()=>{window.inputEvents=[];for(const type of ['pointerdown','pointerup','click','keydown'])document.addEventListener(type,e=>window.inputEvents.push({type,at:Date.now(),text:e.target?.textContent?.slice(0,80)}),true);});
    await page.goto(launch.room);view=await context.newPage();await view.goto(launch.huddle+'&presentation=compact&clockControl=opener');
    await view.waitForFunction(()=>document.body.dataset.sessionId&&document.getElementById('preferred').dataset.playerId,{},{timeout:10000});
    await view.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1100;canvas.height=900;
      const ctx=canvas.getContext('2d');let busy=false;
      const paint=async()=>{if(busy)return;busy=true;try{const s=await(await fetch('/validation/state')).json();ctx.fillStyle='#171a23';ctx.fillRect(0,0,1100,900);ctx.fillStyle='white';ctx.font='26px Arial';ctx.fillText('Controlled browser validation - H2H',24,40);ctx.fillText(String(Math.floor(s.seconds/60)).padStart(2,'0')+':'+String(s.seconds%60).padStart(2,'0'),24,90);ctx.font='22px Arial';ctx.fillText(s.phase==='waiting'?'Waiting to start':(s.mine?'YOUR TURN':"Opponent's Pick - You're up in 1 Pick")+' - ROUND '+Math.ceil(s.pick/2)+', PICK '+s.pick,24,145);}finally{busy=false;}};
      await paint();window.syntheticPaint=setInterval(paint,100);window.syntheticCanvas=canvas;
      await window.HuddlePresentationReceiver.connect(canvas.captureStream(10));
    });
    await page.waitForTimeout(7000);
    timer=setInterval(async()=>{if(busy)return;busy=true;try{const sample=await view.evaluate(readHuddleDraftDocument);record.events.push({at:Date.now(),view:sample});}catch{}finally{busy=false;}},100);
    await page.locator('#clear').click({timeout:2000});await page.getByRole('button',{name:'Start controlled draft',exact:true}).click({timeout:2000});
    await view.waitForFunction(()=>document.body.dataset.currentPick==='2'&&document.body.dataset.stale==='false',{},{timeout:10000});
    const v=await view.evaluate(readHuddleDraftDocument);record.player=v.preferred;
    const button=exactPlayerRow(page,v.preferred).getByRole('button',{name:'Draft',exact:true});
    record.visibilityBefore={room:await page.evaluate(()=>({state:document.visibilityState,focus:document.hasFocus()})),huddle:await view.evaluate(()=>({state:document.visibilityState,focus:document.hasFocus()}))};
    if(mode.startsWith('foreground'))await page.bringToFront();
    await page.waitForTimeout(5000);
    record.startedAt=Date.now();try{if(mode.startsWith('keyboard')){await button.focus({timeout:2000});await button.press('Enter',{timeout:Math.max(1,2000-(Date.now()-record.startedAt))});}else await button.click({timeout:2000});record.acknowledged=true;}catch(e){record.error=e.message;}
    record.finishedAt=Date.now();record.operationMs=record.finishedAt-record.startedAt;
    await page.waitForTimeout(300);record.inputEvents=await page.evaluate(()=>window.inputEvents);record.source=await(await fetch(launch.origin+'/validation/report')).json();record.clockEvidence=await(await fetch(launch.origin+'/api/leagues/'+launch.leagueId+'/draft/sessions/'+launch.sessionId+'/clock-evidence')).json();record.audit=await(await fetch(launch.origin+'/api/leagues/'+launch.leagueId+'/draft/sessions/'+launch.sessionId+'/decision-audit?download=1')).json();
  }catch(e){record.error=e.message;}finally{clearInterval(timer);if(browser)await browser.contexts()[0].tracing.stop({path:path.join(dir,mode+'-trace.zip')}).catch(()=>{});await browser?.close();child?.kill();rows.push(record);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({scope:'Local real-browser reproduction, no API or Yahoo',rows},null,2));console.log(JSON.stringify({dir,mode,operationMs:record.operationMs,acknowledged:record.acknowledged,error:record.error,selection:record.source?.turns?.[0]}));}
}
