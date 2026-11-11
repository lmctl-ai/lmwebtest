import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {waitForRecordedPlayback} from './physics-real-checks.mjs';

test('playback checks follow declared dimensional or dimensionless time and reject frozen traces',async()=>{
 const browser=await chromium.launch();
 try{
  for(const key of ['t','tau']){
   const page=await browser.newPage();
   await page.setContent('<div id="model" data-time="2" data-playing="true"></div>');
   const model=page.locator('#model'),run={axis:{kind:'time',key,unit:key==='tau'?'1':'s'},samples:[{[key]:2},{[key]:3}]};
   await page.evaluate(()=>setTimeout(()=>document.querySelector('#model').dataset.time='3',100));
   await waitForRecordedPlayback(page,model,run);
   await model.evaluate(el=>{el.dataset.time='2';el.dataset.playing='false';});
   await assert.rejects(waitForRecordedPlayback(page,model,run),/Play never advances/);
   await assert.rejects(waitForRecordedPlayback(page,model,{...run,samples:[{}]}),/Missing initial recorded time/);
   await page.close();
  }
 }finally{await browser.close();}
});
