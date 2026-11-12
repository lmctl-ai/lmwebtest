#!/usr/bin/env node
// DSA book QA (egtry R44): every lesson of a <lang>-dsa book runs in the simple viewer with a diagram panel that follows the run.
//   node dsa-helper.mjs --book python-dsa --host www.egtry.com [--origin http://127.0.0.1:8099] [--pages N|all] [--seed N]
//                       [--expect-pages 42] [--require-all] [--max-steps 800] [--report FILE]
// Black box: only the public DOM contract of the page is used (interpreters docs/design/simple-viewer/17-dsa-diagrams.md):
//   example root    .sv[data-example][data-diagram]   data-state, data-step
//   diagram panel   .dg   data-live (0 before Run), data-step, data-stage; .dg-stage-label, .dg-stage-count "(stage k of n)", .dg-note,
//                   .dg-caption, .dg-views svg[role=img][aria-label], buttons .dg-prev / .dg-next
// Checks per page at 1280 and 390: HTTP 200, no console error / failed request; every example has a panel with a picture before Run; stepping
// to the end keeps the panel on the viewer's step, the pictures change, the stages run 1..n in order, each with a note; no sideways overflow, no
// clipped picture, the executing line stays visible (below the sticky panel at 390); the diagram is beside the code at 1280 and above it at 390;
// the Stage buttons jump stage by stage. A page of the book index that has no diagram yet is "not ported": reported, a failure with --require-all.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
function options(args) {
  const out = {book: 'python-dsa', host: 'www.egtry.com', pages: 'all', seed: '731', 'expect-pages': '42', 'max-steps': '800'};
  const keys = new Set([...Object.keys(out), 'origin', 'report']), flags = new Set(['require-all']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('dsa.lms --book SLUG-dsa --host HOST [--origin URL] [--pages N|all] [--seed N] [--expect-pages 42] [--require-all] [--max-steps 800] [--report FILE]'); process.exit(0); }
    const key = args[i].replace(/^--/, '');
    if (flags.has(key)) { out[key] = true; continue; }
    if (!args[i].startsWith('--') || !keys.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Invalid option: ${args[i]}`);
    out[key] = args[++i];
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(out.book)) throw Error('Invalid book slug');
  return out;
}
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
/** first, last and a seeded choice of the rest */
export function sample(list, n, seed) {
  if (n >= list.length) return list;
  const rest = list.slice(1, -1), r = rng(seed), pick = [];
  while (pick.length < Math.max(0, n - 2) && rest.length) pick.push(rest.splice(Math.floor(r() * rest.length), 1)[0]);
  return list.filter(x => x === list[0] || x === list.at(-1) || pick.includes(x)).slice(0, Math.max(n, 1));
}
const snap = root => root.evaluate(el => {
  const dg = el.querySelector('.dg'), win = el.querySelector('.sv-window'), box = x => { const b = x.getBoundingClientRect(); return {left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width}; };
  const cur = el.querySelector('.sv-line[aria-current="step"]'), count = /stage (\d+) of (\d+)/.exec(dg?.querySelector('.dg-stage-count')?.textContent ?? '');
  return {state: el.dataset.state, step: Number(el.dataset.step), dgStep: Number(dg?.dataset.step ?? -1), stage: Number(dg?.dataset.stage ?? -1), live: dg?.dataset.live,
    stageOf: count ? [Number(count[1]), Number(count[2])] : null, label: dg?.querySelector('.dg-stage-label')?.textContent ?? '', note: dg?.querySelector('.dg-note')?.textContent ?? '',
    caption: dg?.querySelector('.dg-caption')?.textContent ?? '', alts: [...(dg?.querySelectorAll('svg[role=img]') ?? [])].map(s => s.getAttribute('aria-label') ?? ''),
    svgs: [...(dg?.querySelectorAll('svg') ?? [])].map(box), dg: dg && box(dg), win: win && box(win), line: cur && box(cur), sticky: dg ? getComputedStyle(dg).position : '',
    overflow: document.documentElement.scrollWidth - innerWidth, vh: innerHeight};
});

export async function checkPage(browser, url, width, maxSteps, add) {
  const context = await browser.newContext({viewport: {width, height: width < 600 ? 844 : 900}});
  await context.addInitScript(() => { try { localStorage.setItem('egtry.simple.speed', 'fast'); } catch {} });
  const page = await context.newPage(), noise = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => noise.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') noise.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); });
  const at = `${new URL(url).pathname} @${width}`;
  let ported = false;
  try {
    const response = await page.goto(url);
    add(response.status() === 200, `${at}: HTTP ${response.status()}`);
    const total = await page.locator('.sv[data-example]').count(), withDiagram = await page.locator('.sv[data-example][data-diagram]').count();
    if (!withDiagram) { await context.close(); return {ported: false}; }
    ported = true;
    add(total >= 3 && withDiagram === total, `${at}: ${withDiagram} of ${total} examples have a diagram (at least 3, all of them)`);
    await page.waitForFunction(() => [...document.querySelectorAll('.sv[data-example]')].every(el => el.dataset.state === 'ready'));
    add(await page.locator('link[rel=stylesheet][href*="diagram.css"]').count() === 1, `${at}: the diagram stylesheet is linked`);
    for (let n = 0; n < total; n++) {
      const root = page.locator('.sv[data-example]').nth(n), id = await root.getAttribute('data-example'), ex = `${at} ${id}`;
      await root.scrollIntoViewIfNeeded();
      let s = await snap(root);
      add(!!s.dg && s.live === '0' && s.svgs.length > 0 && s.note.length > 10, `${ex}: before Run the panel shows a picture and a hint`);
      add(s.overflow <= 1, `${ex}: sideways overflow ${s.overflow}px`);
      if (width >= 1000) add(s.dg.left >= s.win.right - 1 && Math.abs(s.dg.top - s.win.top) <= 4, `${ex}: the diagram is beside the code`);
      else add(s.dg.top <= s.win.top && s.dg.left <= s.win.left + 1 && s.sticky === 'sticky', `${ex}: the diagram is above the code and sticky`);
      const pictures = new Set(), stages = [], notes = new Set(), problems = [];
      let steps = 0, captions = 0;
      for (; steps < maxSteps; steps++) {
        await root.locator('.sv-step').click();
        s = await snap(root);
        if (s.state === 'ended') break;
        const k = steps + 1;
        if (s.step !== k || s.dgStep !== k) problems.push(`step ${k}: viewer at ${s.step}, panel at ${s.dgStep}`);
        if (!s.stageOf || s.stageOf[0] !== s.stage) problems.push(`step ${k}: stage counter "${s.stageOf}" and data-stage ${s.stage} disagree`);
        if (stages.at(-1) !== s.stage) { stages.push(s.stage); if (!s.label || s.note.length < 5) problems.push(`stage ${s.stage}: no label or note`); notes.add(s.note); }
        pictures.add(s.alts.join(' | '));
        if (s.caption) captions++;
        if (s.alts.some(a => !a || /undefined|NaN|\[object/.test(a))) problems.push(`step ${k}: a picture has no proper text alternative`);
        if (s.svgs.some(g => g.right > s.dg.right + 1 || g.width < 40)) problems.push(`step ${k}: a picture is cut off or collapsed`);
        if (s.overflow > 1) problems.push(`step ${k}: sideways overflow ${s.overflow}px`);
        if (s.line && (s.line.top < -1 || s.line.bottom > s.vh + 1)) problems.push(`step ${k}: the executing line is outside the viewport`);
        if (width < 1000 && s.line && s.dg.top <= 1 && s.line.top < s.dg.bottom - 1) problems.push(`step ${k}: the executing line is under the sticky diagram`);
      }
      const n_stages = s.stageOf?.[1] ?? stages.length;
      add(s.state === 'ended' && steps > 3, `${ex}: stepping reaches the end (${steps} steps, state ${s.state})`);
      add(problems.length === 0, `${ex}: ${problems.length} step problem(s): ${problems.slice(0, 3).join('; ')}`);
      add(pictures.size >= 3 && captions >= 2, `${ex}: the diagram changes across steps (${pictures.size} different pictures, ${captions} captions)`);
      add(n_stages >= 2 && n_stages <= 16 && JSON.stringify(stages) === JSON.stringify(Array.from({length: n_stages}, (_, i) => i + 1)), `${ex}: stages run 1..${n_stages} in order (seen ${stages.join(',')})`);
      add(notes.size >= Math.min(2, n_stages), `${ex}: stages have their own notes (${notes.size} different)`);
      // stage buttons: after the end ▶ restarts at stage 1, then one stage per press; ◀ goes back
      const seen = [];
      for (let i = 0; i < n_stages; i++) { await root.locator('.dg-next').click(); await page.waitForTimeout(40); s = await snap(root); seen.push(s.stage); }
      add(JSON.stringify(seen) === JSON.stringify(Array.from({length: n_stages}, (_, i) => i + 1)) && s.state === 'stepping', `${ex}: Stage ▶ visits every stage (${seen.join(',')})`);
      add(await root.locator('.dg-next').isDisabled(), `${ex}: Stage ▶ is disabled in the last stage`);
      await root.locator('.dg-prev').click(); await page.waitForTimeout(40); s = await snap(root);
      add(s.stage === Math.max(1, n_stages - 1), `${ex}: ◀ Stage goes back one stage (now ${s.stage})`);
      await root.locator('.sv-edit-btn').click().catch(() => {});
    }
    add(noise.length === 0, `${at}: console errors or failed requests: ${noise.slice(0, 3).join('; ')}`);
  } catch (error) { add(false, `${at}: ${String(error?.message ?? error).split('\n')[0]}`); }
  await context.close();
  return {ported};
}

async function main() {
  const o = options(process.argv.slice(2)), origin = (o.origin ?? `https://${o.host}`).replace(/\/$/, ''), bookUrl = `${origin}/${o.book}/`;
  const checks = [], add = (ok, name) => { checks.push({ok: !!ok, name}); if (!ok) console.log('FAIL ' + name); };
  const res = await fetch(bookUrl), html = res.ok ? await res.text() : '';
  add(res.status === 200, `${bookUrl}: HTTP ${res.status}`);
  const slugs = [...new Set([...html.matchAll(/href="(?:\.\/)?([a-z0-9][a-z0-9_-]*)\/"/g)].map(m => m[1]))];
  add(slugs.length === Number(o['expect-pages']), `book index lists ${slugs.length} pages (expected ${o['expect-pages']})`);
  const chosen = o.pages === 'all' ? slugs : sample(slugs, Number(o.pages), Number(o.seed));
  const browser = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
  const notPorted = [], ported = [];
  for (const slug of chosen) {
    const before = checks.length;
    let state;
    for (const width of [1280, 390]) { state = await checkPage(browser, `${bookUrl}${slug}/`, width, Number(o['max-steps']), add); if (!state.ported) break; }
    if (state.ported) ported.push(slug); else { notPorted.push(slug); if (o['require-all']) add(false, `${slug}: no diagram on the page (not ported yet)`); }
    console.log(`${state.ported ? (checks.slice(before).every(c => c.ok) ? 'PASS' : 'FAIL') : 'SKIP (no diagram yet)'} ${slug}  ${checks.slice(before).filter(c => c.ok).length}/${checks.length - before}`);
  }
  await browser.close();
  add(ported.length > 0, `at least one page of the sample has a diagram (${ported.length})`);
  const failed = checks.filter(c => !c.ok), report = {suite: 'egtry-dsa', book: o.book, origin, chrome: 'playwright chromium', finished: new Date().toISOString(), pages: chosen.length, ported, notPorted, checks: checks.length, failed: failed.length, results: checks};
  const file = o.report ?? path.join(here, 'work', `dsa_report_${o.book}.json`);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`${failed.length ? 'FAIL' : 'PASS'} ${o.book} @ ${origin}: ${checks.length - failed.length}/${checks.length} checks, ${ported.length} page(s) with diagrams, ${notPorted.length} not ported; report ${file}`);
  process.exit(failed.length ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(2); });
