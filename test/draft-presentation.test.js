const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/draft-presentation.js'),'utf8');
function harness(requestWindow,search='?leagueId=fixture&sessionId=session'){
  const nodes=new Map();const element=()=>({hidden:false,disabled:false,textContent:'',children:[],events:{},append(...children){this.children.push(...children);},addEventListener(name,fn){this.events[name]=fn;}});
  const doc={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,createTextNode:text=>({textContent:text}),head:element(),body:element()};
  const events={},context={document:doc,window:{documentPictureInPicture:requestWindow?{requestWindow}:undefined},location:{search,origin:'http://127.0.0.1:8000'},URL,URLSearchParams,performance,setTimeout,clearTimeout,addEventListener:(name,fn)=>events[name]=fn};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/presentation-capture.js'),'utf8'),context);vm.runInContext(source,context);return {nodes,doc,events};
}
test('unsupported presentation keeps normal draft accessible and does not claim a timing pass',()=>{
  const h=harness();assert.equal(h.nodes.get('open').disabled,true);assert.match(h.nodes.get('normal').href,/draft-view.html\?leagueId=fixture&sessionId=session/);assert.match(h.nodes.get('status').textContent,/cannot open/);
});
test('denied opening can be retried without hiding normal draft',async()=>{
  let calls=0;const h=harness(async()=>{calls++;throw Error('Browser denied');});
  await h.nodes.get('open').onclick();assert.equal(calls,1);assert.equal(h.nodes.get('open').disabled,false);assert.equal(h.nodes.get('normal').hidden,false);assert.match(h.nodes.get('status').textContent,/Browser denied/);
  await h.nodes.get('open').onclick();assert.equal(calls,2);
});
test('concurrent opening is suppressed and closing allows a fresh single view',async()=>{
  let resolve,calls=0;const h=harness(()=>{calls++;return new Promise(r=>resolve=r);});
  const first=h.nodes.get('open').onclick();await h.nodes.get('open').onclick();assert.equal(calls,1);
  const events={},pip={document:h.doc,addEventListener:(name,fn)=>events[name]=fn,close(){events.pagehide();}};
  resolve(pip);await first;assert.equal(h.nodes.get('normal').hidden,true);assert.equal(h.nodes.get('open').disabled,true);
  await h.nodes.get('open').onclick();assert.equal(calls,1);
  h.nodes.get('close').onclick();assert.equal(h.nodes.get('open').disabled,false);assert.equal(h.nodes.get('normal').hidden,false);assert.match(h.nodes.get('status').textContent,/reconnect the Yahoo clock/);
});
