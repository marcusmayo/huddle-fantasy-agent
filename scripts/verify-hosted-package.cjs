'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
function verify(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'deployment-manifest.json'))),errors=[];
 if(manifest.version!==1)throw Error('Unsupported deployment manifest');
 for(const [name,item]of Object.entries(manifest.files)){
  const file=path.resolve(root,name),base=path.resolve(root)+path.sep;
  if(!file.startsWith(base)){errors.push('invalid-path');continue;}
  try{const bytes=fs.readFileSync(file);if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)errors.push(name);}catch{errors.push(name);}
 }
 return {verified:!errors.length,files:Object.keys(manifest.files).length,errors};
}
if(require.main===module){const result=verify(process.argv[2]||process.cwd());console.log(JSON.stringify(result));process.exitCode=result.verified?0:1;}
module.exports={verify};
