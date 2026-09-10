const test=require('node:test'),assert=require('node:assert/strict');let createHumanSelector;
test.before(async()=>({createHumanSelector}=await import('../scripts/independent-human-selector.mjs')));
function fixture({clock=30,lag=0,uncertain=false,slow=0,auto=false,prepareDelay=0,displayDelay=0,confirmationDelay=0}={}){
 let t=100000,pick=1,started=t,accepted=[],calls=0,reads=0;
 const identity={sessionId:'s',leagueId:'l',leagueKey:'nfl.l.123',teamKey:'nfl.l.123.t.1',draftSlot:1,teamCount:1,totalPicks:15};
 const observation=()=>({observedAt:new Date(t).toISOString(),phase:pick===16?'completed':'drafting',overallPick:pick,completedPicks:pick-1,onClock:pick<=15,secondsLeft:clock-(t-started)/1000,autodraft:auto,manualModeKnown:true,...identity});
 const player=()=>({yahooPlayerId:String(100+pick),name:'Player '+pick,position:'RB',team:'DET'});
 const view=()=>({observedAt:new Date(t).toISOString(),sessionId:'s',leagueId:'l',completed:pick===16,overallPick:t-started<lag?pick-1:pick,stale:false,allPanelsInFrame:true,recommendationId:'rev'+pick,accepted:structuredClone(accepted),choices:[player(),{...player(),yahooPlayerId:'500'},{...player(),yahooPlayerId:'501'}]});
 const room={version:'selector-2026-09-09-v2',observe:async()=>observation(),prepare:async()=>{t+=prepareDelay;return {observation:observation(),players:[player()]};},recoverManual:async()=>{auto=false;return observation();},submit:async()=>{calls++;t+=slow;accepted.push({overallPick:pick,yahooPlayerId:player().yahooPlayerId});pick++;started=t;if(uncertain)throw Error('transport lost');}};
 const selector=createHumanSelector({room,display:{read:async()=>{t+=++reads===2?confirmationDelay:displayDelay;return view();}},identity,now:()=>t,sleep:async ms=>{t+=ms;}});
 return {selector,calls:()=>calls,advance:ms=>{t+=ms;},expire:()=>{pick++;started=t;}};
}
for(const clock of [15,30,70])test(`all 15 consecutive turns at ${clock}s use independent displayed choices without a write-back feed`,async()=>{
 const f=fixture({clock});for(let i=0;i<16;i++)await f.selector.cycle();const r=f.selector.status();assert.equal(r.passed,true,JSON.stringify(r));assert.equal(f.calls(),15);assert.ok(Object.values(r.turns).every(t=>t.visibleRemainingMs===(clock*1000-1000)));
});
test('late feed fails ten-second reserve independently of successful selections',async()=>{
 const f=fixture({clock:30,lag:22000});await f.selector.cycle();for(let i=0;i<11;i++){f.advance(2000);await f.selector.cycle();}assert.equal(f.selector.status().failed,true);assert.ok(f.selector.status().events.some(e=>e.type==='recommendation-deadline'));assert.equal(f.calls(),0);
});
test('uncertain accepted input is never submitted twice and cannot pass validation',async()=>{
 const f=fixture({uncertain:true});await f.selector.cycle();await f.selector.cycle();assert.equal(f.calls(),1);const r=f.selector.status();assert.equal(r.turns[1].outcome,'input-uncertain');assert.equal(r.failed,true);assert.equal(r.events.filter(e=>e.type==='input-uncertain'&&e.pick===1).length,1);
});
test('actual transport overruns are retained as failures even if the underlying action succeeds',async()=>{
 const f=fixture({slow:6000});await f.selector.cycle();assert.ok(f.selector.status().events.some(e=>e.type==='operation-overrun'));assert.equal(f.calls(),1);
});
test('autodraft recovery does not authorize another pick in the failed run',async()=>{const f=fixture({auto:true});await f.selector.cycle();assert.equal(f.calls(),0);assert.ok(f.selector.status().failed);await f.selector.cycle();assert.equal(f.calls(),0);});

test('an external observation gap cannot be followed by another submission',async()=>{
 const f=fixture();await f.selector.cycle();f.advance(6000);await f.selector.cycle();assert.equal(f.calls(),1);assert.equal(f.selector.status().turns[1].outcome,'manual-accepted');assert.ok(f.selector.status().events.some(e=>e.type==='observation-gap'));assert.equal(f.selector.status().stage,'blocked');
});

for(const field of ['prepareDelay','displayDelay','confirmationDelay'])test(`${field} overrun blocks submission in the same cycle`,async()=>{
 const f=fixture({[field]:2100});await f.selector.cycle();assert.equal(f.calls(),0);assert.ok(f.selector.status().events.some(e=>e.type==='operation-overrun'));await f.selector.cycle();assert.equal(f.calls(),0);
});

test('a first recommendation below ten seconds cannot trigger selection',async()=>{
 const f=fixture({clock:10});await f.selector.cycle();assert.equal(f.calls(),0);assert.ok(f.selector.status().events.some(e=>e.type==='recommendation-deadline'));
});

test('an observed turn waiting for recommendations becomes a terminal failure after expiry',async()=>{
 const f=fixture({lag:22000});await f.selector.cycle();assert.equal(f.selector.status().turns[1].outcome,'waiting-for-recommendation');
 f.expire();await f.selector.cycle();const result=f.selector.status();assert.equal(result.turns[1].outcome,'expired-unsubmitted');assert.equal(result.failed,true);assert.equal(f.calls(),0);
});
test('window boundaries expose caller gaps without claiming to eliminate them',async()=>{
 const f=fixture();await f.selector.runWindow(2500);f.advance(7000);await f.selector.runWindow(2500);
 const events=f.selector.status().events;assert.equal(events.filter(e=>e.type==='window-start').length,2);assert.equal(events.filter(e=>e.type==='window-end').length,2);assert.ok(events.some(e=>e.type==='observation-gap'));
});
