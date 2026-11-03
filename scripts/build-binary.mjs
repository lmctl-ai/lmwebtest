#!/usr/bin/env bun
// Builds single-file executables of lmwebtest with Bun (no Node and no node_modules needed at runtime).
//   bun scripts/build-binary.mjs [OUTDIR] [TARGET...]
// TARGET is one of: linux-x64 linux-arm64 macos-x64 macos-arm64 windows-x64 (default: all)
// Output: OUTDIR/lmwebtest-<target>[.exe] plus SHA256SUMS. OUTDIR defaults to dist/.
// Playwright browsers are not embedded: install them once with `npx playwright install chromium`.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  'linux-x64': ['bun-linux-x64', ''],
  'linux-arm64': ['bun-linux-arm64', ''],
  'macos-x64': ['bun-darwin-x64', ''],
  'macos-arm64': ['bun-darwin-arm64', ''],
  'windows-x64': ['bun-windows-x64', '.exe'],
};
const [outArg, ...targetArgs] = process.argv.slice(2);
const out = path.resolve(outArg ?? path.join(root, 'dist'));
const targets = targetArgs.length ? targetArgs : Object.keys(TARGETS);
for (const t of targets)
  if (!TARGETS[t]) { console.error(`Unknown target ${t}`); process.exit(2); }
mkdirSync(out, { recursive: true });

// The legacy DSL schema is read at startup; Bun embeds it only as a non-JS asset.
const stage = mkdtempSync(path.join(tmpdir(), 'lmwebtest-build-'));
copyFileSync(path.join(root, 'schema/lmwebtest.dsl.json'), path.join(stage, 'lmwebtest.dsl.schema'));

// Playwright finds its package.json and browsers.json at `__dirname/..`, which Bun would freeze to
// this machine's path. Point those two requires at literal paths so Bun inlines the JSON.
const REWRITES = [
  [/playwright-core\/lib\/coreBundle\.js$/, [
    ['require(import_path9.default.join(packageRoot, "package.json"))', file => `require(${JSON.stringify(path.join(path.dirname(file), '..', 'package.json'))})`],
    ['require(import_path20.default.join(packageRoot, "browsers.json"))', file => `require(${JSON.stringify(path.join(path.dirname(file), '..', 'browsers.json'))})`],
  ]],
  [/node_modules\/playwright\/lib\/package\.js$/, [
    ['require(import_path.default.join(packageRoot, "package.json"))', file => `require(${JSON.stringify(path.join(path.dirname(file), '..', 'package.json'))})`],
  ]],
];
const embedPlaywrightAssets = {
  name: 'embed-playwright-assets',
  setup(build) {
    for (const [filter, edits] of REWRITES) {
      build.onLoad({ filter }, args => {
        let contents = readFileSync(args.path, 'utf8');
        for (const [from, to] of edits) {
          if (!contents.includes(from))
            throw new Error(`Playwright changed: cannot find \`${from}\` in ${args.path}; update REWRITES in scripts/build-binary.mjs`);
          contents = contents.replace(from, to(args.path));
        }
        return { contents, loader: 'js' };
      });
    }
  },
};

try {
  for (const target of targets) {
    const [bunTarget, ext] = TARGETS[target];
    const outfile = path.join(out, `lmwebtest-${target}${ext}`);
    console.log(`Building ${path.basename(outfile)} ...`);
    const result = await Bun.build({
      entrypoints: [path.join(root, 'src/cli.js'), path.join(root, 'src/playwright/worker.cjs'), path.join(stage, 'lmwebtest.dsl.schema')],
      external: ['chromium-bidi/*', 'electron', 'electron/*'],
      // Flat names, so the worker is /$bunfs/root/worker.cjs next to the host (see src/playwright/host.mjs).
      naming: { entry: '[name].[ext]', asset: '[name].[ext]' },
      plugins: [embedPlaywrightAssets],
      compile: { target: bunTarget, outfile },
    });
    if (!result.success) {
      for (const log of result.logs) console.error(String(log));
      process.exit(1);
    }
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}

const sums = readdirSync(out).filter(f => f.startsWith('lmwebtest-')).sort()
    .map(f => `${createHash('sha256').update(readFileSync(path.join(out, f))).digest('hex')}  ${f}`);
writeFileSync(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(sums.join('\n'));
