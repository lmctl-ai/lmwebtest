import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
async function run(...args: string[]) {
  try {
    const result = await exec(process.execPath, [cli, ...args]);
    return { code: 0, ...result };
  } catch (error: any) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('CLI reports title, status and load time', async ({ baseURL }) => {
  const result = await run('test', baseURL!, '--title', 'File Explorer', '--selector', '#file-table');
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: 200, title: 'File Explorer', errors: [] });
  expect(JSON.parse(result.stdout).loadTimeMs).toBeGreaterThanOrEqual(0);
});

test('CLI fails mismatched title and missing selector', async ({ baseURL }) => {
  for (const args of [['--title', 'Wrong'], ['--selector', '#missing']]) {
    const result = await run('test', baseURL!, ...args, '--timeout', '500');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  }
});

test('CLI fails HTTP errors', async ({ baseURL }) => {
  const result = await run('test', `${baseURL}/missing`);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout).status).toBe(404);
});

test('CLI writes a PNG screenshot without JavaScript', async ({ baseURL }, testInfo) => {
  const out = testInfo.outputPath('capture.png');
  const result = await run('screenshot', baseURL!, '--out', out, '--no-js');
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect((await readFile(out)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

test('CLI rejects invalid arguments', async () => {
  for (const args of [['test', 'file:///etc/hosts'], ['screenshot', 'http://localhost'], ['test', 'http://localhost', '--timeout', '0'], ['unknown'], ['run', '--unknown'], ['run', '--workers', '0'], ['run', '--timeout', '-1'], ['run', 'localweb', '--config', 'playwright.config.ts'], ['run', '--shard', '3/2']]) {
    expect((await run(...args)).code).toBe(2);
  }
});

test('CLI run delegates to the test runner', async () => {
  const result = await run('run', '--list');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('file-explorer.spec.ts');
  expect(result.stdout).not.toContain('routes.spec.ts');
  const site = await run('run', '--list', 'localweb');
  expect(site.code, site.stderr).toBe(0);
  expect(site.stdout).toContain('Total: 1 test');
  expect(site.stdout).toContain('routes.spec.ts');
  expect(site.stdout).not.toContain('file-explorer.spec.ts');
  const file = await run('run', 'tests/security.spec.ts', '--list');
  expect(file.code).toBe(0);
  expect(file.stdout).toContain('Total: 3 tests');
  const directory = await run('run', 'tests', '--list');
  expect(directory.code).toBe(0);
  expect(directory.stdout).toContain('Total: 19 tests');
  expect((await run('run', 'no-such-target', '--list')).code).toBe(1);
});


test('CLI reports a friendly error for a site without config', async () => {
  const sites = fileURLToPath(new URL('../sites/', import.meta.url));
  const directory = await mkdtemp(join(sites, 'missing-config-'));
  try {
    const result = await run('run', basename(directory));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`Missing site config: ${join(directory, 'playwright.config.ts')}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


async function isolatedWorkspace() {
  const root = await mkdtemp(fileURLToPath(new URL('../.cli-fixture-', import.meta.url)));
  await mkdir(join(root, 'src'));
  for (const file of ['cli.js', 'sites.js']) {
    await copyFile(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), join(root, 'src', file));
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  async function invoke(...args: string[]) {
    try {
      return { code: 0, ...await exec(process.execPath, [join(root, 'src/cli.js'), ...args]) };
    } catch (error: any) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }
  return { root, invoke };
}

test('CLI init scaffolds safely and validates input', async () => {
  const { root, invoke } = await isolatedWorkspace();
  try {
    const result = await invoke('init', 'sample-site', '--url', 'http://127.0.0.1:4567');
    expect(result.code, result.stderr).toBe(0);
    const config = join(root, 'sites/sample-site/playwright.config.ts');
    const original = await readFile(config, 'utf8');
    expect(original).toContain('process.env.SAMPLE_SITE_URL');
    expect(original).toContain('http://127.0.0.1:4567/');
    expect(await readFile(join(root, 'sites/sample-site/routes.spec.ts'), 'utf8')).toContain('home smoke test');
    expect(await readFile(join(root, 'sites/sample-site/README.md'), 'utf8')).toContain('owner team');
    expect((await invoke('init', 'sample-site')).code).toBe(2);
    expect(await readFile(config, 'utf8')).toBe(original);
    for (const args of [[], ['../escape'], ['bad/name'], ['unsafe', '--url', 'file:///tmp/a'], ['bad', '--unknown']]) {
      expect((await invoke('init', ...args)).code).toBe(2);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI batch aggregates success and supports run --all', async () => {
  const { root, invoke } = await isolatedWorkspace();
  try {
    for (const site of ['one', 'two']) {
      expect((await invoke('init', site)).code).toBe(0);
      await writeFile(join(root, 'sites', site, 'routes.spec.ts'), `import { test, expect } from '@playwright/test';
        test('passes', () => expect(1).toBe(1));`);
    }
    await mkdir(join(root, 'sites/unconfigured'));
    for (const args of [['batch'], ['run', '--all']]) {
      const result = await invoke(...args);
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.ok).toBe(true);
      expect(report.summary).toEqual({ totalSites: 2, passedSites: 2, failedSites: 0, totalTests: 2, passedTests: 2, failedTests: 0 });
      expect(report.sites.map((site: any) => site.site)).toEqual(['one', 'two']);
      expect(JSON.parse(await readFile(join(root, 'test-results/batch-report.json'), 'utf8'))).toEqual(report);
    }
    expect((await invoke('batch', '--unknown')).code).toBe(2);
    expect((await invoke('run', 'one', '--all')).code).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI batch continues after failures and reports empty discovery', async () => {
  const { root, invoke } = await isolatedWorkspace();
  try {
    const empty = JSON.parse((await invoke('batch')).stdout);
    expect(empty.summary.totalSites).toBe(0);
    expect(empty.ok).toBe(true);
    for (const site of ['a-fails', 'b-passes']) {
      await invoke('init', site);
      await writeFile(join(root, 'sites', site, 'routes.spec.ts'), `import { test, expect } from '@playwright/test';
        test('check', () => expect(1).toBe(${site === 'a-fails' ? 2 : 1}));`);
    }
    const result = await invoke('batch');
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({ totalSites: 2, passedSites: 1, failedSites: 1, totalTests: 2, passedTests: 1, failedTests: 1 });
    expect(report.sites[0]).toMatchObject({ site: 'a-fails', ok: false, exitCode: 1 });
    expect(report.sites[1]).toMatchObject({ site: 'b-passes', ok: true, exitCode: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
