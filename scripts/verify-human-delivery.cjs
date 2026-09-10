'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {digest,verifyEvents}=require('../src/domain/decision-audit');
const {pickOwner}=require('../src/domain/league');
function verify(report){
 const audit=report.audit,session=audit.session,league=audit.recommendations[0].league,events=audit.events;
 assert.equal(verifyEvents(events),true,'Audit chain');assert.equal(session.picks.length,session.totalPicks,'Complete board');
 assert.equal(events.some(e=>e.type==='submit-started'||e.type==='controller-checkpoint'),false,'No draft executor');
 for(const snapshot of audit.recommendations){const {contentHash,...body}=snapshot;assert.equal(digest(body),contentHash,'Recommendation integrity');assert.equal(digest(audit.pools[snapshot.poolRevision].players),snapshot.poolRevision,'Pool integrity');}
 const checks=[];
 for(let pick=1;pick<=session.totalPicks;pick++){
   if(pickOwner(pick,league.teamCount)!==session.draftSlot)continue;
   const receipts=events.filter(e=>e.type==='human-recommendation-visible'&&e.overallPick===pick);
   assert.ok(receipts.length,'Missing visible recommendation at '+pick);
   for(const e of receipts){const s=audit.recommendations.find(s=>s.id===e.recommendationId);
     assert.ok(s,'Unknown recommendation');assert.equal(s.reconciledPicks,pick-1);assert.equal(e.observation.completedPicks,pick-1);
     assert.deepEqual(e.playerIds,[s.preferred,s.alternatives.safe,s.alternatives.upside].map(x=>x.player.id));
     const age=Date.parse(e.renderedAt)-Date.parse(e.observation.observedAt);assert.ok(age>=-1000&&age<=5000);
     const remaining=e.observation.secondsLeft*1000-Math.max(0,age)-1000;
     assert.ok(e.remainingMs>=10000&&e.remainingMs<=remaining,'Less than ten seconds at '+pick);
   }
   const closed=events.find(e=>e.type==='human-delivery-closed'&&e.overallPick===pick);assert.equal(closed?.passed,true);
   assert.equal(session.humanDelivery.turns[pick].failed,false);checks.push({pick,minimumRemainingMs:Math.min(...receipts.map(e=>e.remainingMs))});
 }
 return {passed:true,clock:report.clock,ownedDeliveries:checks.length,completedPicks:session.picks.length,minimumRemainingMs:Math.min(...checks.map(c=>c.minimumRemainingMs)),checks};
}
if(require.main===module){try{const result=verify(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify(result,null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verify};
