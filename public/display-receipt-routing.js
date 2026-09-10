(function(root){
  'use strict';
  function deliver({model:m,body,delivery,displayBounds,clockBounds,uuid}){
    const id=body.recommendationId;
    // Save visibility independently, even if the optional clock is unavailable.
    if(m.api)delivery.enqueue(id+':visibility','/display-receipt',{...body,receiptId:uuid(),renderBounds:displayBounds()});
    const timed=Boolean(m.screenClock&&m.human?.observation?.onClock&&m.turnAgreement==='matched');
    if(timed){
      try{delivery.enqueue(id+':clock','/clock-delivery',{...body,receiptId:uuid(),renderBounds:clockBounds()});}
      catch(e){delivery.trace('receipt-skipped',{recommendationId:id,overallPick:body.overallPick,reason:e.message});}
    }else if(!m.api)delivery.enqueue(id+':human','/human-delivery',{...body,receiptId:uuid()});
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={deliver};else root.HuddleReceiptRouting={deliver};
})(globalThis);
