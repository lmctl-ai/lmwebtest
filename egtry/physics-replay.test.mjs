import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {verifyRecordedRuns,digest} from './physics-replay.mjs';
const exec=promisify(execFile);
test('replay production entry rejects forged samples and provenance (explicit fixture tool)',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'physics-replay-test-')),root=path.join(dir,'content'),toolRepo=path.join(dir,'tool'),binary=path.join(toolRepo,'fixture-tool.mjs');
 try{
  await fs.mkdir(path.join(toolRepo,'examples'),{recursive:true});await fs.mkdir(path.join(root,'scripts/physics/validators'),{recursive:true});
  const source=JSON.stringify({x0:1,vx:1})+'\n';await fs.writeFile(path.join(toolRepo,'examples/fixture.json'),source);
  await fs.writeFile(binary,`#!/usr/bin/env node\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);if(a.includes('--version'))console.log('fixture-only 1');else{const p=JSON.parse(fs.readFileSync(a[a.indexOf('--input')+1]));fs.writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({samples:[0,1,2].map(t=>({t,x:p.x0+p.vx*t}))})+'\\n');}\n`);await fs.chmod(binary,0o755);
  const validator=`export const verify=({raw,input})=>[{name:'independent straight-line position',units:'m',residual:Math.max(...raw.samples.map(s=>Math.abs(s.x-input.x0-input.vx*s.t))),tolerance:1e-12}];\n`;
  await fs.writeFile(path.join(root,'scripts/physics/validators/fixture.mjs'),validator);
  await exec('git',['init','--quiet',toolRepo]);await exec('git',['-C',toolRepo,'add','.']);await exec('git',['-C',toolRepo,'-c','user.name=QA fixture','-c','user.email=qa@example.invalid','commit','--quiet','-m','Explicit non-production fixture']);
  const commit=(await exec('git',['-C',toolRepo,'rev-parse','HEAD'])).stdout.trim(),recipe={scenario:'examples/fixture.json',operation:'fixture-run',validator:'scripts/physics/validators/fixture.mjs',columns:{t:{unit:'s'},x:{unit:'m'}},maxSamples:2,runs:[{label:'v=1',overrides:{vx:1}},{label:'v=2',overrides:{vx:2}}]};
  const data={schema:'egtry-real-runs/1',tool:{name:'physim',version:'fixture-only 1',commit,binarySha256:digest(await fs.readFile(binary))},scenario:{file:recipe.scenario,sha256:digest(source),operation:recipe.operation},validator:{file:recipe.validator,sha256:digest(validator)},runs:[]};
  for(const v of recipe.runs){const input={x0:1,...v.overrides},text=JSON.stringify(input,null,2)+'\n',src=path.join(dir,'input.json'),out=path.join(dir,'out.json');await fs.writeFile(src,text);await exec(binary,[recipe.operation,'--input',src,'--output',out,'--format','json']);const bytes=await fs.readFile(out),raw=JSON.parse(bytes);data.runs.push({label:v.label,parameters:v.overrides,input,inputSha256:digest(text),rawSha256:digest(bytes),columns:recipe.columns,samples:[raw.samples[0],raw.samples[2]],checks:[{name:'independent straight-line position',units:'m',residual:0,tolerance:1e-12}],decimation:{method:'uniform-original-indices; endpoints retained; no interpolation',originalCount:3,indices:[0,2]}});}
  const options={root,toolRepo,binary};const result=await verifyRecordedRuns(data,recipe,options);assert.equal(result.status,'PASS');assert.equal(result.comparedValues,8);
  const mutations=[
   ['published value',d=>d.runs[0].samples[1].x+=.125,/Published numeric samples/],
   ['input',d=>d.runs[0].input.vx=9,/Recorded input/],
   ['sweep parameter',d=>d.runs[0].parameters.vx=9,/Visible sweep/],
   ['scenario hash',d=>d.scenario.sha256='0'.repeat(64),/Scenario hash/],
   ['binary hash',d=>d.tool.binarySha256='0'.repeat(64),/binary SHA256/],
   ['version',d=>d.tool.version='forged',/Tool version/],
   ['input hash',d=>d.runs[0].inputSha256='0'.repeat(64),/Input hash/],
   ['raw hash',d=>d.runs[0].rawSha256='0'.repeat(64),/Raw CLI output/],
   ['decimation',d=>d.runs[0].decimation.indices=[1,2],/Decimation indices/],
   ['units',d=>d.runs[0].columns.x.unit='s',/channel units/],
   ['weakened physical tolerance',d=>d.runs[0].checks[0].tolerance=100,/Physical cross-check evidence/],
   ['invalid number',d=>d.runs[0].samples[0].x=Infinity,/Nonfinite/]
  ];
  for(const [name,mutate,error] of mutations)await t.test(name,async()=>{const changed=structuredClone(data);mutate(changed);await assert.rejects(verifyRecordedRuns(changed,recipe,options),error);});
  await t.test('CLI rejects actual edited asset after a clean replay',async()=>{const asset=path.join(dir,'asset.json'),recipeFile=path.join(dir,'recipe.json'),cli=fileURLToPath(new URL('./physics-replay.mjs',import.meta.url));await fs.writeFile(recipeFile,JSON.stringify(recipe));const args=[cli,'--root',root,'--asset',asset,'--recipe',recipeFile,'--tool-repo',toolRepo,'--binary',binary];await fs.writeFile(asset,JSON.stringify(data));assert.match((await exec(process.execPath,args)).stdout,/'?PASS'?/);const changed=structuredClone(data);changed.runs[0].samples[1].x+=.125;await fs.writeFile(asset,JSON.stringify(changed));await assert.rejects(exec(process.execPath,args),e=>e.code===1&&/Published numeric samples/.test(e.stderr));});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
