import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
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
  expect(site.stdout).toContain('Total: 5 tests');
  expect(site.stdout).toContain('routes.spec.ts');
  expect(site.stdout).not.toContain('file-explorer.spec.ts');
  const file = await run('run', 'tests/security.spec.ts', '--list');
  expect(file.code).toBe(0);
  expect(file.stdout).toContain('Total: 3 tests');
  const directory = await run('run', 'tests', '--list');
  expect(directory.code).toBe(0);
  expect(directory.stdout).toContain('Total: 16 tests');
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
