// Controlled image source; not Yahoo screen-capture evidence.
export async function connectSyntheticClock(view){
    await view.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1100;canvas.height=900;
      const ctx=canvas.getContext('2d');let busy=false;
      const paint=async()=>{if(busy)return;busy=true;try{const s=await(await fetch('/validation/state')).json();ctx.fillStyle='#171a23';ctx.fillRect(0,0,1100,900);ctx.fillStyle='white';ctx.font='26px Arial';ctx.fillText('Controlled browser validation - H2H',24,40);ctx.fillText(String(Math.floor(s.seconds/60)).padStart(2,'0')+':'+String(s.seconds%60).padStart(2,'0'),24,90);ctx.font='22px Arial';ctx.fillText(s.phase==='waiting'?'Waiting to start':(s.mine?'YOUR TURN':"Opponent's Pick - You're up in 1 Pick")+' - ROUND '+Math.ceil(s.pick/2)+', PICK '+s.pick,24,145);}finally{busy=false;}};
      await paint();window.syntheticPaint=setInterval(paint,100);window.syntheticCanvas=canvas;
      await window.HuddlePresentationReceiver.connect(canvas.captureStream(10));
    });
    await view.waitForTimeout(7000);
}
