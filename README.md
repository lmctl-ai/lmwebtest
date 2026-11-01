# lmwebtest

A lightweight browser automation tool and LMScript DSL host for multi-step web integration testing, page checks, screenshots, and test suites.

[![CI](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml/badge.svg)](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Requires Node.js 20 or newer.

```sh
npm install
npm run browsers:install
npm test
npm run serve
```

## LMScript DSL (`context web: Web`)

lmwebtest provides an LMScript DSL so `.lms` scripts can drive multi-step browser flows directly without shelling out:

```lmscript
let test_dsl = _dsl_ cli="lmwebtest" install="github:lmctl-ai/lmwebtest@latest";
let page = web.navigate("https://platform.kimi.ai/docs/pricing/batch");
page.wait_for("table tbody tr", 15000);

let count = page.count("table tbody tr");
if (count == 0) {
  report.add("empty_table", "table tbody tr", 1, "Expected client-rendered pricing rows");
  report.fail_if_any();
}

let rows = page.select("table tbody tr");
for (i in range(0, rows.len())) {
  let row = rows.at(i);
  print("[" + str(i) + "] " + row.text());
}

page.save_html("test-results/rendered.html");
end _dsl_
```

See [examples/moonshot-pricing.lms](examples/moonshot-pricing.lms) for an end-to-end example acquiring client-rendered pricing tables and handing them to `lmhtml`.

## CLI Usage

The CLI supports quick ad-hoc checks, screenshots, and running Playwright test suites:

```sh
node src/cli.js test http://127.0.0.1:3000 --title "File Explorer" --selector '#file-table'
node src/cli.js screenshot http://127.0.0.1:3000 --out screenshots/demo.png
node src/cli.js run
node src/cli.js run tests/security.spec.ts
```

Use `npm link` to register `lmwebtest` locally, then substitute `lmwebtest` for
`node src/cli.js`. `--help` lists options.

`test` checks HTTP status (200 by default, configurable with `--status`), console
errors, uncaught JavaScript errors, failed requests, HTTP resource errors, and
broken loaded images. It reports JSON with the title and navigation load time.
Use `--title` for an exact title and repeat `--selector` for visible elements.
`--timeout` sets navigation/assertion timeouts in milliseconds (default 10000).

`screenshot` captures the full page; use `--no-js` to disable JavaScript.
Screenshot success means the file was captured; observed page errors remain in
the JSON report. Exit codes: 0 success, 1 failed check/runtime error, 2 invalid
arguments. `run` forwards arguments and exit status to the bundled test suite.

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
run `lmwebtest run <site>` once their changed application is served.

`batch` and `run --all` run every configured site sequentially and continue after
failures. A JSON report is emitted on stdout and saved to `test-results/batch-report.json`.

## Test Suites

- **[neochart](neochart/)**: Integration test suite for [neochart.com](https://neochart.com) (legal document library). Includes ad-hoc exploration notes ([EXPLORE.md](neochart/EXPLORE.md)), the test script ([neochart.lms](neochart/neochart.lms)), and runner ([run.sh](neochart/run.sh)).
- **[egtry](egtry/)**: Reusable post-switch book integration test suite for [egtry.com](https://www.egtry.com).
- **[sites/localweb](sites/localweb/)**: Reference starter scaffold.

## Durable Memory

Engineering decisions, workflows, and case studies are recorded under [durable-memory/](durable-memory/):

- [Case study: neochart integration test](durable-memory/case-study-neochart.md)
- [How to add an integration check](durable-memory/how-to-add-a-check.md)
- [Architectural decisions](durable-memory/decisions.md)
- [Service ownership model](durable-memory/service-model.md)
- [Per-site convention](durable-memory/per-site-convention.md)

## License

MIT licensed; see [LICENSE](LICENSE).
