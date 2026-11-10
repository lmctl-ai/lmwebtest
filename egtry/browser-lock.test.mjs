import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const wrapper=fileURLToPath(new URL('./browser-lock.sh',import.meta.url));
async function run(command,args,options={}){
 const child=spawn(command,args,{...options,detached:true,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},4000);
 try{return await new Promise((ok,bad)=>{child.once('error',bad);child.once('close',(code,signal)=>ok({code:code??1,signal,output}));});}
 finally{clearTimeout(timer);}
}
const fixture=async fn=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'physics-lock-test-'));try{await fn(dir,path.join(dir,'gate'));}finally{await fs.rm(dir,{recursive:true,force:true});}};
test('browser lock works standalone and preserves child failure',()=>fixture(async(_,lock)=>{
 const good=await run('bash',[wrapper,lock,process.execPath,'-e',"console.log('standalone')"]);assert.equal(good.code,0,good.output);
 const bad=await run('bash',[wrapper,lock,process.execPath,'-e','process.exit(7)']);assert.equal(bad.code,7,bad.output);
}));
test('an inherited exclusive flock is reused without a nested deadlock',()=>fixture(async(_,lock)=>{
 const result=await run('flock',[lock,'bash',wrapper,lock,process.execPath,'-e',"console.log('nested')"]);
 assert.equal(result.code,0,result.output);assert.match(result.output,/nested/);
 const bad=await run('flock',[lock,'bash',wrapper,lock,process.execPath,'-e','process.exit(7)']);assert.equal(bad.code,7,bad.output);
}));
test('an unrelated inherited descriptor or stale context cannot bypass another holder',()=>fixture(async(dir,lock)=>{
 const log=path.join(dir,'events');
 const program="const f=require('node:fs'),p=process.argv[1],n=process.argv[2];f.appendFileSync(p,'start:'+n+'\\n');setTimeout(()=>f.appendFileSync(p,'end:'+n+'\\n'),500)";
 const first=run('bash',[wrapper,lock,process.execPath,'-e',program,log,'first']);
 for(let i=0;;i++){try{if((await fs.readFile(log,'utf8')).includes('start:first'))break;}catch{}if(i>200)throw Error('holder did not start');await new Promise(r=>setTimeout(r,5));}
 const second=run('bash',['-c','exec 8>>"$1"; shift; exec "$@"','inherited',lock,'bash',wrapper,lock,process.execPath,'-e',program,log,'second'],{env:{...process.env,LMWEBTEST_BROWSER_LOCK_OWNER:process.pid+':3'}});
 const results=await Promise.all([first,second]);for(const r of results)assert.equal(r.code,0,r.output);
 assert.deepEqual((await fs.readFile(log,'utf8')).trim().split('\n'),['start:first','end:first','start:second','end:second']);
}));
test('an unlocked inherited descriptor does not retain the child lock in its parent',()=>fixture(async(_,lock)=>{
 const result=await run('bash',['-c','set -e; exec 8>>"$1"; bash "$2" "$1" "$3" -e "process.exit(0)"; flock -n "$1" true','unlocked',lock,wrapper,process.execPath]);
 assert.equal(result.code,0,result.output);
}));


test('the actual lmscript entrypoint preserves nested locking and helper errors',()=>fixture(async(dir,lock)=>{
 const sourceDir=path.dirname(wrapper);
 for(const file of ['browser-lock.sh','physics-helper.mjs','physics-checks.mjs','physics-reference.mjs'])await fs.copyFile(path.join(sourceDir,file),path.join(dir,file));
 await fs.symlink(path.resolve(sourceDir,'../node_modules'),path.join(dir,'node_modules'));
 const source=await fs.readFile(path.join(sourceDir,'physics.lms'),'utf8'),script=path.join(dir,'physics.lms');
 await fs.writeFile(script,source.replace('"/tmp/browser-gate.lock"',JSON.stringify(lock)));
 const direct=await run('lmscript',[script,'--workers','0'],{cwd:dir});assert.equal(direct.code,2,direct.output);assert.match(direct.output,/workers must be/);
 const official=await run('bash',[wrapper,lock,'lmscript',script,'--workers','0'],{cwd:dir});assert.equal(official.code,2,official.output);assert.match(official.output,/workers must be/);
 const nested=await run('flock',[lock,'bash',wrapper,lock,'lmscript',script,'--workers','0'],{cwd:dir});assert.equal(nested.code,2,nested.output);assert.match(nested.output,/workers must be/);
 const raw=await run('flock',[lock,'lmscript',script,'--workers','0'],{cwd:dir});assert.equal(raw.code,2,raw.output);assert.match(raw.output,/held by an ancestor without context/);
}));
