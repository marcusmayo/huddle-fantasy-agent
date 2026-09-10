'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const folder=path.resolve(__dirname,'../extensions/huddle-read-only');
function extension(){
 const local={},session={},calls=[];let listener;
 const area=data=>({get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values),remove:async key=>delete data[key]});
 const chrome={storage:{local:area(local),session:area(session)},runtime:{getURL:p=>'chrome-extension://'+('a'.repeat(32))+'/'+p,onMessage:{addListener:fn=>listener=fn}}};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'background.js'),'utf8'),{chrome,URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})};}});
 const popup={url:chrome.runtime.getURL('popup.html')},source={url:'https://football.fantasysports.yahoo.com/draftclient/f1/123/2',frameId:0,tab:{id:7}};
 const config={endpoint:'http://127.0.0.1:8787/api/leagues/a/draft/sessions/b/human-feed',token:'a'.repeat(64),roomPath:'/draftclient/f1/123/2',leagueKey:'nfl.l.123',teamKey:'nfl.l.123.t.2',draftSlot:1,totalPicks:120,teamCount:6};
 return {calls,popup,source,config,send:(message,sender)=>new Promise(resolve=>listener(message,sender,resolve))};
}
test('extension restricts source tab, sender, destination and read-only message type',async()=>{
 const e=extension();assert.equal((await e.send({type:'configure',config:e.config},e.popup)).ok,true);
 const c=await e.send({type:'config'},e.source);assert.equal(c.config.token,undefined);
 assert.match((await e.send({type:'observation',snapshot:{}},{...e.source,tab:{id:8}})).error,/Another Yahoo/);
 assert.match((await e.send({type:'observation',snapshot:{}},{...e.source,url:'https://example.com/'})).error,/source/);
 assert.match((await e.send({type:'Draft'},e.source)).error,/Unsupported/);
 assert.equal((await e.send({type:'observation',snapshot:{observation:{}}},e.source)).ok,true);
 assert.equal(e.calls.length,1);assert.equal(e.calls[0].url,e.config.endpoint);assert.equal(e.calls[0].options.redirect,'error');
 assert.match((await e.send({type:'configure',config:{...e.config,endpoint:'https://example.com/feed'}},e.popup)).error,/Import/);
 assert.match((await e.send({type:'configure',config:e.config},e.source)).error,/popup/);
});
test('packaged reader matches maintained source and extension requests no input or debugger permissions',()=>{
 assert.equal(fs.readFileSync(path.join(folder,'human-room-reader.js'),'utf8'),fs.readFileSync(path.resolve(__dirname,'../public/human-room-reader.js'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));assert.deepEqual(manifest.permissions,['storage']);
 assert.deepEqual(manifest.content_scripts[0].matches,['https://football.fantasysports.yahoo.com/draftclient/f1/*']);
});
test('passive reader supports mounted hidden results and rejects an ambiguous clock',()=>{
 const {readRoom}=require('../public/human-room-reader');
 const config={roomPath:'/draftclient/f1/123/2',leagueKey:'nfl.l.123',teamKey:'nfl.l.123.t.2',draftSlot:1,totalPicks:120};
 const location={pathname:config.roomPath};
 const leaf=['Player One','RB','SEA'].map(textContent=>({textContent,children:[]}));
 const player={getAttribute:()=> '1001',querySelector:()=>null,querySelectorAll:()=>leaf};
 const cells=[{tagName:'TD',textContent:'1'},{tagName:'TD',innerText:'Player One\nRB\nSEA'},{tagName:'TD',textContent:'Your Team'}];
 const table={tHead:{rows:[{cells:[{textContent:'Pick'},{textContent:'Player'}]}]},tBodies:[{rows:[{cells,querySelector:()=>player}]}]};
 const doc={body:{innerText:'0:30\nRound 1, Pick 2'},querySelectorAll:selector=>selector==='table'?[table]:[]};
 assert.equal(readRoom(doc,location,config).picks[0].position,'RB');cells[1].innerText='Player OneRBSEA';
 assert.equal(readRoom(doc,location,config).picks[0].name,'Player One');
 doc.body.innerText='0:30\n0:20\nRound 1, Pick 2';assert.throws(()=>readRoom(doc,location,config),/clock/);
 doc.body.innerText='9\nYour Turn • Round 1, Pick 2';assert.equal(readRoom(doc,location,config).observation.secondsLeft,9);
});
