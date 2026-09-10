'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/yahoo-clock-reader.js'),'utf8'),context);
const line=(text,x0,y0,x1,y1)=>({text,bbox:{x0,y0,x1,y1}});
test('source region retains the room identity, timer and full turn line',()=>{
  const data={blocks:[{paragraphs:[{lines:[line('Unrelated title',10,10,800,40),line('Clock reader validation - H2H',20,100,500,125),line('01:10',1100,65,1250,90),line('YOUR TURN • ROUND 2, PICK 4',900,100,1550,125)]}]}]};
  const region=context.HuddleYahooClockReader.locate(data,900,848,'Clock reader validation');
  assert.ok(region.height<160);assert.ok(region.x<=10);assert.ok(region.x+region.width>=775);assert.ok(region.y<=32);assert.ok(region.y+region.height>=62.5);
  assert.equal(region.regions.length,3);
  assert.equal(region.regions[0].x,0); // Movement padding is clamped to the source.
  for(const crop of region.regions){assert.ok(crop.x>=0&&crop.y>=0&&crop.width>0&&crop.height>0);assert.ok(crop.x+crop.width<=900);}
});

test('lossless grayscale bitmap has correct palette, padding and bottom-up rows',()=>{
  const rgba=new Uint8ClampedArray([10,10,10,255,20,20,20,255,30,30,30,255,40,40,40,255,50,50,50,255,60,60,60,255]);
  const bytes=context.HuddleYahooClockReader.bitmap({width:3,height:2,getContext:()=>({getImageData:()=>({data:rgba})})});
  const v=new DataView(bytes.buffer);assert.equal(v.getUint32(2,true),1086);assert.equal(v.getUint32(10,true),1078);assert.equal(v.getUint16(28,true),8);
  assert.deepEqual(Array.from(bytes.slice(1078)),[40,50,60,0,10,20,30,0]);
  assert.deepEqual(Array.from(bytes.slice(54+200*4,54+201*4)),[200,200,200,0]);
});

test('bitmap rejects empty and oversized image dimensions',()=>{
  for(const [width,height] of [[0,10],[10,0],[10000,10000]])assert.throws(()=>context.HuddleYahooClockReader.bitmap({width,height}),/dimensions/);
});

test('regional recognition joins only its three source bands and preserves weakest confidence',async()=>{
  const drawn=[],outputs=[{text:'Test room',confidence:92},{text:'00:30',confidence:85},{text:'YOUR TURN • ROUND 1, PICK 1',confidence:91}];
  const ctx={document:{createElement:()=>{const c={};c.getContext=()=>({drawImage:(...a)=>drawn.push(a),getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})});return c;}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/yahoo-clock-reader.js'),'utf8'),ctx);
  const modes=[],worker={setParameters:async p=>modes.push(p.tessedit_pageseg_mode),recognize:async()=>({data:outputs.shift()})},source={id:'one captured frame'};
  const r=await ctx.HuddleYahooClockReader.recognizeFrame(worker,source,[{top:0,width:40,height:20},{top:32,width:30,height:20},{top:64,width:80,height:20}]);
  assert.deepEqual(modes,['7']);assert.equal(r.data.confidence,85);assert.equal(r.data.text,'Test room\n00:30\nYOUR TURN • ROUND 1, PICK 1');
  assert.ok(drawn.every(a=>a[0]===source));assert.deepEqual(drawn.map(a=>a[2]),[0,32,64]);
});
test('missing or wrong room identity does not lock an unsafe source region',()=>{
  const data={blocks:[{paragraphs:[{lines:[line('Wrong room',0,0,300,20),line('00:30',500,0,600,20),line('YOUR TURN • ROUND 1, PICK 1',400,30,800,60)]}]}]};
  assert.equal(context.HuddleYahooClockReader.locate(data,900,848,'Expected room'),null);
});

test('parallel regions retain source order and wait for all workers before reporting failure',async()=>{
  const canvases=[],jobs=[],source={frame:12};
  const ctx={document:{createElement:()=>{const c={};canvases.push(c);c.getContext=()=>({drawImage:s=>assert.equal(s,source),getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})});return c;}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/yahoo-clock-reader.js'),'utf8'),ctx);
  const worker={regionWorkers:Array.from({length:3},()=>({setParameters:async()=>{},recognize:()=>new Promise((resolve,reject)=>jobs.push({resolve,reject}))}))};
  const bands=[0,32,64].map(top=>({top,width:40,height:20}));
  let complete=false;const pending=ctx.HuddleYahooClockReader.recognizeFrame(worker,source,bands).finally(()=>{complete=true;});
  for(let i=0;i<12;i++)await Promise.resolve();assert.equal(jobs.length,3);
  jobs[2].resolve({data:{text:'turn',confidence:93}});jobs[0].resolve({data:{text:'room',confidence:90}});jobs[1].resolve({data:{text:'clock',confidence:81}});
  const result=await pending;assert.equal(result.data.text,'room\nclock\nturn');assert.equal(result.data.confidence,81);assert.ok(canvases.every(c=>c.width===0));
  jobs.length=0;complete=false;const failing=ctx.HuddleYahooClockReader.recognizeFrame(worker,source,bands).finally(()=>{complete=true;});
  const rejection=assert.rejects(failing,/region failed/);for(let i=0;i<12;i++)await Promise.resolve();jobs[0].reject(Error('region failed'));
  for(let i=0;i<8;i++)await Promise.resolve();assert.equal(complete,false);
  jobs[1].resolve({data:{text:'clock',confidence:90}});jobs[2].resolve({data:{text:'turn',confidence:90}});await rejection;
  assert.ok(canvases.every(c=>c.width===0));
});


test('room crop contains the observed 84-pixel owner-transition shift in either direction',()=>{
 const data={blocks:[{paragraphs:[{lines:[line('Test room',800,166,1418,212),line('00:30',4000,82,4200,142),line('YOUR TURN • ROUND 1, PICK 2',3600,172,4400,220)]}]}]};
 const region=context.HuddleYahooClockReader.locate(data,2862,1000,'Test room').regions[0];
 for(const dx of [-84,84]){assert.ok(region.x<=400+dx);assert.ok(region.x+region.width>=709+dx);}
 assert.ok(region.y<=83&&region.y+region.height>=106);assert.ok(region.width<900);
});


test('countdown crop covers the observed 84-pixel header translation',()=>{
 const data={blocks:[{paragraphs:[{lines:[line('Test room',800,166,1418,212),line('00:30',4056,94,4260,154),line('YOUR TURN • ROUND 1, PICK 2',3600,172,4400,220)]}]}]};
 const r=context.HuddleYahooClockReader.locate(data,2862,1000,'Test room');
 assert.equal(r.clockFormat,'minutes-seconds');for(const dx of [-84,84]){assert.ok(r.regions[1].x<=2028+dx);assert.ok(r.regions[1].x+r.regions[1].width>=2130+dx);}
});
