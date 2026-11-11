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
