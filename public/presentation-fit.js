(function(root){
 function measure(doc,view){
  const completed=doc.body.dataset.complete==='true';
  const ids=completed?['preferred','selected','recent','roster']:['preferred','safe','upside','reasons','selected','recent','roster'];
  const panels=ids.map(id=>{const e=doc.getElementById(id),r=e?.getBoundingClientRect(),s=e&&view.getComputedStyle(e);return {id,visible:Boolean(e?.getClientRects().length&&s.visibility==='visible'&&Number(s.opacity)>0&&r.top>=0&&r.left>=0&&r.right<=view.innerWidth+2&&r.bottom<=view.innerHeight+2)};});
  const contentHeight=Math.ceil(doc.querySelector('.stage').getBoundingClientRect().bottom+(view.scrollY||0)),reservePixels=completed?0:72;
  const reserveHeight=contentHeight+reservePixels,reserveReady=reserveHeight<=view.innerHeight;
  return {contentHeight,reservePixels,reserveHeight,reserveReady,completed,width:view.innerWidth,height:view.innerHeight,requiredHeight:doc.documentElement.scrollHeight,pageFits:doc.documentElement.scrollHeight<=view.innerHeight+2&&doc.documentElement.scrollWidth<=view.innerWidth+2,panels};
 }
 root.HuddlePresentationFit={measure};
})(globalThis);
