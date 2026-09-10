const test=require('node:test'),assert=require('node:assert/strict');
let createYahooMockLoop,importAcknowledged;
test.before(async()=>({createYahooMockLoop,importAcknowledged}=await import('../scripts/yahoo-mock-cua-loop.mjs')));
test('frozen production runner captures an owned Draft table and acknowledges the same session import',async()=>{
  let mode='Results',snapshot;
  const raw=()=>({origin:'https://football.fantasysports.yahoo.com',path:'/draftclient/f1/1234/1',observedAt:new Date().toISOString(),header:'00:30\nYOUR TURN • ROUND 1, PICK 1',autoKnown:true,autodraft:false,playersSelected:mode==='Players',resultsSelected:mode==='Results',tables:[mode==='Players'?{kind:'players',headers:['Draft','Player','XRank','ADP','Bye','Proj Pts'],rows:[{yahooPlayerId:'100026',title:'Seahawks',cells:['','Seahawks\nDEF\nBye 8','1','1','8','120.5'],buttons:[]}]}:{kind:'results',headers:['Pick','Player','Team'],rows:[]}]});
  const yahoo={playwright:{evaluate:async()=>raw(),locator:()=>({filter:({hasText})=>({press:async()=>{mode=String(hasText).includes('Players')?'Players':'Results';}})})}};
  const huddle={playwright:{locator:()=>({fill:async value=>{snapshot=JSON.parse(value);},press:async()=>{}}),evaluate:async()=>({sessionId:'session',phase:'active',reconciled:0,pick:1,pending:false,inputEmpty:true,ready:true})}};
  const runner=createYahooMockLoop({yahoo,huddle,roomId:'1234',sessionId:'session',draftSlot:1,teamCount:2,rules:{roster:{DEF:1}}});
  assert.equal(Object.getOwnPropertyDescriptor(runner,'capture').writable,false);
  const captured=await runner.capture();assert.equal(captured.snapshot.availablePlayers[0].team,'SEA');
  assert.equal((await runner.sync(captured.snapshot)).ready,true);assert.equal(snapshot.observationEvidence.secondsLeft,30);
});
test('completion requires full board and matching session, not a numeric current pick',()=>{
  const snapshot={phase:'completed',picks:[{},{}]};const card={pending:false,inputEmpty:true,sessionId:'s',phase:'completed',reconciled:2,pick:NaN};
  assert.equal(importAcknowledged(card,snapshot,'s',2),true);
  for(const patch of [{sessionId:'other'},{phase:'active'},{reconciled:1},{pending:true}])assert.equal(importAcknowledged({...card,...patch},snapshot,'s',2),false);
});
test('autodraft becomes an explicit blocker and uncertain input cannot be repeated',async()=>{
  const r=createYahooMockLoop({simulation:true,yahoo:{},huddle:{},roomId:'1234',draftSlot:1,teamCount:2,rules:{roster:{QB:1}}});
  r.inspect=async()=>({header:'Opponent turn',autodraft:true,autoKnown:true});
  assert.match((await r.batch({waitMs:0})).result.blocked,/manual mode/);
  r.pending={pick:1};assert.match((await r.cycle()).blocked,/uncertain/);
});
