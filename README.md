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
