import{test}from'node:test';import assert from'node:assert/strict';import{nativeMotionEvidence,stationaryControl}from'./physics-native-motion.mjs';
const p={kind:'PhysicsTake',scene:'domino-wave',parameter:0,bodyCount:19,bakeFrames:481},hashes={inputSha256:'a'.repeat(64),rawSha256:'b'.repeat(64)};
function poses(){return Array.from({length:481},(_,f)=>Array.from({length:19},(_,b)=>[f,b,b+f*1e-8,1,0,0,0,0,f%2?-1:1,0,0,0])).flat();}
test('stationary exception requires complete independently replayed zero-kick poses',()=>{
 const rows=poses(),proof=nativeMotionEvidence(rows,p,hashes);assert.equal(stationaryControl(proof),true);assert.ok(proof.maxTranslationM>0);assert.equal(proof.maxRotationRad,0);
 assert.equal(stationaryControl({stationaryControl:true}),false);for(const changed of[{parameter:-2.8},{scene:'box-stack'},{kind:'Presentation count/mass conservation'}])assert.equal(nativeMotionEvidence(rows,{...p,...changed},hashes),undefined);
 assert.throws(()=>nativeMotionEvidence(rows.slice(1),p,hashes),/Incomplete/);const duplicate=poses();duplicate[20]=duplicate[21];assert.throws(()=>nativeMotionEvidence(duplicate,p,hashes),/Incomplete/);
 const moving=poses();moving.at(-1)[2]+=.01;assert.throws(()=>nativeMotionEvidence(moving,p,hashes),/not stationary/);const rotating=poses();rotating.at(-1).splice(5,4,0,0,Math.sin(.01),Math.cos(.01));assert.throws(()=>nativeMotionEvidence(rotating,p,hashes),/not stationary/);
 for(const mutate of[x=>x.rawSha256='fake',x=>x.frames=2,x=>x.parameter=1,x=>x.maxTranslationM=.01,x=>x.maxRotationRad=.01,x=>x.translationToleranceM=1]){const bad=structuredClone(proof);mutate(bad);assert.equal(stationaryControl(bad),false);}
});
