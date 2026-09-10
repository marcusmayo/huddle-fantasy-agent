'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../public/turn-evidence');
test('mixed evidence never erases a late or failed turn and all missing turns remain visible',()=>{
 const events=[{type:'human-recommendation-visible',overallPick:1,timely:true},{type:'human-recommendation-visible',overallPick:1,timely:false},{type:'human-recommendation-visible',overallPick:2,timely:true},{type:'human-recommendation-visible',overallPick:3,timely:true}];
 const r=summarize({events,picks:[1,2,3,4],turns:{2:{failed:true}}});
 assert.deepEqual(r.rows.map(r=>r.timing),['late','failed','verified','unknown']);assert.equal(r.verified,1);assert.equal(r.failed,2);assert.equal(r.unknown,1);
});
