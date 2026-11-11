import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import path from'node:path';
import{verifyRecordedRuns,discoverRecipe,verifyMutationRejected,digest}from'./physics-replay.mjs';
const root=process.env.PHYSICS_HOST_FIXTURE_ROOT;
test('real original lmvideo host replay rejects forged samples, source and media',{skip:!root},async()=>{
 const file=path.join(root,'content/books/detector-physics-timing-and-spatial-reconstruction/assets/real/finite-size-contact-precedes-point-crossing.json'),data=JSON.parse(await fs.readFile(file)),recipe=await discoverRecipe(data,root),options={root};
 const result=await verifyRecordedRuns(data,recipe,options);assert.equal(result.status,'PASS');assert.equal(result.comparedValues,2700);assert.ok((await verifyMutationRejected(data,recipe,options)).length);
 for(const [label,mutate,error]of [
 ['numeric values with updated checksum',d=>{d.runs[0].samples[4].y+=1;d.runs[0].samplesSha256=digest(JSON.stringify(d.runs[0].samples));},/Published numeric samples/],
 ['script',d=>d.runs[0].input.script+='\n',/Host resolved input/],
 ['parameters',d=>d.runs[0].parameters.radiusM=.9,/Host resolved input|Host parameters/],
 ['media',d=>d.runs[0].media.clipSha256='0'.repeat(64),/Replayed host clip hash/],
 ['units',d=>d.runs[0].columns.y.unit='s',/Host channel units/],
 ['frame indices',d=>d.runs[0].decimation.indices[1]=2,/Host retained frames/],
 ['duration',d=>d.runs[0].media.physicalDurationS=4,/Host physical duration/],
 ['physical tolerance',d=>d.runs[0].checks[0].tolerance=10,/Host physical evidence/],
 ]){const changed=structuredClone(data);mutate(changed);await assert.rejects(verifyRecordedRuns(changed,recipe,options),error,label);}
});
