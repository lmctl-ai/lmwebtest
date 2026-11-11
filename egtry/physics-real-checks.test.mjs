import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import {chromium} from 'playwright';
import {makeReplayFixture} from './fixtures/replay-fixture.mjs';import {checkRealThing,installRealCanvasProbe,realAssetBudget} from './physics-real-checks.mjs';import {workedReplay} from './physics-checks.mjs';
// An explicit rendering/replay fixture, never a lesson or evidence about physim.
function fixtureClient(){
 const broken=new URL(location.href).searchParams.get('broken');
 const dataPromise=fetch('../assets/real/run.json').then(r=>r.json());
 dataPromise.then(data=>{
 const root=document.querySelector('[data-real-thing]'),select=root.querySelector('select[data-real-run]'),views=root.querySelector('[aria-label="Recorded view"]'),seek=root.querySelector('input[type=range]'),play=root.querySelector('[data-action=play]'),measure=root.querySelector('[data-real-measurements]'),footer=root.querySelector('details'),board=root.querySelector('.mb-player');let ri=0,index=0,playing=false,clock=0,last=0,raf;
 data.runs.forEach((r,i)=>select.add(new Option(r.label,String(i))));
 function paint(canvas,samples,current,bounds,overlay){canvas.width=800;canvas.height=300;const c=canvas.getContext('2d'),xs=samples.map(s=>s.t),ys=samples.map(s=>s.x),xmin=bounds?.xmin??Math.min(...xs),xmax=bounds?.xmax??Math.max(...xs),ymin=bounds?.ymin??Math.min(...ys),ymax=bounds?.ymax??Math.max(...ys),px=x=>60+(x-xmin)/(xmax-xmin||1)*730,py=y=>245-(y-ymin)/(ymax-ymin||1)*190;c.fillStyle='#eef4f1';c.fillRect(0,0,800,300);c.fillStyle='#213c36';c.fillText('Fixture',14,22);c.fillText(`t (s): ${xmin} … ${xmax}`,60,285);c.fillText(`x (m): ${ymin} … ${broken==='axis'?ymax*2:ymax}`,60,43);if(overlay&&broken!=='dashed-overlay'){c.lineWidth=2;c.strokeStyle='#b15b22';c.setLineDash([6,4]);c.beginPath();overlay.forEach((s,i)=>i?c.lineTo(px(s.t),py(s.x)):c.moveTo(px(s.t),py(s.x)));c.stroke();c.setLineDash([]);}c.strokeStyle='#216895';c.lineWidth=2;c.beginPath();samples.forEach((s,i)=>i?c.lineTo(px(s.t),py(s.x)):c.moveTo(px(s.t),py(s.x)));c.stroke();const s=samples[broken==='frozen'?0:current];c.fillStyle='#b15b22';c.beginPath();c.arc(px(s.t),py(s.x),6,0,Math.PI*2);c.fill();}
 function boardLoad(){let count=1;const rows=board.querySelector('ol'),step=board.querySelector('button');function render(){rows.innerHTML=Array.from({length:count},(_,i)=>`<li class="bb-step"><div class="bb-line">${['x = x0 + v t','1 + 2 × 2 = 5 m','basic = 1 + 1 × 2 = 3 m','difference = 5 − 3 = 2 m'][i]}</div><p class="bb-note">Compare the recorded quantity with the simple law.</p></li>`).join('');step.disabled=count===4;}step.onclick=()=>{count++;render();};render();}
 function draw(){const r=data.runs[ri],s=r.samples[index];root.dataset.time=s.t;root.dataset.playing=playing;root.dataset.realRun=ri;seek.max=r.samples.length-1;seek.value=index;play.textContent=playing?'Pause':'Play';measure.textContent=`t = ${s.t} s · x = ${s.x} m`;const canvases=root.querySelectorAll('canvas');const basic=r.samples.map(s=>({t:s.t,x:1+s.t})),all=[...r.samples,...basic],bounds={xmin:Math.min(...all.map(s=>s.t)),xmax:Math.max(...all.map(s=>s.t)),ymin:Math.min(...all.map(s=>s.x)),ymax:Math.max(...all.map(s=>s.x))};paint(canvases[0],r.samples,index,bounds,basic);paint(canvases[1],basic,index,bounds);}
 function stop(){playing=false;cancelAnimationFrame(raf);last=0;}
 function load(){stop();index=0;const r=data.runs[ri],p={scenario:data.scenario,tool:data.tool,parameters:r.input,validation:r.checks,decimation:r.decimation};if(broken==='footer')p.tool={...p.tool,version:'forged'};footer.querySelector('pre').textContent=JSON.stringify(p,null,2);boardLoad();draw();}
 select.onchange=()=>{ri=+select.value;load();};views.onchange=draw;
 seek.oninput=()=>{stop();if(broken!=='seek')index=+seek.value;draw();};
 play.onclick=()=>{if(playing)stop();else{if(index===data.runs[ri].samples.length-1)index=0;clock=data.runs[ri].samples[index].t;playing=true;last=0;raf=requestAnimationFrame(tick);}draw();};
 function tick(t){if(!playing)return;if(last)clock+=(t-last)/1000;last=t;const r=data.runs[ri];while(index<r.samples.length-1&&r.samples[index+1].t<=clock)index++;if(index===r.samples.length-1)stop();draw();if(playing)raf=requestAnimationFrame(tick);}
 root.querySelector('[data-action=reset]').onclick=()=>{stop();index=0;draw();};root.querySelector('[data-action=step]').onclick=()=>{stop();if(broken!=='step')index=Math.min(index+1,data.runs[ri].samples.length-1);draw();};
 if(broken==='overlay')root.querySelectorAll('canvas')[1].hidden=true;if(broken==='hidden-footer')footer.hidden=true;if(broken==='footer-overflow')footer.querySelector('pre').style.whiteSpace='pre';load();
 });
}
const html=broken=>`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{max-width:800px;margin:auto;padding:8px}canvas{width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}select{max-width:100%}</style></head><body><h1>Recorded fixture</h1><section class="ph"><script class="ph-data" type="application/json">${JSON.stringify({schema:'egtry-physics-real/1',asset:'real/run.json',views:[{kind:'series',x:'t',y:'x'}]})}</script><div data-real-thing><select data-real-run></select><select aria-label="Recorded view"><option value="0">series</option></select><button data-action="play">Play</button><button data-action="step">Step</button><button data-action="reset">Reset</button><input type="range" min="0" max="1" step="1" aria-label="Recorded sample"><canvas></canvas><canvas></canvas><output data-real-measurements></output><div class="mb-player"><button>Step</button><ol></ol></div><details class="ph-real-provenance"><summary>Provenance</summary><pre></pre></details></div></section><script>(${fixtureClient.toString()})()</script></body></html>`;
test('real assets enforce the whole-book size budget and reject escaping symlinks',async()=>{const root=await fs.mkdtemp('/tmp/real-budget-');try{const dir=path.join(root,'content/books/fixture/assets/real');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'trace.json'),Buffer.alloc(1500000));assert.equal((await realAssetBudget(root,'fixture')).bytes,1500000);await fs.writeFile(path.join(dir,'extra'),'.');await assert.rejects(realAssetBudget(root,'fixture'),/budget/);await fs.rm(path.join(dir,'extra'));await fs.symlink('/etc/hostname',path.join(dir,'escape'));await assert.rejects(realAssetBudget(root,'fixture'),/symlink/);}finally{await fs.rm(root,{recursive:true,force:true});}});
test('recorded renderer checks data coordinates, footer, overlay, controls and mutations',async()=>{
 const f=await makeReplayFixture({basic:{model:'fixture-linear',parameters:{},channels:{x:'x'}}}),assetDir=path.join(f.root,'content/books/fixture/assets/real');await fs.mkdir(assetDir,{recursive:true});await fs.writeFile(path.join(assetDir,'run.json'),JSON.stringify(f.data));await fs.mkdir(path.join(f.root,'scripts/physics/scenarios'),{recursive:true});await fs.writeFile(path.join(f.root,'scripts/physics/scenarios/fixture.json'),JSON.stringify(f.recipe));await fs.writeFile(path.join(f.root,'package.json'),'"placeholder"');let served=f.data;
 const server=http.createServer((req,res)=>{if(new URL(req.url,'http://local').pathname.endsWith('run.json')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(served));}else{res.writeHead(200,{'Content-Type':'text/html'});res.end(html());}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{await fs.writeFile(path.join(f.root,'package.json'),'{"type":"module"}');browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});const cache=new Map();
  async function run(broken,width=390){const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(2000);await installRealCanvasProbe(page);try{await page.goto(`http://127.0.0.1:${server.address().port}/fixture/lesson/?broken=${broken}`,{waitUntil:'networkidle'});await page.locator('[data-real-run] option').first().waitFor({state:'attached'});return await checkRealThing(page.locator('[data-real-thing]'),{page,request:page.request,book:'fixture',root:f.root,toolRepo:f.toolRepo,binary:f.binary,replay:workedReplay,cache});}finally{await page.close();}}
  for(const width of [1280,390]){const result=await run('',width);assert.equal(result.runs.length,2);assert.equal(result.replay.status,'PASS');}
  for(const [mode,reason] of [['footer',/provenance differs/],['hidden-footer',/Timeout|hidden/],['dashed-overlay',/dashed overlay/],['overlay',/hidden/],['frozen',/not plotted/],['axis',/axis labels/],['seek',/Seek did not/],['step',/Step does not/],['footer-overflow',/overflow/]])await assert.rejects(run(mode),reason,mode);
  served=structuredClone(f.data);served.runs[0].samples[1].x+=.125;await assert.rejects(run(''),/Deployed real asset/);await fs.writeFile(path.join(assetDir,'run.json'),JSON.stringify(served));await assert.rejects(run(''),/Published numeric samples/);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.dispose();}
});

