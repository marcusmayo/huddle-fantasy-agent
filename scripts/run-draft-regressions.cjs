'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,process.argv[2]||'.media-build/gate-regression');fs.mkdirSync(out,{recursive:true});
// Measured complete workloads: ~35s, ~63s and ~267s in isolation. Finite
// workload-specific limits retain all assertions and allow shared CPU variance.
const limits={'human-draft-feed.test.js':180000,'season-pressure.test.js':240000,'live-execution-controller.test.js':600000};
const files=fs.readdirSync(path.join(root,'test')).filter(f=>/\.test\.(js|mjs|cjs)$/.test(f));let cursor=0;const results=[];
async function worker(){while(cursor<files.length){const file=files[cursor++];await new Promise(resolve=>{
 const start=Date.now(),child=spawn(process.execPath,['--test','--test-isolation=none',path.join('test',file)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',timedOut=false;
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>{timedOut=true;child.kill();},limits[file]||60000);
 child.on('error',e=>{output+=e.message;});child.on('close',code=>{clearTimeout(timer);fs.writeFileSync(path.join(out,file+'.log'),output);results.push({file,code,timedOut,ms:Date.now()-start});fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({completed:results.length,total:files.length,last:results.at(-1)}));resolve();});
 });}}
Promise.all(Array.from({length:4},worker)).then(()=>{const summary={files:files.length,passed:results.filter(r=>r.code===0&&!r.timedOut).length,failures:results.filter(r=>r.code!==0||r.timedOut),results};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({files:summary.files,passed:summary.passed,failures:summary.failures}));process.exitCode=summary.failures.length?1:0;});
