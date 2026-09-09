'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isFreshObservation}=require('../src/domain/observation-time');
test('freshness tolerates bounded clock skew but never extends the five-second age limit',()=>{
  const now=Date.parse('2026-09-09T02:02:53.931Z');
  assert.equal(isFreshObservation('2026-09-09T02:02:53.934Z',now),true);
  assert.equal(isFreshObservation(new Date(now+1000).toISOString(),now),true);
  assert.equal(isFreshObservation(new Date(now+1001).toISOString(),now),false);
  assert.equal(isFreshObservation(new Date(now-5000).toISOString(),now),true);
  assert.equal(isFreshObservation(new Date(now-5001).toISOString(),now),false);
  assert.equal(isFreshObservation('invalid',now),false);
});
