(function(root){
 'use strict';
 function summarize({events=[],turns={},picks=[]}){
  const rows=picks.map(pick=>{
   const receipts=events.filter(e=>e.overallPick===pick&&['recommendation-displayed','human-recommendation-visible'].includes(e.type));
   const turn=turns[pick]||{},late=receipts.some(e=>e.timely===false);
   const timing=late?'late':turn.failed?'failed':receipts.some(e=>e.timely===true)?'verified':'unknown';
   return {pick,receiptCount:receipts.length,timing};
  });
  return {rows,verified:rows.filter(r=>r.timing==='verified').length,failed:rows.filter(r=>['late','failed'].includes(r.timing)).length,unknown:rows.filter(r=>r.timing==='unknown').length,displayed:rows.filter(r=>r.receiptCount>0).length};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={summarize};else root.HuddleTurnEvidence={summarize};
})(globalThis);
