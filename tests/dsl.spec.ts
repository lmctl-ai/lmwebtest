import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function runCli(...args: string[]) {
  try {
    const result = await exec(process.execPath, [cli, ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function runLmscript(source: string) {
  try {
    const result = await exec('lmscript', ['-e', source]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('CLI exposes --version matching release version', async () => {
  const result = await runCli('--version');
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('lmwebtest 0.1.0');
});

test('CLI exposes --dsl-signatures and --lmcode-signatures identically', async () => {
  const dsl = await runCli('--dsl-signatures');
  const lmcode = await runCli('--lmcode-signatures');
  expect(dsl.code).toBe(0);
  expect(lmcode.code).toBe(0);
  expect(dsl.stdout).toBe(lmcode.stdout);
  expect(dsl.stdout).toContain('context web: Web');
  expect(dsl.stdout).toContain('context report: Report');
  expect(dsl.stdout).toContain('method Web.navigate(string) -> Page');
  expect(dsl.stdout).toContain('method Page.title() -> string');
  expect(dsl.stdout).toContain('method Page.wait_for(string) -> Element');
});

test('CLI exposes --dsl-schema and --dsl-schema --json', async () => {
  const summary = await runCli('--dsl-schema');
  expect(summary.code).toBe(0);
  expect(summary.stdout).toContain('Web:');
  expect(summary.stdout).toContain('method Web.navigate(string) -> Page');

  const json = await runCli('--dsl-schema', '--json');
  expect(json.code).toBe(0);
  const parsed = JSON.parse(json.stdout);
  expect(parsed['dsl.schema']).toBe(2);
  expect(parsed.name).toBe('lmwebtest');
  expect(parsed.context.web).toBe('Web');
  expect(parsed.context.report).toBe('Report');
});

test('LMScript can drive multi-step flow via lmwebtest DSL', async ({ baseURL }) => {
  const script = `
dsl = _dsl_ cli="${cli}";
let page = web.navigate("${baseURL}");
page.wait_for("#file-table");
let title = page.title();
print("Title: " + title);
let count = page.count("#file-table tbody tr");
print("Rows: " + str(count));
if (count == 0) {
  report.add("error", "#file-table", 1, "must have rows");
  report.fail_if_any();
}
page.save_html("test-results/dsl-test-fixture.html");
end _dsl_

tmp = temp_file();
savedsl(dsl, tmp);
res = system(concat(dsl_cli(dsl), ["--dsl", tmp]));
delete_file(tmp);
println(res.stdout);
exit(res.code);
`;
  const result = await runLmscript(script);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain('Title: File Explorer');
  expect(result.stdout).toContain('{"ok":true,"result":null}');

  const html = await readFile(join(process.cwd(), 'test-results/dsl-test-fixture.html'), 'utf8');
  expect(html).toContain('id="file-table"');
});

test('LMScript DSL reports locate runtime error with exit 3', async ({ baseURL }) => {
  const script = `
dsl = _dsl_ cli="${cli}";
let page = web.navigate("${baseURL}");
page.wait_for("#nonexistent-selector-99", 500);
end _dsl_

tmp = temp_file();
savedsl(dsl, tmp);
res = system(concat(dsl_cli(dsl), ["--dsl", tmp]));
delete_file(tmp);
println(res.stdout);
exit(res.code);
`;
  const result = await runLmscript(script);
  expect(result.code, result.stderr).toBe(3);
  expect(result.stdout).toContain('"phase":"run"');
  expect(result.stdout).toContain('"code":"RUN_HOST"');
  expect(result.stdout).toContain('"line":4');
});

test('LMScript DSL report.fail_if_any causes app failure with exit 4', async () => {
  const script = `
dsl = _dsl_ cli="${cli}";
report.add("error", "check", 1, "test failure");
report.fail_if_any();
end _dsl_

tmp = temp_file();
savedsl(dsl, tmp);
res = system(concat(dsl_cli(dsl), ["--dsl", tmp]));
delete_file(tmp);
println(res.stdout);
exit(res.code);
`;
  const result = await runLmscript(script);
  expect(result.code, result.stderr).toBe(4);
  expect(result.stdout).toContain('"phase":"app"');
  expect(result.stdout).toContain('"code":"APP_FAIL"');
  expect(result.stdout).toContain('"line":4');
});
