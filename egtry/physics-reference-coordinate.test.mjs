import test from 'node:test';import assert from 'node:assert/strict';
import {referenceRows} from './physics-real-checks.mjs';
test('spatial and frequency references receive the declared coordinate without a fake time alias',()=>{
 for(const [key,kind,unit,values] of [['y','space','m',[-2,0,2]],['frequency','frequency','Hz',[5,5.5,6]]]){
  const run={axis:{key,kind,unit},samples:values.map(x=>({[key]:x}))},seen=[];
  const result=referenceRows(run,{},(_,coordinate)=>{assert.ok(Number.isFinite(coordinate));seen.push(coordinate);return {reference:coordinate**2};});
  assert.deepEqual(seen,values);assert.deepEqual(result,values.map(x=>({[key]:x,reference:x*x})));assert.ok(result.every(r=>!Object.hasOwn(r,'t')));
 }
});
test('time references retain saved timestamps and static snapshots need no timestamp field',()=>{
 assert.deepEqual(referenceRows({samples:[{t:0},{t:3}]},{},(_,t)=>({value:t+1})),[{t:0,value:1},{t:3,value:4}]);
 const basic={argument:1},result=referenceRows({axis:{kind:'static'},samples:[{mean:5}]},basic,(b,fallback)=>({horizon:b.argument??fallback,mean:8*(1-Math.exp(-b.argument))}));
 assert.equal(result[0].horizon,1);assert.equal(result[0].t,undefined);
});
import {visibleProvenance} from './physics-real-checks.mjs';
test('declared central-amplitude normalization must remain visible and exact',()=>{
 const data={scenario:{file:'actual.json'},tool:{name:'physim'}},run={input:{amplitude:1},checks:[],decimation:{indices:[0]},basic:{model:'grating',parameters:{amplitudeScale:.001}},basicNormalization:{value:.001,rawSha256:'a'.repeat(64)}};
 const expected=visibleProvenance(data,run,{});assert.deepEqual(expected.basicModel,run.basic);assert.deepEqual(expected.basicNormalization,run.basicNormalization);assert.notDeepEqual({...expected,basicNormalization:{...run.basicNormalization,value:.002}},expected);
});
test('older unnormalized footers remain valid and supplied basic-model details are checked',()=>{
 const data={scenario:{file:'actual.json'},tool:{name:'physim'}},run={input:{},checks:[],decimation:{indices:[0]},basic:{model:'linear'}};
 assert.equal(Object.hasOwn(visibleProvenance(data,run,{}),'basicModel'),false);assert.deepEqual(visibleProvenance(data,run,{basicModel:{model:'incorrect'}}).basicModel,run.basic);
});

import {recordedSeekReached} from './physics-real-checks.mjs';
test('seek verifies the declared space/frequency coordinate and keeps time separate',()=>{
 for(const [key,kind,last] of [['y','space',9.5],['frequency','frequency',32],['t','time',500]]){
  const run={axis:{key,kind},samples:[{[key]:0},{[key]:last}]},attribute=kind==='time'?'data-time':'data-coordinate';
  assert.equal(recordedSeekReached(run,'1',{[attribute]:String(last)}),true);
  assert.equal(recordedSeekReached(run,'0',{[attribute]:String(last)}),false);
  assert.equal(recordedSeekReached(run,'1',{[attribute]:String(last+1)}),false);
  assert.equal(recordedSeekReached(run,'1',{}),false);
  if(kind==='time')assert.equal(recordedSeekReached(run,'1',{'data-coordinate':String(last)}),false);
  else{assert.equal(recordedSeekReached(run,'1',{'data-time':String(last)}),true);assert.equal(recordedSeekReached(run,'1',{'data-coordinate':String(last+1),'data-time':String(last)}),false);}
 }
 assert.equal(recordedSeekReached({axis:{kind:'static'},samples:[{mean:8}]},'0',{}),true);
 assert.equal(recordedSeekReached({axis:{kind:'space',key:'y'},samples:[{y:-1},{y:0}]},'1',{'data-coordinate':null}),false);
});
