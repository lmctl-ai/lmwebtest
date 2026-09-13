# lmwebtest

A lightweight Playwright CLI for web page checks, screenshots, and test suites.
Requires Node.js 20 or newer.

```sh
npm install
npm run browsers:install
npm test
npm run serve
```

The demo listens on `http://127.0.0.1:3000`; set `PORT` to change it.
Tests start and stop their own demo server, so stop a manually started server
before running tests (or use a different `PORT`). The demo resets its generated
`docroot/` on startup and before each demo test. It is a local testing fixture.

```sh
node src/cli.js test http://127.0.0.1:3000 --title "File Explorer" --selector '#file-table'
node src/cli.js screenshot http://127.0.0.1:3000 --out screenshots/demo.png
node src/cli.js run
node src/cli.js run tests/security.spec.ts
```

Use `npm link` to register `lmwebtest` locally, then substitute `lmwebtest` for
`node src/cli.js`. `--help` lists options. No CLI parser dependency is needed.

`test` checks HTTP status (200 by default, configurable with `--status`), console
errors, uncaught JavaScript errors, failed requests, HTTP resource errors, and
broken loaded images. It reports JSON with the title and navigation load time.
Use `--title` for an exact title and repeat `--selector` for visible elements.
`--timeout` sets navigation/assertion timeouts in milliseconds (default 10000).
Checks observe loading and requested assertions, not later background activity;
this is not a crawl of every link or an accessibility audit.

`screenshot` captures the full page; use `--no-js` to disable JavaScript.
Screenshot success means the file was captured; observed page errors remain in
the JSON report. Exit codes: 0 success, 1 failed check/runtime error, 2 invalid
arguments. `run` forwards arguments and exit status to the bundled test suite.

The demo server, UI, helpers and nine original tests come from
`/home/mma/samples/playwright/`. The standalone screenshot scripts supplied the
headless/full-page/no-JavaScript pattern; their hardcoded URLs were not copied.
HTMX 1.9.10 is vendored under `public/vendor/` with its license to allow offline
demo tests. Tests use one worker because they share a resettable store.

Verification: `npm run check` checks JavaScript syntax; `npm test` runs browser,
API, and CLI integration tests. No separate linter or TypeScript compiler is
configured in this initial version.

## Util/service model and consumer workspaces

lmwebtest owns the tool, infrastructure, workspace conventions, scaffolding and
batch runner. Consumer website teams own and author their site's test cases.
Start with [consumer onboarding](docs/ONBOARDING.md).

```sh
lmwebtest init my-site --url http://127.0.0.1:8080
lmwebtest run my-site
lmwebtest batch
lmwebtest run --all
```

`init` creates config, starter smoke spec and README under `sites/<site-name>/`.
It refuses to overwrite existing workspaces. Consumers expand their own cases and
run `lmwebtest run <site>` once their changed application is served. This is a
one-shot invocation for existing watch/build/CI workflows; targets are not started
automatically. `sites/localweb` is a reference scaffold with one home smoke test,
using `LOCALWEB_URL` or `http://127.0.0.1:4173`. Localweb owns its expansion.

`batch` and `run --all` run every configured site sequentially and continue after
failures. Both accept no additional arguments. A JSON report is emitted on stdout
and saved to `test-results/batch-report.json`, with site outcomes, runner output
and aggregate test counts. Reports and screenshots are generated artifacts.
Exit codes: 0 pass, 1 test/runtime failure, 2 invalid arguments. Empty discovery
succeeds with zero totals. See onboarding for retry/skip accounting.

`run <site-id>` selects `sites/<site-id>/playwright.config.ts`; no target runs the
root demo suite. File/directory filters remain relative to the lmwebtest repository.
A named site cannot be combined with `--config`. Supported runner options:
`--config/-c`, `--grep/-g`, `--grep-invert`, repeatable `--project`, `--workers`,
`--timeout`, `--retries`, `--reporter`, `--output`, `--trace`, `--max-failures`,
`--repeat-each`, `--shard`, `--list`, `--headed`, `--debug`, `--ui`, `--help/-h`,
`--forbid-only`, `--fully-parallel`, `--update-snapshots`, `--quiet`,
`--pass-with-no-tests`. Unknown options and malformed numbers are rejected;
Playwright validates config/project/reporter semantics at execution.

Next planned consumer: egtry.com; its owner team will author its test cases.
See [service model](durable-memory/service-model.md) and
[per-site convention](durable-memory/per-site-convention.md).

## Test-owner team composition

Each consumer must stand up an **agy/agy/codex** test-owner team:
Lead = `agy` (Gemini 3.8 Flash), Coder = `agy` (Gemini 3.8 Flash),
Reviewer = `codex` (independent cross-reviewer). Affordable Gemini bulk case
authoring is paired with independent cross-provider Codex review; author !=
reviewer. Create the central workspace, author cases, and run batch on change.
The service owns the infrastructure; this recipe governs consumer teams.
The onboarding guide and generated site README include a starter `.lmctl`
teamfile with `model="Gemini 3.8 Flash (Medium)"` for both agy members.
