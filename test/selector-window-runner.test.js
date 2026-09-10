const test=require('node:test'),assert=require('node:assert/strict');
test('window runner stops on uncertain failure and records actual handoff boundaries',async()=>{
  const {createSelectorWindowRunner}=await import('../scripts/selector-window-runner.mjs');
  let now=0,calls=0,failed=false;const selector={cycle:async()=>{calls++;},status:()=>({failed,completed:false})};
  const runner=createSelectorWindowRunner({selector,now:()=>now,sleep:async ms=>{now+=ms;}});
  await runner.run(300);assert.equal(calls,2);now+=6000;failed=true;await runner.run(300);
  assert.equal(calls,3);assert.equal(runner.status().stopped,true);await runner.run(300);assert.equal(calls,3);
  const windows=runner.status().windows;assert.equal(windows[1].startedAt-windows[0].endedAt,6000);
  await assert.rejects(runner.run(30000),/at most/);
});