test('field pixels and oriented rigid bodies are checked against saved values',async()=>{
 const {assertPlot}=await import('./physics-real-checks.mjs'),browser=await chromium.launch();try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:900}});await page.setContent('<canvas width="800" height="300" style="width:100%;height:auto"></canvas>');const canvas=page.locator('canvas');
   const field=[0,1,2,3],samples=[{field}];
   await canvas.evaluate((el,values)=>{const c=el.getContext('2d');c.fillStyle='#eef4f1';c.fillRect(0,0,800,300);values.forEach((v,i)=>{c.fillStyle=`hsl(${240-240*v/3} 65% 48%)`;c.fillRect(45+(i%2)*730/2,45+Math.floor(i/2)*100,365,100);});},field);
   assert.equal((await assertPlot(canvas,{kind:'field',unit:'m'},samples,0,{}, {nx:2,ny:2})).tested,4);
   await canvas.evaluate(el=>{const c=el.getContext('2d');c.fillStyle='red';c.fillRect(45,45,365,100);});await assert.rejects(assertPlot(canvas,{kind:'field',unit:'m'},samples,0,{}, {nx:2,ny:2}),/Rendered field cell/);
   const angle=Math.PI/4,poses=[[0,2,0,0,0,Math.sin(angle/2),Math.cos(angle/2)]],bodies=[{shape:'box',size:[4,.7,1]}],draw=async a=>canvas.evaluate((el,a)=>{const c=el.getContext('2d');c.fillStyle='#eef4f1';c.fillRect(0,0,800,300);c.save();c.translate(400,201);c.rotate(-a);c.fillStyle='#668179';c.fillRect(-64,-11.2,128,22.4);c.restore();},a);
   await draw(angle);assert.ok((await assertPlot(canvas,{kind:'rigid'},[{poses}],0,{},bodies)).tested>=5);await draw(0);await assert.rejects(assertPlot(canvas,{kind:'rigid'},[{poses}],0,{},bodies),/orientation\/extent/);await page.close();
  }
 }finally{await browser.close();}
});

