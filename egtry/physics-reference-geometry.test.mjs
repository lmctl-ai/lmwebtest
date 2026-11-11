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
