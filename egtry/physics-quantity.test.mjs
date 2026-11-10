import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {quantitySolver, workedReplay} from './physics-checks.mjs';

test('quantity solvers need visible unit-aware results and changing worked steps', async () => {
  const browser = await chromium.launch(process.env.CHROME ? {executablePath:process.env.CHROME} : {});
  try {
    for (const width of [1280,390]) for (const mode of ['good','frozen-output','frozen-steps','hidden-steps','hidden-result','frozen-canvas','transparent-leaf','leaked-working']) {
      const page = await browser.newPage({viewport:{width,height:900}});
      await page.setContent(`<section data-physics-solver><label>Mass (kg)<input data-quantity-parameter type="number" value="2" min="0"></label><output data-quantity-result ${mode==='hidden-result'?'hidden':''}>6 N</output><div class="mb-player"><button>Step</button><ol></ol></div></section>`);
      await page.evaluate(mode => {
        const input=document.querySelector('input'),output=document.querySelector('output'),button=document.querySelector('button'),ol=document.querySelector('ol');let count=1,value=6;
        const render=()=>{ol.innerHTML=Array.from({length:count},(_,i)=>`<li class="bb-step" ${mode==='hidden-steps'?'hidden':''}><div class="bb-line"><math display="block"><mtext ${mode==='transparent-leaf'?'style="opacity:0"':''}>${mode==='leaked-working'?'e.force × e.cosine':i+' F = '+value+' N'}</mtext></math></div><p class="bb-note">Use the law, substitute, calculate and check.</p></li>`).join('');button.disabled=count===4;};
        button.onclick=()=>{count++;render();};
        input.onchange=()=>{if(mode!=='frozen-output')output.textContent=Number(input.value)*3+' N';if(mode!=='frozen-steps')value=Number(input.value)*3;count=1;render();};render();
      },mode);
      const run=()=>quantitySolver(page.locator('section'),workedReplay,{observe:async()=>mode==='frozen-canvas'?'fixed':page.locator('output').textContent()});
      if(mode==='good') {const result=await run();assert.equal(result.before,'6 N');assert.notEqual(result.after,'6 N');}
      else await assert.rejects(run, /hidden|do not change|steps did not|canvas|leaks/);
      await page.close();
    }
  } finally {await browser.close();}
});

test('finite normalized states require coordinated Calculate inputs',async()=>{
  const browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
  try {
    const page=await browser.newPage();
    await page.setContent('<section><input data-quantity-parameter name="a" type="number" value="1"><input data-quantity-parameter name="b" type="number" value="0"><button data-action="calculate">Calculate</button><output data-quantity-result>P0: 1 1</output><div class="mb-player"><button>Step</button><ol></ol></div></section>');
    await page.evaluate(()=>{
      let count=1,value=1;const rows=document.querySelector('ol'),step=document.querySelector('.mb-player button');
      const render=()=>{rows.innerHTML=Array.from({length:count},(_,i)=>`<li class="bb-step"><div class="bb-line">P0 = ${value} 1 (step ${i})</div><p class="bb-note">Normalize then square the real amplitude.</p></li>`).join('');step.disabled=count===4;};
      step.onclick=()=>{count++;render();};document.querySelector('[data-action=calculate]').onclick=()=>{const a=Number(document.querySelector('[name=a]').value),b=Number(document.querySelector('[name=b]').value);if(Math.abs(a*a+b*b-1)>1e-9)return;value=a*a;count=1;document.querySelector('output').textContent='P0: '+value+' 1';render();};render();
    });
    const result=await quantitySolver(page.locator('section'),workedReplay);
    assert.equal(result.interaction,'coordinated normalized real amplitudes');
    assert.equal(result.after,'P0: 0 1');
    // Reset the board after the first completed probe before trying declared cases.
    await page.locator('[data-action=calculate]').click();
    const declared=await quantitySolver(page.locator('section'),workedReplay,{scenarios:[{a:.6,b:.8}]});
    assert.equal(declared.interaction,'declared valid-input scenario');
    assert.equal(declared.after,'P0: 0.36 1');
  } finally {await browser.close();}
});

test('bounded microscopic parameters are probed at their own scale',async()=>{
 const browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
 try {
  const page=await browser.newPage();
  await page.setContent('<section><input data-quantity-parameter name="charge" type="number" step="any" min="0.0000001" max="0.00001" value="0.000001"><output data-quantity-result>Field = 2 N/C</output><div class="mb-player"><button>Step</button><ol></ol></div></section>');
  await page.evaluate(()=>{
   const input=document.querySelector('input'),out=document.querySelector('output'),button=document.querySelector('button'),rows=document.querySelector('ol');let count=1,value=2;
   const render=()=>{rows.innerHTML=Array.from({length:count},(_,i)=>`<li class="bb-step"><div class="bb-line">E = ${value} N/C (step ${i})</div><p class="bb-note">Apply the field law with the stated SI charge.</p></li>`).join('');button.disabled=count===4;};
   input.onchange=()=>{value=Number(input.value)*2e6;out.textContent='Field = '+value+' N/C';count=1;render();};button.onclick=()=>{count++;render();};render();
  });
  const result=await quantitySolver(page.locator('section'),workedReplay);
  assert.notEqual(result.before,result.after);assert.equal(await page.locator('input').inputValue(),'0.000001');
 }finally{await browser.close();}
});
