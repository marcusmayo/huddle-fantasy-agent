'use strict';
function validConfig(c){
  const url=new URL(c.endpoint);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password||url.search||url.hash
    ||!/^\/api\/leagues\/[^/]+\/draft\/sessions\/[^/]+\/human-feed$/.test(url.pathname)||!/^[a-f0-9]{64}$/.test(c.token)
    ||!/^\/draftclient\/f1\/\d+\/\d+$/.test(c.roomPath))throw Error('Import a connection file from the local Huddle draft page');
  return c;
}
async function handle(message,sender){
  if(message.type==='configure'){
    if(sender.url!==chrome.runtime.getURL('popup.html'))throw Error('Use the companion popup to connect');
    const config=validConfig(message.config);await chrome.storage.local.set({config});await chrome.storage.session.remove('sourceTab');return {ok:true};
  }
  const {config}=await chrome.storage.local.get('config');if(!config)throw Error('Import the Huddle connection file first');validConfig(config);
  const source=new URL(sender.url||'');
  if(!sender.tab||sender.frameId!==0||source.origin!=='https://football.fantasysports.yahoo.com'||source.pathname.replace(/\/$/,'')!==config.roomPath)
    throw Error('The source is not the connected Yahoo room');
  const {sourceTab}=await chrome.storage.session.get('sourceTab');
  if(sourceTab!==undefined&&sourceTab!==sender.tab.id)throw Error('Another Yahoo tab is already supplying this feed; reconnect to switch tabs');
  if(sourceTab===undefined)await chrome.storage.session.set({sourceTab:sender.tab.id});
  if(message.type==='config')return {config:{roomPath:config.roomPath,leagueKey:config.leagueKey,teamKey:config.teamKey,draftSlot:config.draftSlot,totalPicks:config.totalPicks,teamCount:config.teamCount}};
  if(message.type!=='observation')throw Error('Unsupported companion message');
  const response=await fetch(config.endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{'content-type':'application/json',authorization:`Bearer ${config.token}`},
    body:JSON.stringify(message.snapshot),signal:AbortSignal.timeout(2500)});
  const result=await response.json();if(!response.ok)throw Error(result.message||'Huddle rejected the draft observation');
  return {ok:true};
}
let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  queue=queue.then(()=>handle(message,sender)).then(reply,e=>reply({error:e.message}));return true;
});
