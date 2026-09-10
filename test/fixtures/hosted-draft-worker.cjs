'use strict';
const fs=require('node:fs');
const {runHosted}=require('../../scripts/hosted-draft-server.cjs');
const {YahooReadOnlyClient}=require('../../src/providers/yahoo');
if(process.send){
const [file,mode,sessionId]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(file));
const client=new YahooReadOnlyClient({accessToken:'simulation-only',fetchImpl:async()=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(config.fixtureFeed))})});
runHosted({config,mode,sessionId,runtime:{visualClockEnabled:false,draftSimulation:true,yahooDraftPollIntervalMs:500},dependencies:{yahooAccount:{status:()=>({connected:false}),readClient:()=>client},yahooOAuth:{enabled:false,tokenStore:{configured:false}}}})
 .then(r=>{process.send?.({event:'ready',sessionId:r.sessionId});if(mode==='create')process.disconnect();else process.on('message',async m=>{if(m==='stop'){await r.close();process.disconnect();}});})
 .catch(e=>{process.send?.({event:'failed',code:e.code,message:e.message});process.exitCode=1;process.disconnect();});
}