test('native comparison pixels follow their recorded source column at both widths',async()=>{
 const {assertPlot}=await import('./physics-real-checks.mjs'),browser=await chromium.launch();
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:900}});await installRealCanvasProbe(page);
   await page.goto('data:text/html,'+encodeURIComponent('<canvas width="800" height="300" style="width:100%;max-width:800px"></canvas>'));
   const canvas=page.locator('canvas'),samples=[{t:0,x:1,truth:-1},{t:1,x:2,truth:-.5},{t:2,x:3,truth:0}],view={kind:'series',x:'t',y:'x',compare:'truth',bounds:{xmin:0,xmax:2,ymin:-1,ymax:3}},columns={t:{unit:'s'},x:{unit:'m'},truth:{unit:'m'}};
   const draw=async shift=>canvas.evaluate((el,{samples,shift})=>{
    const c=el.getContext('2d'),px=t=>60+t/2*730,py=v=>245-(v+1)/4*190;
    c.fillStyle='#eef4f1';c.fillRect(0,0,800,300);c.fillStyle='#213c36';c.fillText('t (s): 0 … 2',60,285);c.fillText('x (m): -1 … 3',60,43);
    for(const [key,color,offset]of[['truth','#7b4c9a',shift],['x','#216895',0]]){c.lineWidth=2;c.strokeStyle=color;c.beginPath();samples.forEach((s,i)=>i?c.lineTo(px(s.t),py(s[key]+offset)):c.moveTo(px(s.t),py(s[key]+offset)));c.stroke();}
    c.fillStyle='#b15b22';c.beginPath();c.arc(px(2),py(3),6,0,Math.PI*2);c.fill();
   },{samples,shift});
   await draw(0);assert.equal((await assertPlot(canvas,view,samples,2,columns)).tested,3);
   await draw(.5);await assert.rejects(assertPlot(canvas,view,samples,2,columns),/Recorded comparison curve/);
   await page.close();
  }
 }finally{await browser.close();}
});
