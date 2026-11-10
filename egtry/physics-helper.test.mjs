import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runPhysicsQA } from './physics-helper.mjs';

// This is a suite regression fixture, not evidence about a real physics engine.
const replay = `<div class="mb-player"><button type="button" class="replay-step">Step</button><ol class="bb-board"></ol></div>`;
const lesson = broken => `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title><link rel="icon" href="data:,"></head><body><h1>Fixture</h1>
<section data-physics-model><canvas width="300" height="120"></canvas><button data-action="play">Play</button><button data-action="step">Step</button><div data-model-worked>${replay}</div></section>
<section data-physics-exercise data-state="open"><p data-problem></p><input data-answer-input type="text"><button data-action="check">Check</button><button data-action="next">Next</button><div data-worked-solution hidden>Use F = ma. Multiply mass 2 kg by acceleration 3 m/s². Answer: <span data-solution-answer="6 N">6 N</span>${replay}</div><p role="status"></p></section>
<script>
const broken=${JSON.stringify(broken)};
for(const player of document.querySelectorAll('.mb-player')) {
  let count=1;const rows=player.querySelector('ol'),step=player.querySelector('button');
  const render=()=>{rows.innerHTML=Array.from({length:count},(_,i)=>'<li class="bb-step" '+(broken==='hidden-steps'?'style="display:none"':broken==='transparent-steps'?'style="opacity:0"':'')+'><div class="bb-line">'+['F = m a','F = 2 × 3','F = 6 N','F / m = 3 m/s²'][i]+'</div><p class="bb-note">'+['Use Newton’s second law.','Substitute the stated mass and acceleration.','Multiply to find the force.','Recover acceleration as a cross-check.'][i]+'</p></li>').join('');step.disabled=count===4;};
  step.onclick=()=>{count++;render();};render();
}
if(broken==='visible-answer-mismatch')document.querySelector('[data-solution-answer]').textContent='600 N';
if(broken==='prose-only')document.querySelector('[data-worked-solution] .mb-player').remove();
const c=document.querySelector('canvas'), ctx=c.getContext('2d'); let x=10, playing=false, n=0;
function paint(){ctx.fillStyle='white';ctx.fillRect(0,0,300,120);ctx.fillStyle='blue';ctx.fillRect(x%260,30,30,30);}
if(broken!=='blank')paint();
const play=document.querySelector('[data-action=play]');
play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause':'Play';};
setInterval(()=>{if(playing&&broken!=='static'){x+=2;paint();}},30);
document.querySelector('[data-action=step]').onclick=()=>{playing=false;play.textContent='Play';x+=2;paint();};
const ex=document.querySelector('[data-physics-exercise]'), problem=document.querySelector('[data-problem]');
function show(){problem.textContent=n?'Find force for mass 3 kg and acceleration 3 m/s²':'Find force for mass 2 kg and acceleration 3 m/s²';}show();
document.querySelector('[data-action=check]').onclick=()=>{const right=broken==='accept-wrong'||(broken==='accept-valid-unit-wrong' ? /N$/.test(document.querySelector('input').value) : broken==='accept-wrong-dimension' ? Number.parseFloat(document.querySelector('input').value)===(n?9:6) : document.querySelector('input').value===(n?'9 N':'6 N'));ex.dataset.state=right?'right':'wrong';document.querySelector('[role=status]').textContent=right?'Correct':'Not yet';document.querySelector('[data-worked-solution]').hidden=right;};
document.querySelector('[data-action=next]').onclick=()=>{if(broken!=='next')n++;show();ex.dataset.state='open';};
if(broken==='console')console.error('fixture deliberate error');
</script></body></html>`;

test('physics QA proves behavior and rejects broken pages', { timeout: 420000 }, async () => {
  let mode = '';
  const index = omit => `<title>Mechanics</title><h1>Mechanics</h1><a href="/mechanics/one/">One</a>${omit ? '' : '<a href="/mechanics/two/">Two</a>'}`;
  const legacy = http.createServer((req, res) => { res.end(index(false)); });
  const target = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/mechanics/') res.end(index(mode === 'missing'));
    else if (mode === 'missing' && req.url.startsWith('/mechanics/two/')) { res.statusCode = 404; res.end('missing'); }
    else res.end(lesson(mode === 'broken' ? (req.url.includes('/one/') ? 'blank' : 'static') : mode));
  });
  await Promise.all([new Promise(r => legacy.listen(0, '127.0.0.1', r)), new Promise(r => target.listen(0, '127.0.0.1', r))]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'physics-qa-test-'));
  const opt = { book: 'mechanics', host: `http://127.0.0.1:${target.address().port}`, 'v1-host': `http://127.0.0.1:${legacy.address().port}`, pages: 'all', seed: '731', 'out-dir': dir, report: path.join(dir, 'report.md') };
  try {
    const good = await runPhysicsQA(opt);
    assert.equal(good.status, 'PASS'); assert.equal(good.testedSlugs.length, 2);
    assert.equal(good.checks.filter(c => c.name.startsWith('Right answer accepted')).length, 4);
    assert.match(await fs.readFile(opt.report, 'utf8'), /Overall Verdict.*PASS/);
    for (const [variant, expected] of [['broken', 'Animation pixels'], ['accept-wrong', 'Exercise 1'], ['next', 'Exercise 1'], ['console', 'Console/network'], ['hidden-steps', 'Model 1'], ['transparent-steps', 'Model 1'], ['visible-answer-mismatch', 'Exercise 1'], ['prose-only', 'Exercise 1'], ['accept-valid-unit-wrong', 'Exercise 1'], ['accept-wrong-dimension', 'Exercise 1'], ['missing', 'Index lists every old slug']]) {
      mode = variant;
      const bad = await runPhysicsQA(opt);
      assert.equal(bad.status, 'FAIL', variant);
      assert.ok(bad.checks.some(c => c.status === 'FAIL' && c.name.startsWith(expected)), `${variant}: no failing ${expected}`);
      if (variant === 'broken') assert.ok(bad.checks.some(c => c.status === 'FAIL' && c.detail.includes('Blank canvas')));
      if (variant === 'missing') assert.ok(bad.checks.some(c => c.status === 'FAIL' && c.name === 'HTTP /mechanics/two/'));
    }
  } finally {
    legacy.closeAllConnections(); target.closeAllConnections();
    await Promise.all([new Promise(r => legacy.close(r)), new Promise(r => target.close(r))]);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
