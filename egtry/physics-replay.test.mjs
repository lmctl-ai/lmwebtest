import {makeReplayFixture} from './fixtures/replay-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {verifyRecordedRuns,digest} from './physics-replay.mjs';
const exec=promisify(execFile);
test('replay production entry rejects forged samples and provenance (explicit fixture tool)',async t=>{
 const fixture=await makeReplayFixture(),{dir,root,toolRepo,binary,data,recipe}=fixture;
 try{
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
  await t.test('disabling numeric comparisons cannot produce a replay PASS',async()=>{const original=fileURLToPath(new URL('./physics-replay.mjs',import.meta.url)),code=await fs.readFile(original,'utf8'),broken=path.join(dir,'broken-replay.mjs'),asset=path.join(dir,'trap-asset.json'),plan=path.join(dir,'trap-recipe.json');const changed=code.replace("same(run.samples,samples,'Published numeric samples');",'').replace("if(run.samplesSha256)same(run.samplesSha256,digest(JSON.stringify(samples)),'Published samples hash');",'');assert.notEqual(changed,code);await fs.writeFile(broken,changed);await fs.writeFile(asset,JSON.stringify(data));await fs.writeFile(plan,JSON.stringify(recipe));const args=[broken,'--root',root,'--asset',asset,'--recipe',plan,'--tool-repo',toolRepo,'--binary',binary];assert.match((await exec(process.execPath,args)).stdout,/PASS/);await assert.rejects(exec(process.execPath,[...args,'--mutation-check']),e=>e.code===1&&/Numeric mutation was accepted/.test(e.stderr));});
  await t.test('CLI rejects actual edited asset after a clean replay',async()=>{const asset=path.join(dir,'asset.json'),recipeFile=path.join(dir,'recipe.json'),cli=fileURLToPath(new URL('./physics-replay.mjs',import.meta.url));await fs.writeFile(recipeFile,JSON.stringify(recipe));const args=[cli,'--root',root,'--asset',asset,'--recipe',recipeFile,'--tool-repo',toolRepo,'--binary',binary,'--mutation-check'];await fs.writeFile(asset,JSON.stringify(data));assert.match((await exec(process.execPath,args)).stdout,/'?PASS'?/);const changed=structuredClone(data);changed.runs[0].samples[1].x+=.125;await fs.writeFile(asset,JSON.stringify(changed));await assert.rejects(exec(process.execPath,args),e=>e.code===1&&/Published numeric samples/.test(e.stderr));});
 }finally{await fixture.dispose();}
});
