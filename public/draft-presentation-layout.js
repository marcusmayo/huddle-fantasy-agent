(function(){
  'use strict';
  if(new URLSearchParams(location.search).get('presentation')!=='compact')return;
  const stage=document.querySelector('.stage'),receipts=stage.querySelector('.receipts');
  const groups=[['left',stage.querySelector('.recommendation')],['middle',stage.querySelector('.alternatives'),receipts.children[0]],['right',stage.querySelector('.decision'),receipts.children[1]]];
  for(const [name,...panels] of groups){const column=document.createElement('div');column.className='presentation-column presentation-'+name;column.append(...panels);stage.insertBefore(column,stage.querySelector('footer'));}
  receipts.remove();document.documentElement.dataset.presentation='compact';
  const decision=stage.querySelector('.decision'),roster=document.getElementById('roster');
  const positionDecision=()=>{const target=stage.querySelector(roster.children.length>=8?'.presentation-left':'.presentation-right');if(decision.parentElement!==target){if(roster.children.length>=8)target.append(decision);else target.prepend(decision);}};
  new MutationObserver(positionDecision).observe(roster,{childList:true});positionDecision();
})();
