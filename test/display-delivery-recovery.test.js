'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../public/draft-display-delivery');
const settle=()=>new Promise(r=>setImmediate(r));
function fixture(request){let t=0,n=0;const saved=new Map();const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const options={base:'/session',storage,now:()=>t,mono:()=>t,uuid:()=>String(++n),request};return {options,advance:ms=>{t+=ms;},make:()=>create(options)};}
test('one stalled receipt cannot prevent the next turn being saved; stable IDs survive retry',async()=>{
 let release,calls=[];const f=fixture(async(path,o)=>{const body=JSON.parse(o.body);if(path.endsWith('trace'))return {};calls.push(body.receiptId);if(body.receiptId==='one')return new Promise(r=>release=r);return {timing:'unknown'};});
 const d=f.make();d.enqueue('a','/display-receipt',{receiptId:'one',overallPick:1});d.enqueue('b','/display-receipt',{receiptId:'two',overallPick:2});await settle();
 assert.deepEqual(calls,['one','two']);assert.ok(d.snapshot().done.includes('b'));release({timing:'unknown'});await settle();assert.equal(d.snapshot().pending.length,0);
});
test('timeout retry uses identical payload; reload recovers durable pending evidence without a clock session',async()=>{
 const calls=[];let failures=1;const f=fixture(async(path,o)=>{if(path.endsWith('trace'))throw Error('offline');calls.push(JSON.parse(o.body));if(failures--)throw Object.assign(Error('timeout'),{code:'REQUEST_TIMEOUT'});return {timing:'unknown'};});
 let d=f.make();d.trace('receipt-skipped',{reason:'panels-clipped',overallPick:1});d.enqueue('a','/display-receipt',{receiptId:'same',overallPick:1});await settle();
 await d.stop();f.advance(1000);d=f.make();d.tick();await settle();assert.deepEqual(calls[0],calls[1]);assert.ok(d.snapshot().trace.some(e=>e.reason==='panels-clipped'));assert.ok(d.snapshot().done.includes('a'));
});
test('invalid past-board receipt is terminal, never relabeled timely or endlessly retried',async()=>{
 let calls=0;const f=fixture(async path=>{if(path.endsWith('trace'))throw Error('offline');calls++;throw Object.assign(Error('old board'),{status:400,code:'DISPLAY_RECEIPT_INVALID'});});const d=f.make();
 d.enqueue('a','/display-receipt',{receiptId:'past',overallPick:1});await settle();f.advance(5000);d.tick();await settle();assert.equal(calls,1);assert.equal(d.snapshot().pending.length,0);assert.ok(d.snapshot().trace.some(e=>e.type==='receipt-terminal'));
});

test('rejected observation remains failed but a new rendering may be acknowledged',async()=>{
 let reject=true;const f=fixture(async path=>{if(path.endsWith('trace'))return {};if(reject)throw Object.assign(Error('invalid'),{status:400,code:'DISPLAY_RECEIPT_INVALID'});return {timing:'unknown'};});const d=f.make();
 d.enqueue('card','/display-receipt',{receiptId:'first'});await settle();assert.equal(d.snapshot().done.includes('card'),false);assert.equal(d.has('card'),true);
 f.advance(1001);reject=false;assert.equal(d.has('card'),false);d.enqueue('card','/display-receipt',{receiptId:'new-render'});await settle();
 assert.equal(d.snapshot().outcomes.first.state,'receipt-terminal');assert.equal(d.snapshot().outcomes['new-render'].state,'receipt-acknowledged');assert.equal(d.has('card'),true);
});
