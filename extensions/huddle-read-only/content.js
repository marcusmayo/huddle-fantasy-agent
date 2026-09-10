'use strict';
let stop=null;
async function connect(){
  if(stop)return;
  try{
    const result=await chrome.runtime.sendMessage({type:'config'});if(!result?.config)return;
    stop=HuddleHumanRoom.start({document,location,config:result.config,send:async snapshot=>{
      const reply=await chrome.runtime.sendMessage({type:'observation',snapshot});if(reply?.error)throw Error(reply.error);
    }});
  }catch{/* Huddle expires the feed rather than treating an absent source as healthy. */}
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.config){stop?.();stop=null;connect();}});
addEventListener('pagehide',()=>stop?.());connect();
