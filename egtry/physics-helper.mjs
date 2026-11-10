#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { workedReplay, splitAnswer, quantitySolver } from './physics-checks.mjs';

// Public DOM contract; --selectors can adapt a framework without weakening checks.
const defaults = {
  model: '[data-physics-model], .physics-model',
  solver: '[data-physics-solver], [data-physics-quantity]', parameter: '[data-quantity-parameter], .ph-controls input[type="number"]', result: '[data-quantity-result], .ph-measure',
  staticParameter: '.ph-controls input[type="number"], [data-quantity-parameter]', staticResult: '.ph-measure, [data-quantity-result]',
  canvas: 'canvas', play: '[data-action="play"], .ph-play',
  pause: '[data-action="pause"], [data-action="play"], .ph-play',
  step: '[data-action="step"], .ph-step',
  exercise: '[data-physics-exercise], .physics-exercise',
  input: '[data-answer-input], input[type="number"], input[type="text"]',
  check: '[data-action="check"], .ph-check', next: '[data-action="next"], .ph-next',
  problem: '[data-problem], .ph-problem',
  solution: '[data-worked-solution], .ph-solution',
  modelWorked: '.ph-worked, [data-model-worked]',
  replay: '.mb-player', replayStep: '.bb-step', replayLine: '.bb-line', replayNote: '.bb-note',
  answer: '[data-solution-answer]', feedback: '[role="status"], .ph-feedback',
};
function options(args) {
  const out = { book: 'mechanics', host: 'www.egtry.com', 'v1-host': 'v1.egtry.com', pages: 'all', seed: '731' };
  const keys = new Set([...Object.keys(out), 'report', 'selectors', 'out-dir', 'scenarios']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('physics.lms --book SLUG --host HOST [--v1-host HOST] [--pages N|all] [--seed N] [--selectors FILE] [--report FILE] [--out-dir DIR] [--scenarios FILE]'); process.exit(0); }
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !keys.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Invalid option: ${args[i]}`);
    out[key] = args[++i];
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(out.book)) throw Error('Invalid book slug');
  if (out.pages !== 'all' && !/^[1-9][0-9]*$/.test(out.pages)) throw Error('--pages must be all or a positive integer');
  if (!/^\d+$/.test(out.seed)) throw Error('--seed must be a nonnegative integer');
  return out;
}
const origin = value => new URL(value.includes('://') ? value : `https://${value}`).origin;
export async function runPhysicsQA(opt) {
  const selectors = { ...defaults, ...(opt.selectors ? JSON.parse(await fs.readFile(opt.selectors, 'utf8')) : {}) };
  const scenarios = opt.scenarios ? JSON.parse(await fs.readFile(opt.scenarios, 'utf8')) : {};
  const casesFor = async root => {
    const config = await root.evaluate(el => JSON.parse(el.closest('.ph')?.querySelector('.ph-data')?.textContent || '{}'));
    return scenarios[config.family] || [];
  };
  const base = origin(opt.host), legacy = origin(opt['v1-host']), prefix = `/${opt.book}/`;
  const hashFile = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const helperSha256 = await hashFile(fileURLToPath(import.meta.url));
  const checksSha256 = await hashFile(new URL('./physics-checks.mjs', import.meta.url));
  const scenarioSource = opt.scenarios ? {file: opt.scenarios, sha256: await hashFile(opt.scenarios), families: Object.keys(scenarios)} : null;
  const report = { helperSha256, checksSha256, scenarioSource, suite: 'egtry-physics', timestamp: new Date().toISOString(), book: opt.book, host: base, legacy, seed: opt.seed, checks: [], legacySlugs: [], targetSlugs: [], testedSlugs: [] };
  function check(ok, name, detail = '') {
    report.checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  }
  async function attempt(name, fn) {
    try { await fn(); } catch (e) { check(false, name, e.message); }
  }
  function require(ok, message) { if (!ok) throw Error(message); }
  const replay = scope => workedReplay(scope, {player: selectors.replay, steps: selectors.replayStep, line: selectors.replayLine, note: selectors.replayNote});
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const index = await context.newPage();
    index.setDefaultTimeout(7000);
    let indexErrors = [];
    index.on('console', m => { if (m.type() === 'error') indexErrors.push(`console: ${m.text()}`); });
    index.on('pageerror', e => indexErrors.push(`pageerror: ${e.message}`));
    index.on('response', r => { if (r.status() >= 400) indexErrors.push(`HTTP ${r.status()} ${r.url()}`); });
    index.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') indexErrors.push(`request: ${r.url()} ${r.failure()?.errorText}`); });
    async function discover(host, label) {
      indexErrors = [];
      const response = await index.goto(host + prefix, { waitUntil: 'networkidle', timeout: 30000 });
      require(response?.status() === 200, `${label} index HTTP ${response?.status()}`);
      require(await index.title() && await index.locator('h1').count(), `${label}: missing title/h1`);
      const links = await index.locator('a[href]').evaluateAll(els => els.map(a => ({ path: new URL(a.href).pathname, origin: new URL(a.href).origin })));
      const paths = [...new Set(links.filter(l => l.path.startsWith(prefix) && l.path !== prefix && /^\/[\w-]+\/[\w-]+\/$/.test(l.path) && !l.path.endsWith('/playground/')).map(l => l.path))];
      require(paths.length > 0, `${label}: no lesson links`);
      if (label === 'Target') check(!indexErrors.length, 'Target index console/network', indexErrors.join('; ') || '0 errors');
      check(true, `${label} index discovery`, `${paths.length} lesson slugs`);
      return { paths, links };
    }
    const old = await discover(legacy, 'Legacy');
    const target = await discover(base, 'Target');
    report.legacySlugs = old.paths; report.targetSlugs = target.paths;
    const missing = old.paths.filter(p => !target.paths.includes(p));
    check(!missing.length, 'Index lists every old slug', missing.length ? missing.join(', ') : `${old.paths.length}/${old.paths.length}`);
    const offsite = target.links.filter(l => old.paths.includes(l.path) && l.origin !== base);
    check(!offsite.length, 'Old lesson links stay on target host', JSON.stringify(offsite));
    const all = [...new Set([...old.paths, ...target.paths])];
    // HTTP coverage is exhaustive even when the browser sample is limited.
    for (const lesson of all) await attempt(`HTTP ${lesson}`, async () => {
      const response = await context.request.get(base + lesson, { timeout: 20000 });
      check(response.status() === 200 && new URL(response.url()).pathname === lesson && new URL(response.url()).origin === base, `HTTP ${lesson}`, `${response.status()} ${response.url()}`);
      await response.dispose();
    });
    let selected = all;
    if (opt.pages !== 'all' && Number(opt.pages) < all.length) {
      const n = Math.min(all.length, Math.max(2, Number(opt.pages)));
      let state = Number(opt.seed) || 1;
      const interior = all.slice(1, -1);
      for (let i = interior.length - 1; i > 0; i--) { state = (state * 16807) % 2147483647; const j = state % (i + 1); [interior[i], interior[j]] = [interior[j], interior[i]]; }
      const picked = new Set([all[0], all.at(-1), ...interior.slice(0, n - 2)]);
      selected = all.filter(p => picked.has(p));
    }
    report.testedSlugs = selected;
    report.coverage = selected.length === all.length ? 'all-pages' : 'sample-only';
    check(true, 'Browser coverage', `${report.coverage}: ${selected.length}/${all.length} pages, both 1280 and 390`);
    for (const width of [1280, 390]) {
      await index.setViewportSize({ width, height: 900 });
      await attempt(`Index layout ${width}`, async () => {
        indexErrors = [];
        await index.goto(base + prefix, { waitUntil: 'networkidle' });
        check(!indexErrors.length, `Index console/network ${width}`, indexErrors.join('; ') || '0 errors');
        check(await index.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Index layout ${width}`, 'no horizontal overflow');
      });
      for (const lesson of selected) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 900 }); page.setDefaultTimeout(4000);
        const errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
        page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
        page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
        page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`request: ${r.url()} ${r.failure()?.errorText}`); });
        const label = `${lesson} @${width}`;
        await attempt(`Load ${label}`, async () => {
          const response = await page.goto(`${base}${lesson}?seed=${opt.seed}`, { waitUntil: 'networkidle', timeout: 30000 });
          require(response?.status() === 200, `HTTP ${response?.status()}`);
          check(Boolean(await page.title()) && Boolean(await page.locator('h1').count()), `Metadata ${label}`, 'title and h1');
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Layout ${label}`, 'no horizontal overflow');
          const models = page.locator(selectors.model);
          const modelCount = await models.count();
          const solvers = page.locator(selectors.solver), solverCount = await solvers.count();
          check(modelCount + solverCount > 0, `Model present ${label}`, `${modelCount} time models, ${solverCount} quantity solvers`);
          for (let q = 0; q < solverCount; q++) await attempt(`Quantity solver ${q + 1} ${label}`, async () => {
            const evidence = await quantitySolver(solvers.nth(q), replay, {parameter: selectors.parameter, result: selectors.result, scenarios: await casesFor(solvers.nth(q))});
            check(true, `Quantity parameters/worked steps ${q + 1} ${label}`, JSON.stringify(evidence));
          });
          for (let m = 0; m < modelCount; m++) await attempt(`Model ${m + 1} ${label}`, async () => {
            const model = models.nth(m), canvas = model.locator(selectors.canvas).first();
            await canvas.waitFor({ state: 'visible' });
            const pixels = async () => canvas.evaluate(el => {
              const ctx = el.getContext('2d');
              if (!ctx) throw Error('Expected Canvas 2D model');
              const bytes = ctx.getImageData(0, 0, el.width, el.height).data;
              let hash = 2166136261, varied = 0;
              for (let i = 0; i < bytes.length; i += 4) {
                if (bytes[i] !== bytes[0] || bytes[i+1] !== bytes[1] || bytes[i+2] !== bytes[2] || bytes[i+3] !== bytes[3]) varied++;
                for (let j = 0; j < 4; j++) hash = Math.imul(hash ^ bytes[i+j], 16777619) >>> 0;
              }
              return { hash, varied, width: el.width, height: el.height };
            });
            const before = await pixels();
            require(before.varied > 20 && before.width > 20 && before.height > 20, `Blank canvas: ${JSON.stringify(before)}`);
            check(true, `Canvas nonblank ${m + 1} ${label}`, JSON.stringify(before));
            const mode = await model.getAttribute('data-model-mode');
            if (mode === 'static' || ['quantity', 'static'].includes(await model.getAttribute('data-model-kind'))) {
              const evidence = await quantitySolver(model, replay, {parameter: selectors.staticParameter, result: selectors.staticResult, observe: async () => (await pixels()).hash, scenarios: await casesFor(model)});
              check(true, `Static parameter/result/replay ${m + 1} ${label}`, JSON.stringify(evidence));
              return;
            }
            const play = model.locator(selectors.play).first();
            await play.click();
            const pause = model.locator(selectors.pause).first();
            require(/pause/i.test(await pause.innerText()) || await pause.getAttribute('aria-pressed') === 'true', 'Play did not enter playing state');
            await page.waitForTimeout(350);
            const running1 = await pixels(); await page.waitForTimeout(350); const running2 = await pixels();
            check(running1.hash !== running2.hash, `Animation pixels ${m + 1} ${label}`, `${running1.hash} -> ${running2.hash}`);
            await pause.click(); await page.waitForTimeout(150);
            const paused1 = await pixels(); await page.waitForTimeout(250); const paused2 = await pixels();
            check(paused1.hash === paused2.hash, `Pause stable ${m + 1} ${label}`, `${paused1.hash} -> ${paused2.hash}`);
            await model.locator(selectors.step).first().click(); await page.waitForTimeout(150);
            const stepped = await pixels();
            check(stepped.hash !== paused2.hash, `Step advances ${m + 1} ${label}`, `${paused2.hash} -> ${stepped.hash}`);
            await page.waitForTimeout(200);
            check((await pixels()).hash === stepped.hash, `Step stays paused ${m + 1} ${label}`, 'one step only');
            const lines = await replay(model.locator(selectors.modelWorked).first());
            check(true, `Model worked replay ${m + 1} ${label}`, JSON.stringify(lines));
          });
          const exercises = page.locator(selectors.exercise), exerciseCount = await exercises.count();
          check(exerciseCount > 0, `Exercise present ${label}`, `${exerciseCount} exercises`);
          for (let e = 0; e < exerciseCount; e++) await attempt(`Exercise ${e + 1} ${label}`, async () => {
            const ex = exercises.nth(e), input = ex.locator(selectors.input).first();
            const problem = () => ex.locator(selectors.problem).first().innerText();
            const initial = await problem(); require(initial.trim(), 'Empty problem');
            await input.fill('9.87654321e99'); await ex.locator(selectors.check).first().click();
            const solution = ex.locator(selectors.solution).first();
            await solution.waitFor({ state: 'visible' });
            require(['wrong', 'shown'].includes(await ex.getAttribute('data-state')), 'Wrong answer not marked wrong/shown');
            const worked = await replay(solution);
            check(true, `Wrong answer worked solution ${e + 1} ${label}`, JSON.stringify(worked));
            const answerNode = solution.locator(selectors.answer).first();
            require(await answerNode.isVisible(), 'Worked answer is hidden');
            const answer = await answerNode.getAttribute('data-solution-answer') || (await answerNode.innerText()).trim();
            const {value, unit} = splitAnswer(answer);
            const visibleAnswer = splitAnswer((await answerNode.innerText()).replace(/^Answer:\s*/i, ''));
            require(visibleAnswer.value === value && visibleAnswer.unit === unit, 'Worked answer attribute disagrees with visible answer');
            // A dimensionally valid wrong value must fail, independently of syntax rejection.
            await page.reload({waitUntil: 'networkidle'});
            require(await problem() === initial, 'Seed did not reproduce the same problem');
            const wrong = `${value + Math.max(1, Math.abs(value)) * 10} ${unit}`;
            await input.fill(wrong); await ex.locator(selectors.check).first().click();
            require(['wrong', 'shown'].includes(await ex.getAttribute('data-state')), 'Numerically wrong answer with valid units was accepted');
            await ex.locator(selectors.solution).first().waitFor({state: 'visible'});
            check(true, `Valid-unit wrong answer rejected ${e + 1} ${label}`, wrong);
            // Same numeric answer with an incompatible dimension must also fail.
            await page.reload({waitUntil: 'networkidle'});
            const wrongUnit = ['s','min','ms','us','ns','h','day','year'].includes(unit) ? 'm' : 's';
            await input.fill(`${value} ${wrongUnit}`); await ex.locator(selectors.check).first().click();
            require(['wrong', 'shown'].includes(await ex.getAttribute('data-state')), 'Answer with incompatible units was accepted');
            check(true, `Wrong dimension rejected ${e + 1} ${label}`, `${value} ${wrongUnit}`);
            // Reload the same seeded problem so a revealed solution cannot count as a right answer.
            await page.reload({ waitUntil: 'networkidle' });
            require(await problem() === initial, 'Seed did not reproduce the same problem');
            await input.fill(answer); await ex.locator(selectors.check).first().click();
            await page.waitForFunction(({ selector, n }) => document.querySelectorAll(selector)[n]?.dataset.state === 'right', { selector: selectors.exercise, n: e }, { timeout: 4000 });
            const feedback = await ex.locator(selectors.feedback).allTextContents();
            check(true, `Right answer accepted ${e + 1} ${label}`, `${answer}; ${feedback.join(' ')}`);
            await ex.locator(selectors.next).first().click();
            require(await problem() !== initial, 'Next did not change problem');
            check(true, `Next changes problem ${e + 1} ${label}`, (await problem()).slice(0, 180));
          });
        });
        check(!errors.length, `Console/network ${label}`, errors.length ? errors.join('; ') : '0 console, page or network errors');
        await page.close();
      }
    }
    await context.close();
  } catch (e) { check(false, 'Suite execution', e.stack || e.message); }
  finally { if (browser) await browser.close(); }
  report.passed = report.checks.filter(c => c.status === 'PASS').length;
  report.failed = report.checks.filter(c => c.status === 'FAIL').length;
  report.status = report.failed ? 'FAIL' : 'PASS';
  const dir = opt['out-dir'] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'work');
  await fs.mkdir(dir, { recursive: true });
  const stem = path.join(dir, `physics_report_${opt.book}`);
  await fs.writeFile(stem + '.json', JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(stem + '.txt', report.checks.map(c => `[${c.status}] ${c.name}: ${c.detail}`).join('\n') + '\n');
  if (opt.report) {
    const escape = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
    const markdown = `# QA Report: Physics book ${opt.book}\n\n- Date: ${report.timestamp}\n- Target: ${base}${prefix}\n- Legacy: ${legacy}${prefix}\n- Suite: lmwebtest/egtry/physics.lms + physics-helper.mjs (Playwright Chrome)\n- Seed: ${opt.seed}\n- Coverage: ${report.coverage || 'incomplete'}; ${report.testedSlugs.length} browser pages at 1280 and 390\n- **Overall Verdict**: **${report.status}** (${report.passed} passed, ${report.failed} failed)\n\n| Check | Verdict | Evidence |\n|---|---|---|\n` + report.checks.map(c => `| ${escape(c.name)} | ${c.status} | ${escape(c.detail)} |`).join('\n') + '\n';
    await fs.mkdir(path.dirname(path.resolve(opt.report)), { recursive: true }); await fs.writeFile(opt.report, markdown);
  }
  console.log(`Overall Verdict: ${report.status} (${report.passed} passed, ${report.failed} failed); ${stem}.json`);
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = await runPhysicsQA(options(process.argv.slice(2))); process.exitCode = report.failed ? 1 : 0; }
  catch (e) { console.error(e.message); process.exitCode = 2; }
}
