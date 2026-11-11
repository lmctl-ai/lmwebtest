// Replay host-rendered media attached to an independently exported native pose take.
import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{execFile}from'node:child_process';import{promisify}from'node:util';import{digest,canonical,contained}from'./physics-replay.mjs';
const exec=promisify(execFile),cache=new Map,need=(x,m)=>{if(!x)throw Error(m);},same=(a,b,m)=>need(canonical(a)===canonical(b),m+' differs from independent replay');
export function compareHostLedger(stdout,raw,bodies){
 const lines=String(stdout).trim().split('\n').map(line=>line.split(',').map(Number)),moving=bodies.flatMap((b,i)=>b.mass>0?[i]:[]);
 need(moving.length>0&&raw.samples?.length>0&&lines.length===moving.length*raw.samples.length,'Host ledger is incomplete');let residual=0;
 for(let f=0;f<raw.samples.length;f++)for(let j=0;j<moving.length;j++){
  const row=lines[f*moving.length+j],pose=raw.samples[f].poses?.[moving[j]];
  need(row.length===6&&row.every(Number.isFinite)&&row[0]===f&&row[1]===j&&pose?.length===7&&pose.every(Number.isFinite),'Invalid host ledger order/body/pose');
  residual=Math.max(residual,Math.abs(pose[0]-row[2]),Math.abs(pose[1]-row[3]));
 }
 need(residual<=2e-5,'Rendered host/native body positions disagree');
 return{name:'Every dynamic-body XY pose matches the independently repeated rendered-host run',residual,tolerance:2e-5,units:'m'};
}
export function verifyRigidMediaBytes(media,rendered,published){
 for(const kind of ['clip','poster']){
  need(/^real\/[-\w]+\.(mp4|png)$/.test(media[kind]??''),'Unsafe rigid media path');
  same(digest(rendered[kind]),media[kind+'Sha256'],'Actual rendered '+kind);
  same(digest(published[kind]),media[kind+'Sha256'],'Published '+kind);
 }
 return structuredClone(media);
}
export async function verifyRigidMedia(media,{root,book,toolRepo,raw,bodies}){
 need(/^[-a-z0-9]+$/.test(book??''),'Attached rigid media needs its source book');const h=media.host;
 need(h&&/^scripts\/physics\/scenarios\/[-\w]+\.lms$/.test(h.scenarioFile??''),'Missing reviewed rendered-host source');const binary=path.join(toolRepo,'build/lmvideo');
 same((await exec(binary,['--version'])).stdout.trim(),h.version,'Supplementary host version');same(digest(await fs.readFile(binary)),h.binarySha256,'Supplementary host binary');
 same((await exec('git',['-C',toolRepo,'rev-parse','HEAD'])).stdout.trim(),h.commit,'Supplementary host commit');same((await exec('lmscript',['--version'])).stdout.trim(),h.lmscriptVersion,'Supplementary compiler version');
 const script=await fs.readFile(await contained(root,h.scenarioFile),'utf8');same(digest(script),h.scenarioSha256,'Supplementary scene script');
 need(script.includes(JSON.stringify(binary)),'Rendered script does not invoke the verified host');
 const key=h.binarySha256+':'+h.scenarioSha256;let actual=cache.get(key);
 if(!actual){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rigid-media-replay-'));try{
  const file=path.join(dir,'scenario.lms');await fs.writeFile(file,script);const result=await exec('lmscript',[file],{cwd:dir,timeout:240000,maxBuffer:32*1024*1024});
  actual={stdout:result.stdout,clip:await fs.readFile(path.join(dir,path.basename(media.clip))),poster:await fs.readFile(path.join(dir,path.basename(media.poster)))};
  const p=JSON.parse((await exec('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,r_frame_rate','-of','json',path.join(dir,path.basename(media.clip))])).stdout).streams[0];
  actual.frames=Number(p.nb_read_frames);const[n,d]=p.r_frame_rate.split('/').map(Number);actual.fps=n/d;cache.set(key,actual);
 }finally{await fs.rm(dir,{recursive:true,force:true});}}
 same(digest(actual.stdout),h.stateLedgerSha256,'Actual host state ledger');same(compareHostLedger(actual.stdout,raw,bodies),media.validation,'Host/native pose comparison');
 same(media.physicalDurationS,raw.samples.at(-1).t,'Supplementary physical duration');same(media.frames,actual.frames,'Rendered frame count');same(media.fps,actual.fps,'Rendered frame rate');same(media.playbackDurationS,actual.frames/actual.fps,'Rendered playback duration');
 const published={};for(const kind of ['clip','poster'])published[kind]=await fs.readFile(await contained(root,'content/books/'+book+'/assets/'+media[kind]));
 const proof=verifyRigidMediaBytes(media,actual,published);same(digest(await fs.readFile(binary)),h.binarySha256,'Supplementary host after replay');return proof;
}
