// Classification comes from complete independently replayed native poses, never asset flags.
export function stationaryControl(m){
 return m?.method==='wp01-zero-kick-native-poses/1'&&m.scene==='domino-wave'&&m.parameter===0&&m.frames===481&&m.dynamicBodies===18&&/^[a-f0-9]{64}$/.test(m.inputSha256??'')&&/^[a-f0-9]{64}$/.test(m.rawSha256??'')&&m.translationToleranceM===.001&&m.rotationToleranceRad===.001&&Number.isFinite(m.maxTranslationM)&&m.maxTranslationM>=0&&m.maxTranslationM<=.001&&Number.isFinite(m.maxRotationRad)&&m.maxRotationRad>=0&&m.maxRotationRad<=.001;
}
export function nativeMotionEvidence(rows,p,{inputSha256,rawSha256}){
 if(p.kind!=='PhysicsTake'||p.scene!=='domino-wave'||p.parameter!==0)return undefined;
 const fail=()=>{throw Error('Incomplete zero-kick native pose readback');};
 if(p.bodyCount!==19||p.bakeFrames!==481||rows.length!==19*481)fail();
 const initial=new Map(),seen=new Set();let maxTranslationM=0,maxRotationRad=0;
 for(const row of rows){if(row.length!==12||!row.every(Number.isFinite))fail();const[f,id,x,y,z,...tail]=row,q=tail.slice(0,4),key=f+':'+id;if(!Number.isInteger(f)||f<0||f>=481||!Number.isInteger(id)||id<0||id>=19||seen.has(key))fail();seen.add(key);if(f===0)initial.set(id,{xyz:[x,y,z],q});if(id===0)continue;const start=initial.get(id);if(!start)fail();maxTranslationM=Math.max(maxTranslationM,Math.hypot(x-start.xyz[0],y-start.xyz[1],z-start.xyz[2]));const norm=Math.hypot(...q)*Math.hypot(...start.q);if(!norm)fail();const dot=Math.abs(q.reduce((n,v,i)=>n+v*start.q[i],0)/norm);maxRotationRad=Math.max(maxRotationRad,2*Math.acos(Math.min(1,dot)));}
 const m={method:'wp01-zero-kick-native-poses/1',scene:p.scene,parameter:p.parameter,frames:p.bakeFrames,dynamicBodies:18,maxTranslationM,maxRotationRad,translationToleranceM:.001,rotationToleranceRad:.001,inputSha256,rawSha256};
 if(!stationaryControl(m))throw Error('Zero-kick control is not stationary in actual native poses');return m;
}
