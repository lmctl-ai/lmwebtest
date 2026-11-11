import {test} from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {assertPlot,installRealCanvasProbe} from './physics-real-checks.mjs';
test('a reference ending at impact needs no dashed self-overlay, while the primary plot still does',async()=>{
 const browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});await installRealCanvasProbe(page);await page.goto('data:text/html,'+encodeURIComponent('<canvas width="800" height="300" style="width:100%"></canvas>'));
  const canvas=page.locator('canvas'),reference=[{t:0,x:1},{t:1,x:.5},{t:2}],native=[{t:0,x:0},{t:1,x:0},{t:2,x:0}],view={kind:'series',x:'t',y:'x',overlay:reference,bounds:{xmin:0,xmax:2,ymin:0,ymax:1}},columns={t:{unit:'s'},x:{unit:'m'}};
  const draw=async partial=>canvas.evaluate((el,partial)=>{
   const c=el.getContext('2d'),px=t=>60+t/2*730,py=x=>245-x*190;c.fillStyle='#eef4f1';c.fillRect(0,0,800,300);c.fillStyle='#213c36';c.fillText('t (s): 0 … 2',60,285);c.fillText('x (m): 0 … 1',60,43);c.strokeStyle='#216895';c.lineWidth=2;c.beginPath();c.moveTo(px(0),py(partial?1:0));c.lineTo(px(partial?1:2),py(partial ? .5 : 0));c.stroke();if(!partial){c.fillStyle='#b15b22';c.beginPath();c.arc(px(2),py(0),6,0,Math.PI*2);c.fill();}
  },partial);
  await draw(true);assert.equal((await assertPlot(canvas,{...view,reference:true},reference,2,columns)).tested,2);
  await draw(false);await assert.rejects(assertPlot(canvas,view,native,2,columns),/Basic-model dashed overlay/);
  await page.close();
 }}finally{await browser.close();}
});
