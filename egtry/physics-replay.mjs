#!/usr/bin/env node
// Independently replay published numeric data; never call the authoring exporter.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const exec=promisify(execFile),rawCache=new Map();
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const require=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b,label)=>require(canonical(a)===canonical(b),label+' differs from independent replay');
export function channel(value,key){require(typeof key==='string'&&/^[\w.-]+$/.test(key)&&!key.split('.').some(k=>['__proto__','constructor','prototype'].includes(k)),'Invalid source channel');return key.split('.').reduce((v,k)=>v?.[k],value);}
export async function contained(root,name){require(typeof name==='string'&&!path.isAbsolute(name)&&!name.split(/[\\/]/).includes('..'),'Unsafe source path');const base=await fs.realpath(root),file=await fs.realpath(path.resolve(base,name));require(file.startsWith(base+path.sep),'Source path leaves reviewed repository');return file;}
export function finiteTree(value,label='value'){if(typeof value==='number')require(Number.isFinite(value),'Nonfinite '+label);else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))finiteTree(v,label+'.'+k);}
export function decimationIndices(count,maximum=161){require(Number.isInteger(count)&&count>=2,'Raw output needs at least two samples');require(Number.isInteger(maximum)&&maximum>=2&&maximum<=512,'maxSamples must be 2..512');const n=Math.min(count,maximum);return Array.from({length:n},(_,i)=>Math.floor(i*(count-1)/(n-1)+.5));}
export async function verifyRecordedRuns(data,recipe,{root,toolRepo=path.join(os.homedir(),'repos/lmctlhq/physim'),binary=process.env.PHYSIM_BIN??path.join(toolRepo,'target/release/physim')}={}){
 require(root,'Supply reviewed content repository root');require(data?.schema==='egtry-real-runs/1','Unknown real-run schema');require(data.tool?.name==='physim','No replay adapter for '+data.tool?.name+'; cannot claim verified data');
 require(/^[a-z][a-z0-9-]+$/.test(recipe.operation??''),'Invalid physim operation');same(data.scenario?.operation,recipe.operation,'Operation');same(data.scenario?.file,recipe.scenario,'Scenario file');
 const scenario=await contained(toolRepo,recipe.scenario),source=await fs.readFile(scenario);same(digest(source),data.scenario.sha256,'Scenario hash');const base=JSON.parse(source);
 const bytes=await fs.readFile(binary);same(digest(bytes),data.tool.binarySha256,'Tool binary SHA256');const {stdout:version}=await exec(binary,['--version'],{timeout:10000,maxBuffer:1024*1024});same(version.trim(),data.tool.version,'Tool version');
 const {stdout:revision}=await exec('git',['-C',toolRepo,'rev-parse','HEAD']);same(revision.trim(),data.tool.commit,'Tool source commit');
 const {stdout:dirty}=await exec('git',['-C',toolRepo,'status','--porcelain','--untracked-files=no']);require(!dirty.trim(),'Tool source has uncommitted tracked changes');
 require(/^scripts\/physics\/(?:validators|r43)\/.+\.mjs$/.test(recipe.validator??''),'Validator must be reviewed physics source');const validatorPath=await contained(root,recipe.validator),validatorBytes=await fs.readFile(validatorPath);same(data.validator?.file,recipe.validator,'Validator file');same(digest(validatorBytes),data.validator?.sha256,'Validator source SHA256');const validatorURL=pathToFileURL(validatorPath);validatorURL.searchParams.set('sha256',digest(validatorBytes));const validator=await import(validatorURL.href);require(typeof validator.verify==='function','Missing independent physical validator');
 require(Array.isArray(recipe.runs)&&recipe.runs.length===data.runs?.length&&data.runs.length>0,'Run grid differs from recipe');let compared=0;const runs=[];
 for(let n=0;n<data.runs.length;n++){
  const run=data.runs[n],variant=recipe.runs[n],input={...base,...recipe.overrides,...variant.overrides},text=JSON.stringify(input,null,2)+'\n';finiteTree(run);same(run.input,input,'Recorded input');same(run.parameters,variant.overrides??{},'Visible sweep parameters');same(run.label,variant.label,'Run label');same(run.inputSha256,digest(text),'Input hash');
  const key=[data.tool.binarySha256,recipe.operation,digest(text)].join(':');let rawBytes=rawCache.get(key);
  if(!rawBytes){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'physics-qa-replay-'));try{const src=path.join(dir,'input.json'),out=path.join(dir,'output.json');await fs.writeFile(src,text);await exec(binary,[recipe.operation,'--input',src,'--output',out,'--format','json'],{timeout:120000,maxBuffer:1024*1024});require((await fs.stat(out)).size<=128*1024*1024,'Raw replay output exceeds 128 MiB');rawBytes=await fs.readFile(out);rawCache.set(key,rawBytes);}finally{await fs.rm(dir,{recursive:true,force:true});}}
  same(run.rawSha256,digest(rawBytes),'Raw CLI output SHA256');const raw=JSON.parse(rawBytes),rows=channel(raw,recipe.samplePath??'samples');require(Array.isArray(rows),'Missing source sample array');const indices=decimationIndices(rows.length,recipe.maxSamples??161);same(run.decimation?.indices,indices,'Decimation indices');same(run.decimation?.originalCount,rows.length,'Original sample count');same(run.decimation?.method,'uniform-original-indices; endpoints retained; no interpolation','Decimation method');
  const columns=Object.fromEntries(Object.entries(recipe.columns).map(([k,v])=>[k,{unit:v.unit}]));same(run.columns,columns,'Published channel units');
  const samples=indices.map(i=>{const s={};for(const [k,v]of Object.entries(recipe.columns)){s[k]=channel(rows[i],v.source??k);require(Number.isFinite(s[k]),'Source channel is not a finite scalar: '+k);}if(recipe.field)s.field=channel(rows[i],recipe.field.source).flat(Infinity);return s;});finiteTree(samples);same(run.samples,samples,'Published numeric samples');compared+=samples.reduce((s,row)=>s+Object.values(row).reduce((n,v)=>n+(Array.isArray(v)?v.length:1),0),0);
  same(run.basic??null,variant.basic??recipe.basic??null,'Basic-model overlay');same(run.field??null,recipe.field?Object.fromEntries(Object.entries(recipe.field).filter(([k])=>k!=='source')):null,'Field geometry');
  const checks=await validator.verify({raw,input,samples,variant});require(Array.isArray(checks)&&checks.length>0,'Missing analytic/conservation/built-in cross-check');finiteTree(checks);for(const c of checks)require(c.name&&c.units&&c.tolerance>0&&Math.abs(c.residual)<=c.tolerance,'Independent physical check failed: '+c.name);same(run.checks,checks,'Physical cross-check evidence');runs.push({label:run.label,inputSha256:run.inputSha256,rawSha256:digest(rawBytes),samples:samples.length,checks});
 }
 same(digest(await fs.readFile(binary)),data.tool.binarySha256,'Tool binary after replay');
 return {status:'PASS',scope:'Independent tool replay and declared physical-check verification; human scientific review still required',tool:data.tool,scenario:data.scenario,runs,comparedValues:compared};
}
export async function discoverRecipe(data,root){
 if(data.recipe?.file){const file=await contained(root,data.recipe.file);same(digest(await fs.readFile(file)),data.recipe.sha256,'Recipe SHA256');return JSON.parse(await fs.readFile(file,'utf8'));}
 const candidates=[];async function walk(dir){let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name.endsWith('.json')){try{const r=JSON.parse(await fs.readFile(p,'utf8'));if(r.operation===data.scenario.operation&&r.scenario===data.scenario.file&&r.runs?.length===data.runs.length&&r.runs.every((v,i)=>canonical(v.overrides??{})===canonical(data.runs[i].parameters)))candidates.push(r);}catch{}}}}
 await walk(path.join(root,'scripts/physics/scenarios'));await walk(path.join(root,'scripts/physics/r43'));require(candidates.length===1,`Need an explicit recipe binding or exactly one matching reviewed recipe; found ${candidates.length}`);return candidates[0];
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const arg=k=>{const i=process.argv.indexOf('--'+k);return i<0?undefined:process.argv[i+1];},root=arg('root');require(root&&arg('asset'),'Use --root REPO --asset FILE [--recipe FILE] [--tool-repo DIR] [--binary FILE] [--out FILE]');const data=JSON.parse(await fs.readFile(arg('asset'),'utf8')),recipe=arg('recipe')?JSON.parse(await fs.readFile(arg('recipe'),'utf8')):await discoverRecipe(data,root),result=await verifyRecordedRuns(data,recipe,{root,toolRepo:arg('tool-repo'),binary:arg('binary')});if(arg('out'))await fs.writeFile(arg('out'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}catch(e){console.error(e.stack??e);process.exitCode=1;}
}
