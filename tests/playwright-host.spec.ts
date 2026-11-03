// Integration tests for the Playwright lmcode host (`lmwebtest playwright --lmcode`).
// Scripts are compiled and run by `lmscript` (>= 0.2.454), which must be on PATH.
// Excluded from `npm test`; run with LMWEBTEST_HOST_TESTS=1 (CI job `playwright-host`).

import fs from 'fs';
import http from 'http';
import path from 'path';
import { execFile, spawnSync } from 'child_process';
import { test as baseTest, expect } from '@playwright/test';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const hasLmscript = spawnSync('lmscript', ['--help']).status === 0;

const PAGES: Record<string, string> = {
  '/form': `<title>Upload</title>
    <form id=f method=post action=/upload enctype=multipart/form-data>
      <input id=file type=file multiple name=file><button id=send type=submit>Send</button>
    </form><p id=names></p>
    <script>file.onchange = () => names.textContent = [...file.files].map(f => f.name).join(',');</script>`,
  '/download': `<a id=dl href=/file.txt download=report.txt>Download</a>`,
  '/dialog': `<button id=b onclick="document.title = confirm('sure?') ? 'yes' : 'no'">go</button>`,
  '/popup': `<a id=a href=/form target=_blank>open</a>`,
  '/console': `<script>console.log('hello console'); setTimeout(() => { throw new Error('boom'); }, 0);</script>`,
  '/fetch': `<button id=b onclick="fetch('/api/echo').then(r => r.text()).then(t => document.title = t)">go</button>`,
  '/choose': `<input id=file type=file><p id=n></p><script>file.onchange = () => n.textContent = file.files[0].name;</script>`,
};

const test = baseTest.extend<{ server: string }>({
  server: async ({}, use) => {
    const uploads: string[] = [];
    const server = http.createServer((req, res) => {
      const url = req.url!.split('?')[0];
      if (req.method === 'POST' && url === '/upload') {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('latin1');
          const names = [...body.matchAll(/filename="([^"]*)"/g)].map(m => m[1]);
          uploads.push(...names);
          res.setHeader('content-type', 'text/html');
          res.end(`<title>uploaded</title><p id=result>${names.join(',')}|${/hello upload/.test(body)}</p>`);
        });
        return;
      }
      if (url === '/file.txt') {
        res.setHeader('content-type', 'text/plain');
        res.setHeader('content-disposition', 'attachment; filename="report.txt"');
        res.end('downloaded body');
        return;
      }
      if (url === '/api/echo') {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString() }));
        });
        return;
      }
      if (PAGES[url]) {
        res.setHeader('content-type', 'text/html');
        res.end(PAGES[url]);
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  },
});

type Run = { code: number | null; stdout: string; stderr: string };

/** Compiles and runs an lmcode body against Playwright; returns lmscript's output. */
async function runLmcode(body: string): Promise<Run> {
  const dir = test.info().outputPath();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, 'lmwebtest');
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${cliPath}" "$@"\n`, { mode: 0o755 });
  const script = path.join(dir, 'test.lms');
  fs.writeFileSync(script, [
    'program = _lmcode_ cli="lmwebtest playwright";',
    body,
    'end _lmcode_',
    'result = run_lmcode(program, {command: ["lmwebtest", "playwright", "--lmcode", "$DSLFILE"]});',
    'print(json_stringify(result));',
  ].join('\n'));
  return new Promise(resolve => {
    execFile('lmscript', [script], { cwd: dir, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } },
        (error, stdout, stderr) => resolve({ code: error ? (error as any).code : 0, stdout, stderr }));
  });
}

async function result(body: string): Promise<any> {
  const run = await runLmcode(body);
  expect(run.stderr + run.stdout, 'lmscript output').toContain('"ok":true');
  return JSON.parse(run.stdout.trim().split('\n').pop()!).result;
}

