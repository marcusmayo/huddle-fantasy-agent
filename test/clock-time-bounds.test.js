'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calibrate,serverTimeBounds}=require('../public/clock-time-bounds');
test('cross-machine timestamps retain offset and round-trip uncertainty',()=>{
  const c=calibrate({sentWallMs:1000,receivedWallMs:1200,sentMonoMs:0,receivedMonoMs:200,serverWallMs:6100});
  assert.equal(c.offsetMs,5000);assert.equal(c.uncertaintyMs,200);
  assert.deepEqual(serverTimeBounds(c,{wallMs:1300,monoMs:300}),{earliestMs:6100,latestMs:6500});
  assert.throws(()=>serverTimeBounds(c,{wallMs:5000,monoMs:300}),/wall clock changed/);
  assert.throws(()=>serverTimeBounds(c,{wallMs:100000,monoMs:61000}),/expired/);
});
test('wall-clock jumps and slow calibration never become precise timing evidence',()=>{
  assert.throws(()=>calibrate({sentWallMs:1000,receivedWallMs:5000,sentMonoMs:0,receivedMonoMs:200,serverWallMs:6100}),/uncertain/);
  assert.throws(()=>calibrate({sentWallMs:1000,receivedWallMs:4000,sentMonoMs:0,receivedMonoMs:3000,serverWallMs:6100}),/uncertain/);
});
