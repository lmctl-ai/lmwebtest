import{test}from'node:test';import assert from'node:assert/strict';
import{recordedView,recordedCoordinate}from'./physics-real-checks.mjs';
test('a recorded same-unit comparison shares scales with the actual selected curve',()=>{
 const samples=[{t:0,x:1,truth:-2},{t:1,x:2,truth:4}],view={kind:'series',x:'t',y:'x',compare:'truth'};
 assert.deepEqual(recordedView(view,samples).bounds,{xmin:0,xmax:1,ymin:-2,ymax:4});assert.equal(view.bounds,undefined);assert.equal(samples[0].x,1);
});
test('existing analytic overlays retain common bounds and field/rigid views retain their geometry',()=>{
 assert.deepEqual(recordedView({kind:'series',x:'t',y:'x'},[{t:0,x:1},{t:1,x:2}],[{t:0,x:-3},{t:1,x:4}]).bounds,{xmin:0,xmax:1,ymin:-3,ymax:4});
 assert.deepEqual(recordedView({kind:'field',nx:4},[]),{kind:'field',nx:4});
});

test('frequency scans use their recorded coordinate and retain the actual declared units',async()=>{
 const root={getAttribute:async key=>({'data-coordinate':'12.5','data-time':'999'})[key]??null};assert.equal(await recordedCoordinate(root,{kind:'frequency',key:'frequency_hz',unit:'Hz'}),12.5);assert.equal(await recordedCoordinate(root,{kind:'time',key:'t',unit:'s'}),999);assert.equal(await recordedCoordinate(root,{kind:'static'}),null);await assert.rejects(recordedCoordinate({getAttribute:async()=>null},{kind:'frequency'}),/Missing/);
});
