'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deliver}=require('../public/display-receipt-routing');
const {create}=require('../public/display-time-calibration');
test('API visibility persists when matching clock bounds fail; valid clock records independent evidence',()=>{
 const sent=[],traces=[],body={recommendationId:'r1',overallPick:1};let n=0;
 const args={model:{api:true,screenClock:{},human:{observation:{onClock:true}},turnAgreement:'matched'},body,
 delivery:{enqueue:(...v)=>sent.push(v),trace:(...v)=>traces.push(v)},displayBounds:()=>undefined,clockBounds:()=>{throw Error('expired');},uuid:()=>String(++n)};
 deliver(args);assert.deepEqual(sent.map(x=>x[1]),['/display-receipt']);assert.equal(traces[0][1].reason,'expired');
 sent.length=0;deliver({...args,clockBounds:()=>({earliestMs:1,latestMs:2})});
 assert.deepEqual(sent.map(x=>x[1]),['/display-receipt','/clock-delivery']);assert.notEqual(sent[0][2].receiptId,sent[1][2].receiptId);
});
test('display calibration handles wall-clock skew and invalidates changed wall clock without blocking visibility',async()=>{
 let wall=100000,mono=0;
 const clock=create({model:require('../public/clock-time-bounds'),wall:()=>wall,mono:()=>mono,request:async()=>{wall+=100;mono+=100;return {serverWallMs:1000};}});
 await clock.refresh();const bounds=clock.bounds();assert.ok(bounds.earliestMs<=1050&&bounds.latestMs>=1050);
 wall+=10000;assert.equal(clock.bounds(),undefined);
});
