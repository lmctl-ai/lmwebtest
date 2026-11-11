import{test}from'node:test';import assert from'node:assert/strict';import{referenceGeometry,referenceRows}from'./physics-real-checks.mjs';
test('a pre-impact reference uses finite shared bounds and never extends its free-flight domain',()=>{
 const run={samples:[{t:0,y:10},{t:1,y:5},{t:2,y:2}],axis:{key:'t',kind:'time',unit:'s'}},basic={validUntil:1};
 const rows=referenceRows(run,basic,(b,t)=>t>b.validUntil?null:{y:10-5*t*t});
 assert.deepEqual(rows,[{t:0,y:10},{t:1,y:5},{t:2}]);
 const result=referenceGeometry({kind:'series',x:'t',y:'y'},run,rows);
 assert.equal(result.reference,true);assert.deepEqual(result.view.bounds,{xmin:0,xmax:2,ymin:2,ymax:10});
 assert.equal(Object.hasOwn(rows[2],'y'),false,'No post-impact reference value is fabricated');
});
test('unmapped quantities and rigid geometry do not demand a fictitious basic curve',()=>{
 const run={samples:[{t:0,x:1,energy:3},{t:1,x:2,energy:3}]},baseline=[{t:0,energy:3},{t:1,energy:3}];
 assert.equal(referenceGeometry({kind:'series',x:'t',y:'x'},run,baseline).reference,false);
 assert.equal(referenceGeometry({kind:'rigid'},run,baseline).reference,false);
 assert.equal(referenceGeometry({kind:'series',x:'t',y:'energy'},run,baseline).reference,true);
});

test('declared same-coordinate reference columns share exact plot bounds without claiming a baseline canvas',()=>{const run={samples:[{t:0,x:3,ref:10},{t:1,x:5,ref:-2}]};const g=referenceGeometry({kind:'series',x:'t',y:'x',compare:'ref'},run,[]);assert.equal(g.reference,false);assert.deepEqual(g.view.bounds,{xmin:0,xmax:1,ymin:-2,ymax:10});});

test('reference geometry retains explicit physical limits for a vanishing projection',()=>{const view={kind:'series',x:'t',y:'mean',bounds:{ymin:-.001,ymax:.001}},run={samples:[{t:0,mean:2e-19},{t:1,mean:-2e-19}]},basic=[{t:0,mean:0},{t:1,mean:0}];const result=referenceGeometry(view,run,basic);assert.equal(result.reference,true);assert.deepEqual(result.view.bounds,{xmin:0,xmax:1,ymin:-.001,ymax:.001});});
test('recorded and basic field plots use identical geometry and color bounds',()=>{
 const run={field:{nx:2,ny:2},samples:[{field:[1,2,3,4]}]},baseline=[{field:[0,0,0,0]}];
 const auto=referenceGeometry({kind:'field'},run,baseline);assert.equal(auto.reference,true);assert.equal(auto.view.min,0);assert.equal(auto.view.max,4);
 const fixed=referenceGeometry({kind:'field',min:-2,max:2},run,baseline);assert.equal(fixed.view.min,-2);assert.equal(fixed.view.max,2);
 assert.equal(referenceGeometry({kind:'field'},run,[{field:[0]}]).reference,false);
});
