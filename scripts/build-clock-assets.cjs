'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'public/vendor/yahoo-clock');
fs.mkdirSync(target,{recursive:true});
for(const name of ['tesseract.min.js','worker.min.js'])fs.copyFileSync(path.join(root,'node_modules/tesseract.js/dist',name),path.join(target,name));
const core=path.join(root,'node_modules/tesseract.js-core');
for(const name of fs.readdirSync(core).filter(n=>n.endsWith('.wasm.js')||n.endsWith('.wasm')))fs.copyFileSync(path.join(core,name),path.join(target,name));
fs.copyFileSync(path.join(require('@tesseract.js-data/eng').langPath,'eng.traineddata.gz'),path.join(target,'eng.traineddata.gz'));
console.log('Local Yahoo clock recognition assets prepared.');
