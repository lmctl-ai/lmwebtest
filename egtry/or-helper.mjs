#!/usr/bin/env node
// Operations-research book QA (egtry R45): every lesson has traced brute-force programs with a growth table and models that
// OR-Tools (WebAssembly) solves in the page.
//   node or-helper.mjs --book integer-programming --host www.egtry.com [--origin http://127.0.0.1:8099] [--pages N|all] [--seed N]
//                      [--expect-pages N] [--all-models] [--report FILE]
// Black box: only the public DOM contract of the page is used (interpreters docs/design/operations-research/01-track-design.md §3):
//   model block     .orx[data-example]   data-state static -> ready -> solving -> live | failed
//                   .orx-data (JSON: output, stats, parameters, exercise {expect, solution}), .orx-poster (img, alt), .orx-canvas,
//                   textarea.orx-model, button.orx-run, button.orx-reset, .orx-status, .orx-message, pre.orx-output, .orx-stats,
//                   input[data-parameter], .orx-exercise[data-done], button.orx-check, .orx-verdict[data-pass]
//   growth table    figure.org[data-growth]  tbody tr (measured), tr.org-far (the formula beyond reach), .org-count, .org-solver
//   programs        .sv[data-example]  (the simple viewer; its own suites cover it)
// Checks per page at 1280 and 390: HTTP 200; before any click the page is complete (picture, model text, printed lines, a
// statistics line with a solver status, a growth table with measured and far rows whose counts grow) and NO runtime file was
// requested; one Solve fetches the runtime (lmlive-or.wasm as application/wasm), ends live, draws the canvas and prints the
// recorded lines again; a slider solves again; a broken model reports its line; the exercise's authored model fails Check with
// reasons and its reference solution passes; no sideways overflow, no console error, no failed request. Default: the first
// model, the first slider and the first exercise of a page; --all-models solves every model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {sample} from './dsa-helper.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function options(args) {
  const out = {book: 'integer-programming', host: 'www.egtry.com', pages: 'all', seed: '731', 'expect-pages': ''};
  const keys = new Set([...Object.keys(out), 'origin', 'report']), flags = new Set(['all-models']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('or.lms --book SLUG --host HOST [--origin URL] [--pages N|all] [--seed N] [--expect-pages N] [--all-models] [--report FILE]'); process.exit(0); }
    const key = args[i].replace(/^--/, '');
    if (flags.has(key)) { out[key] = true; continue; }
    if (!args[i].startsWith('--') || !keys.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Invalid option: ${args[i]}`);
    out[key] = args[++i];
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(out.book)) throw Error('Invalid book slug');
  return out;
}
const STATUS = /(CP-SAT|GLOP|SAT|PDLP) (OPTIMAL|FEASIBLE|INFEASIBLE|UNBOUNDED)/;
/** The counts of a growth table as BigInt, read from its cells (`1,048,576`; `1.27 × 10^30` is skipped). */
export const counts = cells => cells.map(t => /^[\d,]+$/.test(t.trim()) ? BigInt(t.replace(/,/g, '')) : null);
const state = (page, id) => page.locator(`.orx[data-example="${id}"]`).getAttribute('data-state');
const settled = (page, id) => page.waitForFunction(id => ['live', 'failed'].includes(document.querySelector(`.orx[data-example="${id}"]`).dataset.state), id, {timeout: 90000});
const ink = canvas => canvas.evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 720) n++; return n; });

export async function checkPage(browser, url, width, o, add) {
  const context = await browser.newContext({viewport: {width, height: width < 600 ? 844 : 900}});   // fresh: exercise progress is in localStorage
  const page = await context.newPage(), noise = [], requested = [], wasm = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => noise.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') noise.push('console: ' + m.text()); });
  page.on('request', r => requested.push(new URL(r.url()).pathname));
  page.on('response', r => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); if (/lmlive-or\.wasm$/.test(new URL(r.url()).pathname)) wasm.push({status: r.status(), type: r.headers()['content-type'] ?? '', encoding: r.headers()['content-encoding'] ?? ''}); });
  const at = `${new URL(url).pathname} @${width}`;
  let models = 0;
  try {
    const response = await page.goto(url, {waitUntil: 'networkidle'});
    add(response.status() === 200, `${at}: HTTP ${response.status()}`);
    models = await page.locator('.orx[data-example]').count();
    if (!models) { await context.close(); return {models: 0}; }
    await page.waitForFunction(() => [...document.querySelectorAll('.orx[data-example]')].every(el => el.dataset.state === 'ready'));
    add(!requested.some(p => /\/play\/or\/rt\//.test(p)), `${at}: no runtime file is requested before the first Solve`);
    const blocks = await page.locator('.orx[data-example]').evaluateAll(list => list.map(el => { const d = JSON.parse(el.querySelector('.orx-data').textContent), img = el.querySelector('.orx-poster'); return {id: el.dataset.example, output: d.output, parameters: d.parameters, exercise: d.exercise, view: d.view !== null, shownOutput: el.querySelector('.orx-output')?.textContent ?? '', stats: el.querySelector('.orx-stats')?.textContent ?? '', model: el.querySelector('.orx-model')?.value ?? '', poster: img ? {ok: img.complete && img.naturalWidth > 0, alt: img.alt} : null, question: el.querySelector('.orx-question')?.textContent ?? ''}; }));
    const programs = await page.locator('.sv[data-example]').count(), growth = await page.locator('figure.org[data-growth]').count();
    add(programs >= 2 && growth >= 1, `${at}: ${programs} traced programs and ${growth} growth table(s) (at least 2 and 1)`);
    add(blocks.some(b => b.view) && blocks.some(b => b.exercise), `${at}: a model with a picture and a model with an exercise`);
    for (const b of blocks) {
      add(b.shownOutput === b.output.join('\n') && b.output.length > 0, `${at} ${b.id}: the printed lines are in the page`);
      add(STATUS.test(b.stats), `${at} ${b.id}: a statistics line with a solver status ("${b.stats.slice(0, 60)}")`);
      add(b.model.split('\n').length >= 3 && !/experience\(|scene\.end\(/.test(b.model), `${at} ${b.id}: the model text is in the editor, without scene set-up`);
      if (b.view) add(b.poster?.ok && b.poster.alt.length >= 20, `${at} ${b.id}: the picture loads and has a text alternative`);
      if (b.exercise) add(b.question.length >= 20 && (b.exercise.expect.status !== undefined || b.exercise.expect.objective !== undefined), `${at} ${b.id}: the exercise has a question and a solver expectation`);
    }
    for (let g = 0; g < growth; g++) {
      const figure = page.locator('figure.org[data-growth]').nth(g), id = await figure.getAttribute('data-growth');
      const measured = counts(await figure.locator('tbody tr:not(.org-far) .org-count').allTextContents()), far = await figure.locator('tbody tr.org-far').count();
      add(measured.length >= 3 && measured.every(v => v !== null) && measured.every((v, i) => i === 0 || v > measured[i - 1]), `${at} ${id}: ${measured.length} measured counts that grow (${measured.join(', ')})`);
      add(far >= 1, `${at} ${id}: the table goes beyond what was run (${far} far rows)`);
      add((await figure.locator('figcaption code').first().textContent()).trim().length > 0, `${at} ${id}: the formula is stated`);
    }
    add(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${at}: no sideways overflow before Solve`);

    const first = blocks.find(b => b.view) ?? blocks[0], withSlider = blocks.find(b => b.parameters.length), withExercise = blocks.find(b => b.exercise);
    const solve = async b => {
      const block = page.locator(`.orx[data-example="${b.id}"]`);
      await block.scrollIntoViewIfNeeded();
      await block.locator('.orx-run').click();
      await settled(page, b.id);
      const live = await state(page, b.id), out = await block.locator('.orx-output').textContent();
      add(live === 'live', `${at} ${b.id}: Solve ends live (state ${live}: ${live === 'failed' ? await block.locator('.orx-message').textContent() : await block.locator('.orx-status').textContent()})`);
      add(out === b.output.join('\n'), `${at} ${b.id}: the live solve prints the recorded lines`);
      add(STATUS.test(await block.locator('.orx-stats').textContent()), `${at} ${b.id}: the live statistics line names the solver status`);
      if (b.view) add(await ink(block.locator('.orx-canvas')) > 500, `${at} ${b.id}: the canvas is drawn`);
    };
    await solve(first);
    add(wasm.length >= 1 && wasm[0].status === 200 && /^application\/wasm/.test(wasm[0].type), `${at}: lmlive-or.wasm is served as application/wasm (${wasm[0]?.status} ${wasm[0]?.type} ${wasm[0]?.encoding})`);
    add(requested.some(p => /\/play\/or\/rt\/[0-9a-f]{12}\/embed\.js$/.test(p)), `${at}: the runtime comes from its digest directory`);
    if (o['all-models']) for (const b of blocks) if (b !== first) await solve(b);
    if (withSlider) {
      if (withSlider !== first && !o['all-models']) await solve(withSlider);
      const block = page.locator(`.orx[data-example="${withSlider.id}"]`), q = withSlider.parameters[0], other = q.value === q.max ? q.min : q.max;
      const slider = block.locator(`input[data-parameter="${q.name}"]`);
      await slider.evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }, other);
      await page.waitForFunction(([id, before]) => { const el = document.querySelector(`.orx[data-example="${id}"]`); return el.dataset.state === 'failed' || (el.dataset.state === 'live' && el.querySelector('.orx-output').textContent !== before); }, [withSlider.id, withSlider.output.join('\n')], {timeout: 90000}).catch(() => {});
      add(await state(page, withSlider.id) === 'live' && await block.locator('.orx-output').textContent() !== withSlider.output.join('\n'), `${at} ${withSlider.id}: slider ${q.name} = ${other} solves again with another result`);
      await block.locator('.orx-reset').click();
      await page.waitForFunction(([id, before]) => document.querySelector(`.orx[data-example="${id}"] .orx-output`).textContent === before, [withSlider.id, withSlider.output.join('\n')], {timeout: 90000}).catch(() => {});
      add(await block.locator('.orx-output').textContent() === withSlider.output.join('\n'), `${at} ${withSlider.id}: Start again restores the recorded result`);
    }
    {
      const block = page.locator(`.orx[data-example="${first.id}"]`), lines = first.model.split('\n'), cut = lines.findIndex(l => /\.solve\(\)/.test(l));
      await block.locator('.orx-model').fill([...lines.slice(0, cut), 'let broken = no_such_name + 1;', ...lines.slice(cut)].join('\n'));
      await block.locator('.orx-run').click();
      await page.waitForFunction(id => document.querySelector(`.orx[data-example="${id}"]`).dataset.state === 'failed', first.id, {timeout: 90000}).catch(() => {});
      const message = await block.locator('.orx-message').textContent().catch(() => '');
      add(await state(page, first.id) === 'failed' && new RegExp(`^Line ${cut + 1}: `).test(message), `${at} ${first.id}: a broken model reports its line ("${message.slice(0, 50)}")`);
      await block.locator('.orx-reset').click();
      await settled(page, first.id);
    }
    if (withExercise) {
      const block = page.locator(`.orx[data-example="${withExercise.id}"]`);
      await block.scrollIntoViewIfNeeded();
      await block.locator('.orx-check').click();
      await block.locator('.orx-verdict[data-pass]').waitFor({timeout: 90000}).catch(() => {});
      add(await block.locator('.orx-verdict').getAttribute('data-pass') === 'false' && await block.locator('.orx-verdict li').count() >= 1, `${at} ${withExercise.id}: the authored model fails Check and the reasons are listed`);
      await block.locator('.orx-model').fill(withExercise.exercise.solution);
      await block.locator('.orx-check').click();
      await block.locator('.orx-verdict[data-pass="true"]').waitFor({timeout: 90000}).catch(() => {});
      add(await block.locator('.orx-verdict').getAttribute('data-pass') === 'true' && await block.locator('.orx-exercise').getAttribute('data-done') === 'true', `${at} ${withExercise.id}: the reference solution passes Check`);
    }
    add(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${at}: no sideways overflow after solving`);
    add(noise.length === 0, `${at}: console errors or failed requests: ${noise.slice(0, 3).join('; ')}`);
  } catch (error) { add(false, `${at}: ${String(error?.message ?? error).split('\n')[0]}`); }
  await context.close();
  return {models};
}

async function main() {
  const o = options(process.argv.slice(2)), origin = (o.origin ?? `https://${o.host}`).replace(/\/$/, ''), bookUrl = `${origin}/${o.book}/`;
  const checks = [], add = (ok, name) => { checks.push({ok: !!ok, name}); if (!ok) console.log('FAIL ' + name); };
  const res = await fetch(bookUrl), html = res.ok ? await res.text() : '';
  add(res.status === 200, `${bookUrl}: HTTP ${res.status}`);
  const slugs = [...new Set([...html.matchAll(/href="(?:\.\/)?([a-z0-9][a-z0-9_-]*)\/"/g)].map(m => m[1]))];
  add(slugs.length >= 1 && (!o['expect-pages'] || slugs.length === Number(o['expect-pages'])), `book index lists ${slugs.length} pages${o['expect-pages'] ? ` (expected ${o['expect-pages']})` : ''}`);
  const chosen = o.pages === 'all' ? slugs : sample(slugs, Number(o.pages), Number(o.seed));
  const browser = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
  const passed = [];
  for (const slug of chosen) {
    const before = checks.length;
    for (const width of [1280, 390]) { const r = await checkPage(browser, `${bookUrl}${slug}/`, width, o, add); if (!r.models) { add(false, `${slug}: no model block on the page`); break; } }
    const ok = checks.slice(before).every(c => c.ok); if (ok) passed.push(slug);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${slug}  ${checks.slice(before).filter(c => c.ok).length}/${checks.length - before}`);
  }
  await browser.close();
  const failed = checks.filter(c => !c.ok), report = {suite: 'egtry-or', book: o.book, origin, chrome: 'playwright chromium', finished: new Date().toISOString(), pages: chosen.length, passed, checks: checks.length, failed: failed.length, results: checks};
  const file = o.report ?? path.join(here, 'work', `or_report_${o.book}.json`);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`${failed.length ? 'FAIL' : 'PASS'} ${o.book} @ ${origin}: ${checks.length - failed.length}/${checks.length} checks, ${passed.length}/${chosen.length} page(s); report ${file}`);
  process.exit(failed.length ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(2); });
