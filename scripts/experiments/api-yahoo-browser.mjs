// Dedicated visible browser for the authorized Yahoo API-selector trial.
// No personal browser attachment, cookie import, API key access or draft entry.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/marcu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve('.media-build/api-yahoo-live');fs.mkdirSync(dir,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(dir,'browser-profile'),{channel:'msedge',headless:false,viewport:{width:1280,height:900}});
const page=context.pages()[0]||await context.newPage();await page.goto('https://football.fantasysports.yahoo.com/f1/mock_lobby',{waitUntil:'domcontentloaded',timeout:45000});await page.bringToFront();
const server=http.createServer(async(req,res)=>{if(req.method!=='GET'||req.url!=='/status'){res.writeHead(404);return res.end();}const pages=[];for(const p of context.pages())pages.push({url:p.url(),title:await p.title().catch(()=>''),signedIn:await p.locator('#ybarAccountMenu').count().catch(()=>0)});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({stage:'waiting-for-sign-in',pages}));});
server.listen(0,'127.0.0.1',()=>{const x={origin:'http://127.0.0.1:'+server.address().port,pid:process.pid,stage:'waiting-for-sign-in'};fs.writeFileSync(path.join(dir,'connection.json'),JSON.stringify(x));console.log(JSON.stringify(x));});
context.on('close',()=>server.close());
