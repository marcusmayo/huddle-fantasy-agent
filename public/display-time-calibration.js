(function(root){
  'use strict';
  function create({request,model=root.HuddleTimeBounds,wall=Date.now,mono=()=>performance.now()}){
    let sample=null,pending=null;
    async function refresh(){
      if(pending)return pending;
      pending=(async()=>{const sentWallMs=wall(),sentMonoMs=mono();
        const response=await request('/api/clock-time',{timeoutMs:2000});
        sample=model.calibrate({sentWallMs,sentMonoMs,receivedWallMs:wall(),receivedMonoMs:mono(),serverWallMs:response.serverWallMs});
      })();try{await pending;}catch{sample=null;}finally{pending=null;}
    }
    function bounds(){try{return model.serverTimeBounds(sample,{wallMs:wall(),monoMs:mono()});}catch{return undefined;}}
    function tick(){if(!sample||mono()-sample.calibratedMonoMs>30000)void refresh();}
    return {refresh,bounds,tick};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.HuddleDisplayTime={create};
})(globalThis);
