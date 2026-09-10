'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createWorker}=require('tesseract.js');
const {parse}=require('../public/yahoo-clock-model');
async function main(){
  const worker=await createWorker('eng',1,{langPath:require('@tesseract.js-data/eng').langPath,cacheMethod:'none',logger:()=>{}});
  try{
    await worker.setParameters({tessedit_pageseg_mode:'11'});
    const output=[];
    for(const name of ['pick-8-yahoo.png','after-25-yahoo.png','after-41-yahoo.png']){
      const started=performance.now();
      const processed=process.argv.includes('--processed');
      const {data}=await worker.recognize(path.resolve(processed?'.media-build/clock-validation':'.media-build/live-draft',name),processed?{}:{rectangle:{left:0,top:0,width:1600,height:95}});
      let parsed,error;try{parsed=parse(data.text,{confidence:data.confidence});}catch(e){error=e.message;}
      output.push({fixture:name,elapsedMs:performance.now()-started,confidence:data.confidence,text:data.text,parsed,error});
    }
    fs.mkdirSync('.media-build/clock-validation',{recursive:true});
    fs.writeFileSync('.media-build/clock-validation/ocr-fixtures'+(process.argv.includes('--processed')?'-processed':'')+'.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
  }finally{await worker.terminate();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
