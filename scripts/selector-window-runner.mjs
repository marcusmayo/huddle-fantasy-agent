// Validation runner: invoke adjacent windows through the supported CUA tool.
// Never launch this as a detached job: CUA requires an active exec context.
export function createSelectorWindowRunner({selector,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  let busy=false,stopped=false;const windows=[];
  async function run(ms=20000){
    if(busy)throw Error('A selector window is already running');
    if(!Number.isFinite(ms)||ms<1||ms>20000)throw Error('Window must be at most 20000 ms');
    busy=true;const w={startedAt:now(),requestedMs:ms};windows.push(w);
    try{
      while(now()<w.startedAt+ms&&!stopped){
        await selector.cycle();const s=selector.status();
        if(s.failed||s.completed){stopped=true;break;}
        await sleep(150);
      }
      return selector.status();
    }finally{w.endedAt=now();busy=false;}
  }
  return {run,stop(){stopped=true;},status(){return {stopped,busy,windows:structuredClone(windows),selector:selector.status()};}};
}
