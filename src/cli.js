#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { initSite, batchSites } from './sites.js';

const VERSION = '0.1.0';

export function checkBrowserError(error) {
  if (error && typeof error.message === 'string') {
    if (error.message.includes("Executable doesn't exist") || error.message.includes('playwright install')) {
      const friendly = new Error(
        'Playwright browsers are missing or out of date. Run "npm run browsers:install" (or "npx playwright install chromium") to install them.'
      );
      friendly.cause = error;
      return friendly;
    }
  }
  return error;
}

const help = `Usage:
  lmwebtest --version | -v
  lmwebtest --dsl-signatures | --lmcode-signatures
  lmwebtest --dsl-schema [--json] | --lmcode-schema [--json]
  lmwebtest --dsl <bytecode.dslb> | --lmcode <bytecode.dslb>
  lmwebtest test <url> [--status 200] [--title "Exact title"] [--selector CSS] [--timeout 10000]
  lmwebtest screenshot <url> --out <file.png> [--no-js] [--timeout 10000]
  lmwebtest init <site-name> [--url <url>]
  lmwebtest batch
  lmwebtest run --all
  lmwebtest run [site-id|file|dir] [Playwright test options]

LMScript DSL:
  Provides 'context web: Web' and 'context report: Report' for multi-step browser
  integration testing in .lms scripts, compiling against --dsl-schema.

Checks HTTP status (default 200), console errors, uncaught page errors, failed
requests, HTTP resource errors, and broken images observed through page load.
--selector may be repeated; each selector must match a visible element.
Outputs JSON; exits 1 on failed checks and 2 on invalid arguments.
`;

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...args] = argv;

  // --version
  if (command === '--version' || command === '-v') {
    process.stdout.write(`lmwebtest ${VERSION}\n`);
    process.exitCode = 0;
    return;
  }

  // --dsl-signatures / --lmcode-signatures
  if (command === '--dsl-signatures' || command === '--lmcode-signatures') {
    const { getCanonicalSignatures } = await import('./dsl/schema.js');
    process.stdout.write(getCanonicalSignatures());
    process.exitCode = 0;
    return;
  }

  // --dsl-schema / --lmcode-schema [--json]
  if (command === '--dsl-schema' || command === '--lmcode-schema') {
    const { SCHEMA_BYTES, getSchemaSummary } = await import('./dsl/schema.js');
    if (args.includes('--json')) {
      process.stdout.write(SCHEMA_BYTES);
      process.exitCode = 0;
      return;
    }
    process.stdout.write(getSchemaSummary());
    process.exitCode = 0;
    return;
  }

  // --dsl / --lmcode [FILE]
  if (command === '--dsl' || command === '--lmcode' || (command === '--dry-run' && (args[0] === '--dsl' || args[0] === '--lmcode'))) {
    const fileArg = command === '--dry-run' ? args[1] : args[0];
    if (!fileArg || fileArg.startsWith('--')) {
      console.error(JSON.stringify({ ok: false, phase: 'cli', code: 'CLI_INVALID_ARGUMENT', message: 'Missing bytecode file argument for --dsl' }));
      process.exitCode = 2;
      return;
    }
    const { executeDslFile } = await import('./dsl/vm.js');
    process.exitCode = await executeDslFile(fileArg);
    return;
  }

  const workspace = fileURLToPath(new URL('../', import.meta.url));
  if (command === 'init') {
    try { console.log(JSON.stringify(await initSite(workspace, args), null, 2)); }
    catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = ['EACCES', 'ENOSPC', 'EROFS'].includes(error.code) ? 1 : 2; }
    return;
  }
  if (command === 'batch' || (command === 'run' && args.includes('--all'))) {
    if ((command === 'batch' && args.length) || (command === 'run' && (args.length !== 1 || args[0] !== '--all'))) {
      console.error(JSON.stringify({ ok: false, error: 'Use batch or run --all without additional arguments' }));
      process.exitCode = 2;
      return;
    }
    const report = await batchSites(workspace);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  if (command === 'run') {
    const root = fileURLToPath(new URL('../', import.meta.url));
    let runnerArgs = [...args];
    try {
      const definitions = {};
      for (const name of ['config', 'grep', 'grep-invert', 'project', 'workers', 'timeout', 'retries', 'reporter', 'output', 'trace', 'max-failures', 'repeat-each', 'shard']) {
        definitions[name] = { type: 'string', multiple: name === 'project' };
      }
      for (const name of ['list', 'headed', 'debug', 'ui', 'help', 'forbid-only', 'fully-parallel', 'update-snapshots', 'quiet', 'pass-with-no-tests']) {
        definitions[name] = { type: 'boolean' };
      }
      definitions.config.short = 'c';
      definitions.grep.short = 'g';
      definitions.help.short = 'h';
      const { values, positionals, tokens } = parseArgs({ args, options: definitions, allowPositionals: true, tokens: true });
      for (const name of ['timeout', 'retries', 'max-failures', 'repeat-each']) {
        if (values[name] !== undefined && (!/^\d+$/.test(values[name]) || Number(values[name]) > 2147483647 || (name === 'repeat-each' && Number(values[name]) === 0))) {
          throw new Error(`Invalid --${name}`);
        }
      }
      if (values.workers !== undefined && !/^[1-9]\d*%?$/.test(values.workers)) throw new Error('Invalid --workers');
      if (values.trace !== undefined && !['on', 'off', 'on-first-retry', 'on-all-retries', 'retain-on-failure', 'retain-on-first-failure'].includes(values.trace)) throw new Error('Invalid --trace');
      if (values.shard !== undefined) {
        const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(values.shard);
        if (!match || Number(match[1]) > Number(match[2])) throw new Error('Invalid --shard');
      }
      const target = positionals[0];
      if (target && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target)) {
        const siteDir = join(root, 'sites', target);
        const site = await stat(siteDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (site?.isDirectory()) {
          if (values.config !== undefined) throw new Error('A site target cannot be combined with --config');
          const config = join(siteDir, 'playwright.config.ts');
          const configOk = await stat(config).then(s => s.isFile()).catch(() => false);
          if (!configOk) throw new Error(`Missing site config: ${config}`);
          const index = tokens.find(token => token.kind === 'positional').index;
          runnerArgs.splice(index, 1);
          runnerArgs.unshift('--config', config);
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 2;
      return;
    }
    const require = createRequire(import.meta.url);
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...runnerArgs], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code === 0 ? 0 : 1));
    });
    return;
  }
  if (!command || command === '--help' || command === '-h') {
    console.log(help);
    return;
  }
  let options;
  let url;
  try {
    if (!['test', 'screenshot'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const parsed = parseArgs({ args, allowPositionals: true, options: {
      status: { type: 'string', default: '200' }, title: { type: 'string' },
      selector: { type: 'string', multiple: true, default: [] },
      timeout: { type: 'string', default: '10000' }, out: { type: 'string' },
      'no-js': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
    } });
    options = parsed.values;
    if (options.help) { console.log(help); return; }
    if (parsed.positionals.length !== 1) throw new Error('Provide exactly one URL');
    url = new URL(parsed.positionals[0]);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use http or https');
    if (!/^\d+$/.test(options.timeout) || Number(options.timeout) < 1 || Number(options.timeout) > 2147483647) throw new Error('Timeout must be a positive integer up to 2147483647');
    if (!/^\d{3}$/.test(options.status) || Number(options.status) < 100 || Number(options.status) > 599) throw new Error('Status must be 100–599');
    if (command === 'screenshot' && !options.out) throw new Error('screenshot requires --out');
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 2;
    return;
  }
  let browser;
  const result = { ok: false, url: url.href, errors: [] };
  try {
    try {
      browser = await chromium.launch();
    } catch (launchErr) {
      throw checkBrowserError(launchErr);
    }
    const page = await browser.newPage({ javaScriptEnabled: !options['no-js'], viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(Number(options.timeout));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(`Console: ${message.text()}`); });
    page.on('pageerror', error => result.errors.push(`Page: ${error.message}`));
    page.on('requestfailed', request => result.errors.push(`Request: ${request.url()} (${request.failure()?.errorText})`));
    page.on('response', response => { if (response.status() >= 400) result.errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    const start = performance.now();
    const response = await page.goto(url.href, { waitUntil: 'load' });
    result.loadTimeMs = Math.round(performance.now() - start);
    result.status = response?.status() ?? null;
    result.title = await page.title();
    if (command === 'test') {
      if (result.status !== Number(options.status)) result.errors.push(`Expected status ${options.status}, got ${result.status}`);
      // An explicitly expected HTTP error is not itself a resource failure.
      if (result.status === Number(options.status) && result.status >= 400) {
        result.errors = result.errors.filter(error => error !== `HTTP ${result.status}: ${response.url()}`);
      }
      if (options.title !== undefined) await expect(page).toHaveTitle(options.title, { timeout: Number(options.timeout) });
      for (const selector of options.selector) await page.locator(selector).first().waitFor({ state: 'visible' });
      result.brokenImages = await page.locator('img').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth === 0).map(img => img.currentSrc || img.src));
      if (result.brokenImages.length) result.errors.push(`${result.brokenImages.length} broken image(s)`);
    } else {
      await mkdir(dirname(options.out), { recursive: true });
      await page.screenshot({ path: options.out, fullPage: true });
      result.screenshot = options.out;
    }
    result.ok = command === 'screenshot' || result.errors.length === 0;
  } catch (error) {
    result.errors.push(error.message);
  } finally {
    await browser?.close();
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
