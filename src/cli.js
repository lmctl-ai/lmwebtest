#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

const help = `Usage:
  lmwebtest test <url> [--status 200] [--title "Exact title"] [--selector CSS] [--timeout 10000]
  lmwebtest screenshot <url> --out <file.png> [--no-js] [--timeout 10000]
  lmwebtest run [Playwright test options]

Checks HTTP status (default 200), console errors, uncaught page errors, failed
requests, HTTP resource errors, and broken images observed through page load.
--selector may be repeated; each selector must match a visible element.
Outputs JSON; exits 1 on failed checks and 2 on invalid arguments.
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'run') {
    const require = createRequire(import.meta.url);
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
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
    browser = await chromium.launch();
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
