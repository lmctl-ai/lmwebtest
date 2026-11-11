import {test} from 'node:test';import assert from 'node:assert/strict';
import {referenceRows} from './physics-real-checks.mjs';
test('a static final-time field evaluates its physical reference at its saved horizon',()=>{
 const run={axis:{kind:'static'},samples:[{t:.4,field:[.5,.8]}]},state=(_,t)=>({field:[Math.exp(-t),2*Math.exp(-t)]});
 assert.deepEqual(referenceRows(run,{},state),[{field:[Math.exp(-.4),2*Math.exp(-.4)]}]);
 assert.deepEqual(referenceRows({axis:{kind:'static'},samples:[{value:1}]},{},state),[{field:[1,2]}]);
});
test('spatial scan coordinates retain their declared independent variable',()=>{
 assert.deepEqual(referenceRows({axis:{kind:'position',key:'x',unit:'m'},samples:[{x:2,t:9}]},{},(_,x)=>({potential:x*x})),[{x:2,potential:4}]);
});