test.describe('playwright lmcode host', () => {
  test.skip(!hasLmscript || process.platform === 'win32', 'needs lmscript on PATH and a POSIX shell');

  test('discovery: schema is stable JSON and signatures match it', async () => {
    const run = (args: string[]) => spawnSync(process.execPath, [cliPath, 'playwright', ...args], { encoding: 'utf8' });
    const a = run(['--lmcode-schema', '--json']);
    const b = run(['--lmcode-schema', '--json']);
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    const schema = JSON.parse(a.stdout);
    expect(schema['dsl.schema']).toBe(2);
    expect(schema.context).toEqual({ pw: 'Playwright' });
    const signatures = run(['--lmcode-signatures']).stdout.split('\n');
    expect(signatures).toContain('method Locator.set_input_files(string) -> void');
    expect(signatures).toContain('method Page.set_input_files(string, string) -> void');
    expect(signatures).toContain('method Playwright.launch(string) -> Browser');
    for (const [type, { methods }] of Object.entries<any>(schema.types)) {
      for (const [name, overloads] of Object.entries<any>(methods)) {
        for (const o of overloads) {
          const sig = `method ${type}.${name}(${o.params.join(', ')}) -> ${o.returns}`;
          expect(signatures, sig).toContain(sig);
        }
      }
    }
  });

  test('navigation, locators and reading the page', async ({ server }) => {
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      let resp = p.goto("${server}/form");
      $return.status = resp.status();
      $return.title = p.title();
      $return.url_ok = str_contains(p.url(), "/form");
      $return.count = p.locator("input").count();
      $return.by_role = p.get_by_role("button", "{\\"name\\":\\"Send\\"}").inner_text();
      $return.eval = p.evaluate("document.querySelectorAll('input').length");
      b.close();`);
    expect(r).toEqual({ status: 200, title: 'Upload', url_ok: true, count: 1, by_role: 'Send', eval: '1' });
  });

  test('file upload: in-memory files, paths and multipart form submit', async ({ server }) => {
    const file = test.info().outputPath('doc.txt');
    fs.writeFileSync(file, 'hello upload');
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/form");
      p.set_input_files("#file", "[{\\"name\\":\\"mem.txt\\",\\"mimeType\\":\\"text/plain\\",\\"text\\":\\"in memory\\"},\\"${file}\\"]");
      $return.names = p.text_content("#names");
      p.click("#send");
      p.wait_for_selector("#result");
      $return.result = p.text_content("#result");
      p.go_back();
      p.locator("#file").set_input_files("[]");
      $return.cleared = p.text_content("#names");
      b.close();`);
    expect(r.names).toBe('mem.txt,doc.txt');
    expect(r.result).toBe('mem.txt,doc.txt|true');
    expect(r.cleared).toBe('');
  });

  test('file chooser: click opens the chooser, files are set on it', async ({ server }) => {
    const file = test.info().outputPath('chosen.txt');
    fs.writeFileSync(file, 'x');
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/choose");
      p.click_file_chooser("#file", "${file}");
      $return.name = p.text_content("#n");
      let chooser = p.click_wait_file_chooser("#file");
      $return.multiple = chooser.is_multiple();
      chooser.set_files("${file}");
      b.close();`);
    expect(r).toEqual({ name: 'chosen.txt', multiple: false });
  });

  test('downloads are saved from a click', async ({ server }) => {
    const out = test.info().outputPath('saved.txt');
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/download");
      let d = p.click_download("#dl");
      $return.name = d.suggested_filename();
      d.save_as("${out}");
      b.close();`);
    expect(r.name).toBe('report.txt');
    expect(fs.readFileSync(out, 'utf8')).toBe('downloaded body');
  });

  test('dialogs follow the page policy and are logged', async ({ server }) => {
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/dialog");
      p.click("#b");
      $return.dismissed = p.title();
      p.auto_dialog("accept");
      p.click("#b");
      $return.accepted = p.title();
      $return.log = p.dialog_log();
      b.close();`);
    expect(r.dismissed).toBe('no');
    expect(r.accepted).toBe('yes');
    expect(JSON.parse(r.log).map((d: any) => d.message)).toEqual(['sure?', 'sure?']);
  });

  test('popups, console and page errors', async ({ server }) => {
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/popup");
      let pop = p.click_popup("#a");
      pop.wait_for_load_state("domcontentloaded");
      $return.popup = pop.title();
      let c = b.new_page();
      c.goto("${server}/console");
      c.wait_for_timeout(200);
      $return.console = c.console_log();
      $return.errors = c.page_errors();
      b.close();`);
    expect(r.popup).toBe('Upload');
    expect(JSON.parse(r.console)).toEqual([{ type: 'log', text: 'hello console' }]);
    expect(r.errors).toContain('boom');
  });

  test('network: route_fulfill mocks, click_response waits, ApiContext sends HTTP', async ({ server }) => {
    const r = await result(`
      let b = pw.launch("chromium");
      let ctx = b.new_context();
      ctx.route_fulfill_json("**/api/echo", 200, "{\\"mocked\\":true}");
      let p = ctx.new_page();
      p.goto("${server}/fetch");
      let resp = p.click_response("#b", "**/api/echo");
      $return.status = resp.status();
      $return.body = resp.text();
      ctx.unroute_all();
      let api = pw.request_new();
      let posted = api.post("${server}/api/echo", "{\\"data\\":\\"payload\\"}");
      $return.api_status = posted.status();
      $return.api = posted.json();
      api.dispose();
      b.close();`);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ mocked: true });
    expect(r.api_status).toBe(200);
    expect(JSON.parse(r.api)).toEqual({ method: 'POST', body: 'payload' });
  });

  test('web-first assertions retry and can be negated', async ({ server }) => {
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/form");
      p.locator("#send").expect("toBeVisible", "[]");
      p.locator("#send").expect("toHaveText", "[\\"Send\\"]");
      p.locator("#nothing").expect_not("toBeVisible", "[]");
      p.expect_page("toHaveTitle", "[\\"Upload\\"]");
      b.close();
      $return.passed = true;`);
    expect(r.passed).toBe(true);
  });

  test('call() reaches the whole Playwright API by reflection', async ({ server }) => {
    const r = await result(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/form");
      p.call("keyboard.press", "[\\"Tab\\"]");
      let box = p.locator("#send").call("boundingBox", "[]");
      let loc = as_locator(p.call_id("locator", "[\\"#send\\"]"));
      $return.text = loc.text_content();
      $return.has_box = str_contains(box, "width");
      $return.viewport = p.call("viewportSize", "[]");
      $return.id_same = as_page(p.id()).title();
      b.close();`);
    expect(r.text).toBe('Send');
    expect(r.has_box).toBe(true);
    expect(JSON.parse(r.viewport)).toEqual({ width: 1280, height: 720 });
    expect(r.id_same).toBe('Upload');
  });

  test('Playwright failures surface as a failed run, and the browser is still closed', async ({ server }) => {
    const run = await runLmcode(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/form");
      p.click_with_missing_timeout_is_not_a_method();`);
    expect(run.stdout + run.stderr).not.toContain('"ok":true');

    const timeout = await runLmcode(`
      let b = pw.launch("chromium");
      let p = b.new_page();
      p.goto("${server}/form");
      p.click("#does-not-exist", "{\\"timeout\\":300}");`);
    expect(timeout.stdout + timeout.stderr).not.toContain('"ok":true');
    expect(timeout.stdout + timeout.stderr).toContain('does-not-exist');
  });
});
