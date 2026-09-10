const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');const c={};vm.runInNewContext(fs.readFileSync(require.resolve('../public/presentation-fit.js'),'utf8'),c);function fixture({complete=false,height=700,needed=650,hidden=[]}={}){const doc={body:{dataset:{complete:String(complete)}},documentElement:{scrollHeight:Math.max(height,needed),scrollWidth:619},querySelector:()=>({getBoundingClientRect:()=>({bottom:needed})}),getElementById:id=>({getClientRects:()=>hidden.includes(id)?[]:[1],getBoundingClientRect:()=>({top:10,left:10,right:610,bottom:Math.min(needed,680)})})};const view={innerWidth:619,innerHeight:height,getComputedStyle:()=>({visibility:'visible',opacity:'1'})};return c.HuddlePresentationFit.measure(doc,view);}
test('active page requires all alternatives and reconciled selection',()=>{const r=fixture();assert.equal(r.pageFits,true);assert.ok(r.panels.every(p=>p.visible));assert.ok(r.panels.some(p=>p.id==='selected'));assert.equal(fixture({hidden:['upside']}).panels.find(p=>p.id==='upside').visible,false);});
test('completed page excludes intentionally hidden alternatives without hiding required receipts',()=>{const r=fixture({complete:true,hidden:['safe','upside']});assert.ok(r.panels.every(p=>p.visible));assert.equal(r.panels.some(p=>p.id==='safe'),false);assert.equal(fixture({complete:true,hidden:['roster']}).panels.find(p=>p.id==='roster').visible,false);});
test('undersized view returns actual required height and fails',()=>{const r=fixture({height:518,needed:650});assert.equal(r.requiredHeight,650);assert.equal(r.pageFits,false);assert.ok(r.panels.some(p=>!p.visible));});


test('startup reserve distinguishes tight fit from enough room for the observed viewport loss',()=>{
 const tight=fixture({height:650,needed:629});assert.equal(tight.pageFits,true);assert.equal(tight.reserveReady,false);assert.equal(tight.reserveHeight,701);
 const ready=fixture({height:701,needed:629});assert.equal(ready.reserveReady,true);
 assert.equal(fixture({complete:true,height:650,needed:629}).reserveReady,true);
});
