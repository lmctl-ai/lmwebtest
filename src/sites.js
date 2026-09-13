import { mkdir, writeFile, readdir, stat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

export async function initSite(root, args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { url: { type: 'string', default: 'http://127.0.0.1:3000' } } });
  const site = positionals[0];
  if (positionals.length !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(site || '')) throw new Error('Provide one site name using lowercase letters, digits, and hyphens');
  const url = new URL(values.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use http or https');
  const directory = join(root, 'sites', site);
  await mkdir(join(root, 'sites'), { recursive: true });
  // Exclusive creation preserves existing consumer-authored workspaces.
  await mkdir(directory);
  const env = `${site.toUpperCase().replaceAll('-', '_')}_URL`;
  try {
    await writeFile(join(directory, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../../test-results/${site}',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.${env} || ${JSON.stringify(url.href)},
    browserName: 'chromium',
    headless: true,
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
`);
    await writeFile(join(directory, 'routes.spec.ts'), `import { test, expect } from '@playwright/test';

// ${site} team: you own and expand these test cases for your application's UI.
// Replace this generic starter selector and add your routes and expectations.
test('home smoke test', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
});
`);
    await writeFile(join(directory, 'README.md'), `# ${site} consumer workspace

The ${site} owner team authors and maintains the test cases here.
lmwebtest owns scaffolding, runner infrastructure, conventions and batch reports.

Default target: ${url.href}
Override with the ${env} environment variable.
Start your application, then run:

\`\`\`sh
lmwebtest run ${site}
lmwebtest batch
\`\`\`

Expand routes.spec.ts with your routes, titles, selectors and error checks.
The starter checks only HTTP 200 and a visible main element; it is not full coverage.
Artifacts: test-results/${site}/. See ../../docs/ONBOARDING.md.
`);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { ok: true, site, directory, url: url.href, env };
}

export async function batchSites(root) {
  const entries = await readdir(join(root, 'sites'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const sites = [];
  const require = createRequire(import.meta.url);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const config = join(root, 'sites', entry.name, 'playwright.config.ts');
    if (!entry.isDirectory() || !await stat(config).then(s => s.isFile()).catch(() => false)) continue;
    // Keep reporter data outside output directories that Playwright clears on startup.
    const temporary = await mkdtemp(join(tmpdir(), 'lmwebtest-report-'));
    const jsonPath = join(temporary, 'results.json');
    const result = { site: entry.name, ok: false, exitCode: 1, output: '', totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 };
    try {
      result.exitCode = await new Promise(resolve => {
        const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', config, '--output', join(root, 'test-results', entry.name), '--reporter', 'list,json'], {
          cwd: root,
          env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', data => { result.output += data.toString(); });
        child.stderr.on('data', data => { result.output += data.toString(); });
        child.once('error', error => { result.output += error.message; resolve(1); });
        child.once('close', code => resolve(code === 0 ? 0 : 1));
      });
      const report = JSON.parse(await readFile(jsonPath, 'utf8'));
      const stats = report.stats;
      if (!stats || !['expected', 'unexpected', 'flaky', 'skipped'].every(key => Number.isInteger(stats[key]) && stats[key] >= 0)) throw new Error('Invalid Playwright report statistics');
      result.passedTests = stats.expected + stats.flaky;
      result.failedTests = stats.unexpected;
      result.skippedTests = stats.skipped;
      result.totalTests = result.passedTests + result.failedTests + result.skippedTests;
      result.ok = result.exitCode === 0 && result.failedTests === 0 && !(report.errors?.length);
      if (!result.ok) result.exitCode = 1;
    } catch (error) {
      result.exitCode = 1;
      result.output += `\nReport error: ${error.message}`;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    sites.push(result);
  }
  const summary = { totalSites: sites.length, passedSites: sites.filter(site => site.ok).length, failedSites: sites.filter(site => !site.ok).length, totalTests: 0, passedTests: 0, failedTests: 0 };
  for (const site of sites) for (const key of ['totalTests', 'passedTests', 'failedTests']) summary[key] += site[key];
  const report = { ok: sites.every(site => site.ok), timestamp: new Date().toISOString(), summary, sites };
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(join(root, 'test-results', 'batch-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
