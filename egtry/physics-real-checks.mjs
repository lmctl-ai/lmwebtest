import{comparisonContract,checkAnalyticSteps}from'./physics-comparison.mjs';
// R43 checks extend the basic-lesson checks; replay is mandatory, never a skipped PASS.
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {verifyRecordedRuns,verifyMutationRejected,discoverRecipe,canonical,digest} from './physics-replay.mjs';
import {canvasPixels,perceptible} from './physics-checks.mjs';
const require=(ok,message)=>{if(!ok)throw Error(message);};
const equal=(a,b,message)=>require(canonical(a)===canonical(b),message);
const fmt=n=>Number(n.toPrecision(10)).toString();
export function visibleProvenance(data,run,shown){
 const expected={scenario:data.scenario,tool:data.tool,parameters:run.input,media:run.media,parameterUnits:run.inputUnits,workflow:data.workflow,validation:run.checks,decimation:run.decimation};
 if(run.basicNormalization||Object.hasOwn(shown,'basicModel'))expected.basicModel=run.basic??data.basic;
 if(run.basicNormalization)expected.basicNormalization=run.basicNormalization;
 return expected;
}
export function referenceRows(run,basic,state){
 const axis=run.axis??{key:'t',kind:'time',unit:'s'};
 return run.samples.map(s=>({...(axis.kind==='static'?{}:{[axis.key]:s[axis.key]}),...state(basic,axis.kind==='static'?0:s[axis.key])}));
}
// A basic approximation may stop before impact or cover only some displayed quantities.
export function referenceGeometry(view,run,baseline){
 const x=view.x??'t',y=view.y,valid=s=>Number.isFinite(s[x])&&Number.isFinite(s[y]);
 const reference=!['rigid','field'].includes(view.kind)&&baseline.some(valid);
 if(!reference){if(view.compare){const all=[...run.samples,...run.samples.map(s=>({...s,[y]:s[view.compare]}))];return{view:{...view,bounds:{xmin:Math.min(...all.map(s=>s[x])),xmax:Math.max(...all.map(s=>s[x])),ymin:Math.min(...all.map(s=>s[y])),ymax:Math.max(...all.map(s=>s[y]))}},reference:false};}return {view:{...view},reference:false};}
 const all=[...run.samples,...baseline].filter(valid);
 return {view:{...view,bounds:{xmin:Math.min(...all.map(s=>s[x])),xmax:Math.max(...all.map(s=>s[x])),ymin:Math.min(...all.map(s=>s[y])),ymax:Math.max(...all.map(s=>s[y]))}},reference:true};
}
export function recordedSeekReached(run,index,attributes){
 const axis=run.axis??{key:'t',kind:'time',unit:'s'},last=run.samples.length-1;
 if(Number(index)!==last)return false;
 if(axis.kind==='static')return true;
 // Older pages store every axis in data-time; axis labels and plotted values
 // are independently checked against the declared physical coordinate.
 const value=axis.kind==='time'?attributes['data-time']:(attributes['data-coordinate']??attributes['data-time']);
 return value!==null&&value!==undefined&&value!==''&&Number(value)===run.samples[last][axis.key];
}
export async function installRealCanvasProbe(page){await page.addInitScript(()=>{
 const proto=CanvasRenderingContext2D.prototype,fill=proto.fillRect,text=proto.fillText;
 proto.fillRect=function(x,y,w,h){if(x===0&&y===0&&w>=this.canvas.width&&h>=this.canvas.height)this.canvas.__physicsQaLabels=[];return fill.apply(this,arguments);};
 proto.fillText=function(value){const labels=this.canvas.__physicsQaLabels??=[];if(labels.length<128)labels.push(String(value));return text.apply(this,arguments);};
});}
export async function realAssetBudget(root,book){
 let bytes=0,files=0;const dir=path.join(root,'content/books',book,'assets/real');
 async function walk(at){for(const e of await fs.readdir(at,{withFileTypes:true})){const file=path.join(at,e.name);require(!e.isSymbolicLink(),'Real assets must not escape through symlinks');if(e.isDirectory())await walk(file);else{require(e.isFile(),'Non-file real asset');bytes+=(await fs.stat(file)).size;files++;}}}
 await walk(dir);require(bytes<=1500000,`Real assets exceed 1,500,000-byte book budget: ${bytes}`);return {bytes,files,limit:1500000};
}
export async function assertPlot(canvas,view,samples,index,columns,geometry){
 const pixels=await canvasPixels(canvas);require(pixels.varied>20,'Real/basic plot is blank');
 const evidence=await canvas.evaluate((el,{view,samples,index,columns,geometry})=>{
  const c=el.getContext('2d'),s=samples[index],fmt=n=>Number(n.toPrecision(10)).toString(),labels=el.__physicsQaLabels??[];
  const near=(x,y,want,radius=3,tolerance=12)=>{for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const px=Math.round(x+dx),py=Math.round(y+dy);if(px<0||py<0||px>=el.width||py>=el.height)continue;const a=c.getImageData(px,py,1,1).data;if(want.some(rgb=>rgb.every((v,j)=>Math.abs(v-a[j])<tolerance)))return true;}return false;};
  if(view.kind==='field'){
   const nx=view.nx??geometry?.nx,ny=view.ny??geometry?.ny??1,values=s.field;
   if(!nx||!Array.isArray(values)||values.length!==nx*ny)return {error:'Missing field geometry/data'};if(geometry?.unit&&view.unit!==geometry.unit)return {error:'Field display units disagree with recorded data'};
   const all=samples.flatMap(s=>s.field),lo=view.min??all.reduce((a,v)=>Math.min(a,v),Infinity),hi=view.max??all.reduce((a,v)=>Math.max(a,v),-Infinity),scratch=document.createElement('canvas').getContext('2d');let tested=0;
   for(let i=0;i<values.length;i+=Math.max(1,Math.floor(values.length/32))){scratch.fillStyle=`hsl(${240-240*(values[i]-lo)/(hi-lo||1)} 65% 48%)`;scratch.fillRect(0,0,1,1);const rgb=Array.from(scratch.getImageData(0,0,1,1).data).slice(0,3),x=45+(i%nx+.5)*(el.width-70)/nx,y=45+(Math.floor(i/nx)+.5)*200/ny;if(!near(x,y,[rgb]))return {error:'Rendered field cell differs from saved data',cell:i};tested++;}
   return {kind:view.kind,tested,labels};
  }
  if(view.kind==='rigid'){
   if(!Array.isArray(s.poses)||!s.poses.length)return {error:'Rigid view has no actual recorded poses'};
   const scale=Math.min(32,el.width/12),screen=p=>[el.width/2+p[0]*scale,el.height-35-p[1]*scale];let tested=0,occluded=0;
   const covered=(x,y,i)=>s.poses.some((p,j)=>{if(j<=i)return false;const b=geometry?.[j]??{shape:'sphere',radius:.2},[cx,cy]=screen(p),a=-2*Math.atan2(p[5],p[6]),dx=x-cx,dy=y-cy,lx=Math.cos(a)*dx+Math.sin(a)*dy,ly=-Math.sin(a)*dx+Math.cos(a)*dy;return b.shape==='box'?Math.abs(lx)<=b.size[0]*scale/2+2&&Math.abs(ly)<=b.size[1]*scale/2+2:Math.hypot(dx,dy)<=b.radius*scale+2;});
   for(let i=0;i<s.poses.length;i++){
    const p=s.poses[i],b=geometry?.[i]??{shape:'sphere',radius:.2},scratch=document.createElement('canvas').getContext('2d');scratch.fillStyle=b.color??(i?'#b76638':'#668179');scratch.fillRect(0,0,1,1);const rgb=Array.from(scratch.getImageData(0,0,1,1).data).slice(0,3),[x,y]=screen(p),angle=-2*Math.atan2(p[5],p[6]),anchors=[[0,0],...(b.shape==='box'?[[ -.32,-.32],[.32,-.32],[.32,.32],[-.32,.32]].map(([u,v])=>[u*b.size[0]*scale,v*b.size[1]*scale]):[])];
    for(const [dx,dy]of anchors){const ax=x+Math.cos(angle)*dx-Math.sin(angle)*dy,ay=y+Math.sin(angle)*dx+Math.cos(angle)*dy;if(ax<=4||ax>=el.width-4||ay<=35||ay>=el.height-20)continue;if(covered(ax,ay,i)){occluded++;continue;}if(!near(ax,ay,[rgb]))return {error:'Rigid body orientation/extent or location differs from its recorded pose',body:i};tested++;}
   }
   return tested?{kind:view.kind,tested,occluded,labels}:{error:'No rigid body is visible inside the viewport'};
  }
  const xkey=view.x??'t',ykey=view.y,points=samples.filter(s=>Number.isFinite(s[xkey])&&Number.isFinite(s[ykey])),xs=points.map(s=>s[xkey]),ys=points.map(s=>s[ykey]);if(!points.length||(!view.reference&&points.length!==samples.length))return {error:'Plot channels are not finite'};
  const xmin=view.bounds?.xmin??Math.min(...xs),xmax=view.bounds?.xmax??Math.max(...xs),ymin=view.bounds?.ymin??Math.min(...ys),ymax=view.bounds?.ymax??Math.max(...ys),px=x=>60+(x-xmin)/(xmax-xmin||1)*(el.width-70),py=y=>245-(y-ymin)/(ymax-ymin||1)*190;
  if((Number.isFinite(s[xkey])&&Number.isFinite(s[ykey])||!view.reference)&&!near(px(s[xkey]),py(s[ykey]),[[177,91,34]]))return {error:'Current recorded point is not plotted at its data coordinates'};
  let tested=0;for(let i=0;i<points.length;i+=Math.max(1,Math.floor(points.length/16))){if(!near(px(xs[i]),py(ys[i]),[[33,104,149],[177,91,34]]))return {error:'Recorded curve does not pass through its saved sample',sample:i};tested++;}
  if(view.compare){for(let i=0;i<samples.length;i+=Math.max(1,Math.floor(samples.length/16)))if(!near(px(xs[i]),py(samples[i][view.compare]),[[177,91,34]]))return {error:'Recorded comparison curve differs from its saved source column',sample:i,column:view.compare};}
  for(const [k,lo,hi] of [[xkey,xmin,xmax],[ykey,ymin,ymax]])if(!labels.some(text=>text.includes(`${k} (${columns[k].unit})`)&&text.includes(fmt(lo))&&text.includes(fmt(hi))))return {error:'Plotted axis labels disagree with saved quantities/units',channel:k,labels};
  let overlay;
  if(view.overlay){let candidates=0,visible=0;for(const p of view.overlay){const x=px(p[xkey]),y=py(p[ykey]);if(!Number.isFinite(x+y))continue;let distance=Infinity;for(let i=1;i<samples.length;i++){const ax=px(samples[i-1][xkey]),ay=py(samples[i-1][ykey]),bx=px(samples[i][xkey]),by=py(samples[i][ykey]),dx=bx-ax,dy=by-ay,u=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));distance=Math.min(distance,Math.hypot(x-ax-u*dx,y-ay-u*dy));}if(distance<18)continue;candidates++;if(near(x,y,[[177,91,34]],6,48))visible++;}if(candidates&&!visible)return {error:'Basic-model dashed overlay is missing from recorded plot'};overlay={candidates,visible,indistinguishable:candidates===0};}
  return {kind:view.kind,tested,labels,overlay};
 },{view,samples,index,columns,geometry});require(!evidence.error,JSON.stringify(evidence));return {...pixels,...evidence};
}
export async function checkRealThing(model,{page,request,book,root,toolRepo,binary,lmvideoRepo,lmvideoBinary,replay,cache=new Map()}={}){
 require(root,'R43 replay requires --content-root pointing to reviewed source');
 const config=await model.evaluate(el=>JSON.parse(el.closest('.ph').querySelector('.ph-data').textContent));require(config.schema==='egtry-physics-real/1','Unknown real widget schema');require(/^real\/[-\w]+\.json$/.test(config.asset??''),'Unsafe real data asset path');
 const url=new URL('assets/'+config.asset,new URL('../',page.url()));require(url.origin===new URL(page.url()).origin,'Real asset leaves tested host');const response=await request.get(url.href);require(response.status()===200,'Real data HTTP '+response.status());const bytes=await response.body();await response.dispose();require(bytes.length<=1500000,'Single real asset exceeds book budget');const data=JSON.parse(bytes),hash=digest(bytes);require(hash===digest(await fs.readFile(path.join(root,'content/books',book,'assets',config.asset))),'Deployed real asset differs from reviewed source');
 let verified=cache.get(hash);if(!verified){verified=(async()=>{const recipe=await discoverRecipe(data,root);const options=data.tool.name==='lmvideo'?{root,toolRepo:lmvideoRepo,binary:lmvideoBinary}:{root,toolRepo,binary};const result=await verifyRecordedRuns(data,recipe,options);result.mutations=await verifyMutationRejected(data,recipe,options);return result;})();cache.set(hash,verified);}const replayEvidence=await verified,budget=await realAssetBudget(root,book);
 const select=model.locator('[data-real-run]').first(),measurement=model.locator('[data-real-measurements]').first(),footer=model.locator('.ph-real-provenance').first(),canvases=model.locator('canvas'),viewSelect=model.getByLabel('Recorded view',{exact:true}),seek=model.getByLabel('Recorded sample',{exact:true});
 require(await select.locator('option').count()===data.runs.length,'Run selector does not expose every recorded run');require(await perceptible(measurement),'Real data readout is hidden');
 if(await footer.getAttribute('open')===null)await footer.locator('summary').click();require(await perceptible(footer.locator('pre')),'Provenance footer is hidden');require(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Opened provenance footer causes horizontal overflow');
 const basicModule=await import(pathToFileURL(path.join(root,'web/physics/real/basic.js')).href);let varied=false;const signatures=[],runEvidence=[];
 for(let ri=0;ri<data.runs.length;ri++){
  await select.selectOption(String(ri));const run=data.runs[ri];const shown=JSON.parse(await footer.locator('pre').innerText());equal(shown,visibleProvenance(data,run,shown),'Visible provenance differs from recorded asset');
  if(run.media){
   const video=model.getByLabel('Recorded lmvideo clip',{exact:true});require(await perceptible(video),'Recorded clip is hidden');
   const mediaBase=new URL('../',url);require(await video.getAttribute('src')===new URL(run.media.clip,mediaBase).href,'Clip selector does not match recorded run');require(await video.getAttribute('poster')===new URL(run.media.poster,mediaBase).href,'Poster selector does not match recorded run');
   await video.evaluate(v=>new Promise((resolve,reject)=>{if(v.readyState>=2)return resolve();v.addEventListener('loadeddata',resolve,{once:true});v.addEventListener('error',()=>reject(Error('Recorded clip failed to decode')),{once:true});v.load();}));
   const meta=await video.evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));require(meta.width>0&&meta.height>0&&Math.abs(meta.duration-run.media.playbackDurationS)<.1,'Decoded clip disagrees with replay duration');
  }
  const comparison=comparisonContract(config,!!(run.basic??data.basic));const baseline=comparison==='overlay'?referenceRows(run,run.basic??data.basic,basicModule.basicState):[];
  const axis=run.axis??{key:'t',kind:'time',unit:'s'},last=run.samples.length-1;await seek.press('End');require(recordedSeekReached(run,await seek.inputValue(),{'data-time':await model.getAttribute('data-time'),'data-coordinate':await model.getAttribute('data-coordinate')}),'Seek did not reach the recorded coordinate');
  if(axis.kind!=='time')require(await model.locator('[data-action=play]').isHidden(),'A non-time scan must not expose physical-time Play');
  const text=await measurement.innerText();for(const [key,meta]of Object.entries(run.columns))require(text.includes(`${key} = ${fmt(run.samples[last][key])} ${meta.unit}`),'Readout differs from saved sample: '+key);
  const signature=canonical(run.samples.map(({t,...values})=>values));if(signatures.length&&signature!==signatures[0])varied=true;signatures.push(signature);
  const plots=[];let comparisons=0;const expectedView=v=>{const g=referenceGeometry(v,run,baseline);if(g.reference){const x=v.x??'t',y=v.y;g.view.overlay=baseline.filter(s=>Number.isFinite(s[x])&&Number.isFinite(s[y]));}return g.view;};
  for(let vi=0;vi<config.views.length;vi++){
   await viewSelect.selectOption(String(vi));const geometry=referenceGeometry(config.views[vi],run,baseline),view=expectedView(config.views[vi]),recorded=await assertPlot(canvases.nth(0),view,run.samples,last,run.columns,run.bodies??run.field);let basic;
   if(geometry.reference){basic=await assertPlot(canvases.nth(1),{...view,reference:true},baseline,last,run.columns,run.field);comparisons++;}
   else require(await canvases.nth(1).isHidden(),'A view without a comparable basic quantity must hide its baseline');
   plots.push({recorded,basic});
  }
  if(comparison==='overlay')require(comparisons>0,'Missing visible basic-model comparison view');else require(await canvases.nth(1).isHidden(),'An analytic-only comparison must not show an unverified baseline canvas');
  await viewSelect.selectOption('0');await model.locator('[data-action=reset]').click();
  if(axis.kind==='time'&&run.samples.length>1){const play=model.locator('[data-action=play]');await play.click();await page.waitForFunction(([el,t])=>Number(el.dataset.time)>t||el.dataset.playing==='false',[await model.elementHandle(),run.samples[0].t],{timeout:4000});require(Number(await model.getAttribute('data-time'))>run.samples[0].t,'Play never advances stored data; adjust the replay time scale');if(await model.getAttribute('data-playing')==='true')await play.click();const currentIndex=Number(await seek.inputValue());await assertPlot(canvases.first(),expectedView(config.views[0]),run.samples,currentIndex,run.columns,run.bodies??run.field);const before=await canvasPixels(canvases.first());await page.waitForTimeout(150);require((await canvasPixels(canvases.first())).hash===before.hash,'Paused recorded data keeps animating');await seek.press('Home');await model.locator('[data-action=step]').first().click();require(Number(await seek.inputValue())===1,'Step does not advance exactly one stored sample');}
  const steps=await replay(model);if(comparison==='analytic')checkAnalyticSteps(config,steps);require(steps.length>=3,'Missing worked basic/real comparison');runEvidence.push({label:run.label,comparison,analyticComparison:comparison==='analytic'?config.analyticComparison:undefined,plots,steps,axis,seek:true,playPauseStep:axis.kind==='time'&&run.samples.length>1});
 }
 if(data.runs.length>1)require(varied,'Recorded run switching does not change physical values');else require(data.runs[0].samples.length>1||config.views.length>1,'A single stationary run has no meaningful interaction');
 return {asset:url.pathname,assetSha256:hash,budget,replay:replayEvidence,runs:runEvidence,hasExercise:!!config.exercise,qualitativeReason:config.noExerciseReason??null};
}
