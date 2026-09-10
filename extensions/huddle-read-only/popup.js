'use strict';
document.getElementById('connection').onchange=async event=>{
  const status=document.getElementById('status');try{
    const file=event.target.files[0];if(!file||file.size>10000)throw Error('Choose the small Huddle connection JSON file');
    const reply=await chrome.runtime.sendMessage({type:'configure',config:JSON.parse(await file.text())});
    if(reply.error)throw Error(reply.error);status.textContent='Connected. Open the matching Yahoo room and keep Huddle visible. Huddle will confirm when results and clock are fresh.';
  }catch(e){status.textContent=e.message;}
};
