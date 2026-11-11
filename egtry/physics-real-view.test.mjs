import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceGeometry,recordedSeekReached} from './physics-real-checks.mjs';

test('a recorded same-unit comparison shares scales with the selected curve',()=>{
 const samples=[{t:0,x:1,truth:-2},{t:1,x:2,truth:4}],view={kind:'series',x:'t',y:'x',compare:'truth'};
 assert.deepEqual(referenceGeometry(view,{samples},[]).view.bounds,{xmin:0,xmax:1,ymin:-2,ymax:4});
 assert.equal(view.bounds,undefined);assert.equal(samples[0].x,1);
});

test('a frequency scan reaches its actual coordinate without requiring a physical clock',()=>{
 const run={axis:{kind:'frequency',key:'frequency_hz',unit:'Hz'},samples:[{frequency_hz:0},{frequency_hz:12.5}]};
 assert.equal(recordedSeekReached(run,1,{'data-coordinate':'12.5','data-time':'999'}),true);
 assert.equal(recordedSeekReached(run,1,{'data-coordinate':'999'}),false);
 assert.equal(recordedSeekReached(run,0,{'data-coordinate':'12.5'}),false);
});
