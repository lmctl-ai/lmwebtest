import{test}from'node:test';import assert from'node:assert/strict';import{recordedProvenance}from'./physics-real-checks.mjs';
test('optional units and workflow are part of exact visible provenance, while older assets retain their contract',()=>{
 const data={scenario:{file:'example.json'},tool:{version:'test'},workflow:{kind:'reviewed projection'}},run={input:{dt:.001},inputUnits:{dt:'s'},checks:[{name:'residual',residual:0}],decimation:{indices:[0,1]}};
 const p=recordedProvenance(data,run);assert.deepEqual(p.parameterUnits,{dt:'s'});assert.deepEqual(p.workflow,data.workflow);assert.notDeepEqual(p,{...p,parameterUnits:{dt:'ms'}});assert.deepEqual(p.parameters,run.input);
 const old=recordedProvenance({...data,workflow:undefined},{...run,inputUnits:undefined});assert.deepEqual(Object.keys(old).sort(),['scenario','tool','parameters','validation','decimation'].sort());
});
