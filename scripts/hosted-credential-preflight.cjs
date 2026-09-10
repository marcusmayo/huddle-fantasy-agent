'use strict';
const fs=require('node:fs');
function check(env=process.env){
 const required=['YAHOO_CLIENT_ID','YAHOO_CLIENT_SECRET','YAHOO_REDIRECT_URI','HUDDLE_TOKEN_ENCRYPTION_KEY','HUDDLE_YAHOO_TOKEN_FILE'];
 const presence=Object.fromEntries(required.map(k=>[k,Boolean(env[k]?.trim())]));
 const tokenFileReadable=Boolean(env.HUDDLE_YAHOO_TOKEN_FILE&&(()=>{try{fs.accessSync(env.HUDDLE_YAHOO_TOKEN_FILE,fs.constants.R_OK);return true;}catch{return false;}})());
 return {ready:Object.values(presence).every(Boolean)&&tokenFileReadable&&env.HUDDLE_YAHOO_OAUTH_ENABLED==='true',presence,tokenFileReadable,oauthEnabled:env.HUDDLE_YAHOO_OAUTH_ENABLED==='true'};
}
if(require.main===module){const result=check();console.log(JSON.stringify(result));process.exitCode=result.ready?0:1;}
module.exports={check};
