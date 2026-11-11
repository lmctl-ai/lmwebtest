import{test}from'node:test';import assert from'node:assert/strict';
import{verifiedHostMedia}from'./physics-wp01-host.mjs';import{digest}from'./physics-replay.mjs';
test('host replay retains verified browser media identity and rejects altered render/source bytes',()=>{
 const clip=Buffer.from('explicit synthetic clip bytes'),poster=Buffer.from('explicit synthetic poster bytes'),media={clip:'real/run.webm',poster:'real/run.png',clipSha256:digest(clip),posterSha256:digest(poster),playbackDurationS:3.042,physicalDurationS:1.5,encoding:{outputFrames:73}},actual={clip,poster};
 const proof=verifiedHostMedia(media,actual,actual);assert.deepEqual(proof,media);proof.encoding.outputFrames=0;assert.equal(media.encoding.outputFrames,73);
 for(const kind of ['clip','poster']){
  assert.throws(()=>verifiedHostMedia(media,{...actual,[kind]:Buffer.from('altered')},actual),/Native rendered/);
  assert.throws(()=>verifiedHostMedia(media,actual,{...actual,[kind]:Buffer.from('altered')}),/Published/);
  assert.throws(()=>verifiedHostMedia({...media,[kind+'Sha256']:'0'.repeat(64)},actual,actual),/Native rendered/);
  assert.throws(()=>verifiedHostMedia({...media,[kind]:'../outside.webm'},actual,actual),/Unsafe media path/);
 }
});
