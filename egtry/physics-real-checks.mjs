// R43 checks extend the basic-lesson checks; replay is mandatory, never a skipped PASS.
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {verifyRecordedRuns,verifyMutationRejected,discoverRecipe,canonical,digest} from './physics-replay.mjs';
import {canvasPixels,perceptible} from './physics-checks.mjs';
const require=(ok,message)=>{if(!ok)throw Error(message);};
const equal=(a,b,message)=>require(canonical(a)===canonical(b),message);
const fmt=n=>Number(n.toPrecision(10)).toString();
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
async function assertPlot(canvas,view,samples,index,columns,geometry){
 const pixels=await canvasPixels(canvas);require(pixels.varied>20,'Real/basic plot is blank');
 const evidence=await canvas.evaluate((el,{view,samples,index,columns,geometry})=>{
  const c=el.getContext('2d'),s=samples[index],fmt=n=>Number(n.toPrecision(10)).toString(),labels=el.__physicsQaLabels??[];
  const near=(x,y,want)=>{for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const px=Math.round(x+dx),py=Math.round(y+dy);if(px<0||py<0||px>=el.width||py>=el.height)continue;const a=c.getImageData(px,py,1,1).data;if(want.some(rgb=>rgb.every((v,j)=>Math.abs(v-a[j])<12)))return true;}return false;};
  if(view.kind==='field'){
   const nx=view.nx??geometry?.nx,ny=view.ny??geometry?.ny??1,values=s.field;
   if(!nx||!Array.isArray(values)||values.length!==nx*ny)return {error:'Missing field geometry/data'};
   const all=samples.flatMap(s=>s.field),lo=view.min??Math.min(...all),hi=view.max??Math.max(...all),scratch=document.createElement('canvas').getContext('2d');let tested=0;
   for(let i=0;i<values.length;i+=Math.max(1,Math.floor(values.length/32))){scratch.fillStyle=`hsl(${240-240*(values[i]-lo)/(hi-lo||1)} 65% 48%)`;scratch.fillRect(0,0,1,1);const rgb=Array.from(scratch.getImageData(0,0,1,1).data).slice(0,3),x=45+(i%nx+.5)*(el.width-70)/nx,y=45+(Math.floor(i/nx)+.5)*200/ny;if(!near(x,y,[rgb]))return {error:'Rendered field cell differs from saved data',cell:i};tested++;}
   return {kind:view.kind,tested,labels};
  }
  if(view.kind==='rigid'){
   if(!Array.isArray(s.poses)||!s.poses.length)return {error:'Rigid view has no actual recorded poses'};
   let tested=0;for(let i=0;i<s.poses.length;i++){const p=s.poses[i],b=geometry?.[i]??{shape:'sphere',radius:.2},scratch=document.createElement('canvas').getContext('2d');scratch.fillStyle=b.color??(i?'#b76638':'#668179');scratch.fillRect(0,0,1,1);const rgb=Array.from(scratch.getImageData(0,0,1,1).data).slice(0,3),x=el.width/2+p[0]*Math.min(32,el.width/12),y=el.height-35-p[1]*Math.min(32,el.width/12);if(x>4&&x<el.width-4&&y>35&&y<el.height-20){if(!near(x,y,[rgb]))return {error:'Rigid pose is not rendered at its recorded location',body:i};tested++;}}
   return tested?{kind:view.kind,tested,labels}:{error:'No rigid body is visible inside the viewport'};
  }
  const xkey=view.x??'t',ykey=view.y,xs=samples.map(s=>s[xkey]),ys=samples.map(s=>s[ykey]);if(!xs.every(Number.isFinite)||!ys.every(Number.isFinite))return {error:'Plot channels are not finite'};
  const xmin=view.bounds?.xmin??Math.min(...xs),xmax=view.bounds?.xmax??Math.max(...xs),ymin=view.bounds?.ymin??Math.min(...ys),ymax=view.bounds?.ymax??Math.max(...ys),px=x=>60+(x-xmin)/(xmax-xmin||1)*(el.width-70),py=y=>245-(y-ymin)/(ymax-ymin||1)*190;
  if(!near(px(s[xkey]),py(s[ykey]),[[177,91,34]]))return {error:'Current recorded point is not plotted at its data coordinates'};
  let tested=0;for(let i=0;i<samples.length;i+=Math.max(1,Math.floor(samples.length/16))){if(!near(px(xs[i]),py(ys[i]),[[33,104,149],[177,91,34]]))return {error:'Recorded curve does not pass through its saved sample',sample:i};tested++;}
  for(const [k,lo,hi] of [[xkey,xmin,xmax],[ykey,ymin,ymax]])if(!labels.some(text=>text.includes(`${k} (${columns[k].unit})`)&&text.includes(fmt(lo))&&text.includes(fmt(hi))))return {error:'Plotted axis labels disagree with saved quantities/units',channel:k,labels};
  return {kind:view.kind,tested,labels};
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
  await select.selectOption(String(ri));const run=data.runs[ri];equal(JSON.parse(await footer.locator('pre').innerText()),{scenario:data.scenario,tool:data.tool,parameters:run.input,validation:run.checks,decimation:run.decimation},'Visible provenance differs from recorded asset');
  require(run.basic??data.basic,'Missing basic-model overlay');const baseline=run.samples.map(s=>({t:s.t,...basicModule.basicState(run.basic??data.basic,s.t)}));
  const axis=run.axis??{key:'t',kind:'time',unit:'s'},last=run.samples.length-1;await seek.press('End');require(Number(await model.getAttribute('data-time'))===run.samples[last][axis.key],'Seek did not reach the recorded time');
  const text=await measurement.innerText();for(const [key,meta]of Object.entries(run.columns))require(text.includes(`${key} = ${fmt(run.samples[last][key])} ${meta.unit}`),'Readout differs from saved sample: '+key);
  const signature=canonical(run.samples.map(({t,...values})=>values));if(signatures.length&&signature!==signatures[0])varied=true;signatures.push(signature);
  const plots=[];let comparisons=0;const expectedView=v=>{const view={...v};if(!['rigid','field'].includes(view.kind)){const all=[...run.samples,...baseline],x=view.x??'t',y=view.y;view.bounds={xmin:Math.min(...all.map(s=>s[x])),xmax:Math.max(...all.map(s=>s[x])),ymin:Math.min(...all.map(s=>s[y])),ymax:Math.max(...all.map(s=>s[y]))};}return view;};for(let vi=0;vi<config.views.length;vi++){await viewSelect.selectOption(String(vi));const view=expectedView(config.views[vi]),recorded=await assertPlot(canvases.nth(0),view,run.samples,last,run.columns,run.bodies??run.field);let basic;if(view.kind!=='rigid'){basic=await assertPlot(canvases.nth(1),view,baseline,last,run.columns,run.field);comparisons++;}plots.push({recorded,basic});}require(comparisons>0,'Missing visible basic-model comparison view');
  await viewSelect.selectOption('0');await model.locator('[data-action=reset]').click();
  if(axis.kind==='time'&&run.samples.length>1){const play=model.locator('[data-action=play]');await play.click();await page.waitForFunction(([el,t])=>Number(el.dataset.time)>t||el.dataset.playing==='false',[await model.elementHandle(),run.samples[0].t],{timeout:4000});require(Number(await model.getAttribute('data-time'))>run.samples[0].t,'Play never advances stored data; adjust the replay time scale');if(await model.getAttribute('data-playing')==='true')await play.click();const currentIndex=Number(await seek.inputValue());await assertPlot(canvases.first(),expectedView(config.views[0]),run.samples,currentIndex,run.columns,run.bodies??run.field);const before=await canvasPixels(canvases.first());await page.waitForTimeout(150);require((await canvasPixels(canvases.first())).hash===before.hash,'Paused recorded data keeps animating');await seek.press('Home');await model.locator('[data-action=step]').first().click();require(Number(await seek.inputValue())===1,'Step does not advance exactly one stored sample');}
  const steps=await replay(model);require(steps.length>=3,'Missing worked basic/real comparison');runEvidence.push({label:run.label,plots,steps,axis,seek:true,playPauseStep:axis.kind==='time'&&run.samples.length>1});
 }
 if(data.runs.length>1)require(varied,'Recorded run switching does not change physical values');else require(data.runs[0].samples.length>1||config.views.length>1,'A single stationary run has no meaningful interaction');
 return {asset:url.pathname,assetSha256:hash,budget,replay:replayEvidence,runs:runEvidence,hasExercise:!!config.exercise,qualitativeReason:config.noExerciseReason??null};
}
