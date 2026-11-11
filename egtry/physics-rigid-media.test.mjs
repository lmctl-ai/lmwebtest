// Explicit synthetic ledgers/bytes exercise QA guards, never scientific assets.
import{test}from'node:test';import assert from'node:assert/strict';import{compareHostLedger,verifyRigidMediaBytes,verifyRigidMedia}from'./physics-rigid-media.mjs';import{digest}from'./physics-replay.mjs';
const bodies=[{mass:0},{mass:1},{mass:1}],raw={samples:Array.from({length:3},(_,f)=>({t:f,poses:[[0,0,0,0,0,0,1],[f,1,0,0,0,0,1],[2,3-f,0,0,0,0,1]]}))},ledger=raw.samples.flatMap((s,f)=>s.poses.slice(1).map((p,j)=>[f,j,p[0],p[1],0,0].join(','))).join('\n')+'\n';
test('attached rendered ledger must cover every native dynamic-body frame in order',()=>{
 assert.equal(compareHostLedger(ledger,raw,bodies).residual,0);
 const rows=ledger.trim().split('\n');assert.throws(()=>compareHostLedger(rows.slice(1).join('\n'),raw,bodies),/incomplete/);
 for(const edit of [a=>a[0]='0,0,999,1,0,0',a=>a[1]=a[0],a=>a[0]='0,0,0,1,NaN,0',a=>a[0]='0,0,0,1,0',a=>a.reverse()]){
  const copy=[...rows];edit(copy);assert.throws(()=>compareHostLedger(copy.join('\n'),raw,bodies),/disagree|Invalid/);
 }
 const shifted=structuredClone(raw);shifted.samples[1].poses[2][1]+=.1;assert.throws(()=>compareHostLedger(ledger,shifted,bodies),/disagree/);
});
test('attached media preserves identity only after actual render and published bytes match',()=>{
 const clip=Buffer.from('synthetic clip'),poster=Buffer.from('synthetic poster'),media={clip:'real/fixture.mp4',poster:'real/fixture.png',clipSha256:digest(clip),posterSha256:digest(poster),host:{version:'synthetic'}},actual={clip,poster};
 const proof=verifyRigidMediaBytes(media,actual,actual);assert.deepEqual(proof,media);proof.host.version='changed';assert.equal(media.host.version,'synthetic');
 for(const kind of ['clip','poster']){
  assert.throws(()=>verifyRigidMediaBytes(media,{...actual,[kind]:Buffer.from('changed')},actual),/Actual rendered/);
  assert.throws(()=>verifyRigidMediaBytes(media,actual,{...actual,[kind]:Buffer.from('changed')}),/Published/);
  assert.throws(()=>verifyRigidMediaBytes({...media,[kind+'Sha256']:'0'.repeat(64)},actual,actual),/Actual rendered/);
  assert.throws(()=>verifyRigidMediaBytes({...media,[kind]:'../fixture.mp4'},actual,actual),/Unsafe/);
 }
});
test('attached clips cannot silently skip source-book or host-script binding',async()=>{
 await assert.rejects(verifyRigidMedia({},{}),/source book/);
 await assert.rejects(verifyRigidMedia({host:{scenarioFile:'../unreviewed.lms'}},{book:'fixture'}),/reviewed/);
});
