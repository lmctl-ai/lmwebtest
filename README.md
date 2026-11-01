# lmwebtest

Web integration test suite and browser automation host powered by `lmwebtest`, `lmcurl`, `lmscript`, and `lmhtml`.

[![CI](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml/badge.svg)](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Architecture

The workflow separates **navigation and download** from **extraction** from **orchestration**. Navigation has two interchangeable implementations — pick the cheaper one that works:

| Role | Tool | DSL / Interface |
|---|---|---|
| Navigation + download, **HTTP** | **`lmcurl`** | `context curl: Curl` |
| Navigation + download, **Browser** | **`lmwebtest`** | `context web: Web` (Playwright Chromium) |
| **Extraction** | **`lmhtml`** | `context html: Html` (Lexbor DOM) |
| **Orchestration** | **`lmscript`** | `.lms` |

One `.lms` can hold both acquisition branches: try HTTP first, fall back to the browser only when the data is not in the fetched document. Keep the fallback a declared branch with an explicit condition — not a retry loop — so the script stays deterministic.

```
                     ┌──────────────────┐
                     │    Target Site   │
                     └────────┬─────────┘
                              │
               ┌──────────────┴──────────────┐
               │                             │
        (static / HTTP)            (client-rendered JS)
               ▼                             ▼
       ┌──────────────┐              ┌──────────────┐
       │    lmcurl    │              │  lmwebtest   │
       │ (Curl DSL)   │              │  (Web DSL)   │
       └───────┬──────┘              └───────┬──────┘
               │                             │
               └──────────────┬──────────────┘
                              ▼
                      Raw Rendered DOM
                              ▼
                     ┌──────────────────┐
                     │      lmhtml      │  (Lexbor DOM extraction)
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │     lmscript     │  (Assertions & reporting)
                     └──────────────────┘
```

## LMScript DSL (`context web: Web`)

`lmwebtest` exposes a DSL surface matching `lmhtml` conventions (`context web: Web` and `context report: Report`) so an `.lms` script can drive multi-step browser flows directly:

```lmscript
let test_dsl = _lmcode_ cli="lmwebtest" install="github:lmctl-ai/lmwebtest@latest";
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
end _lmcode_
```

See [examples/moonshot-pricing.lms](examples/moonshot-pricing.lms) for an end-to-end example acquiring client-rendered pricing tables and handing them to `lmhtml`.

## Installation

Install via `lmscript` (requires Node.js >= 20 on PATH; downloads self-contained bundle into tool cache):

```sh
lmscript install github:lmctl-ai/lmwebtest
```

Playwright Chromium browser binaries are installed into `~/.cache/ms-playwright` via:
```sh
npx playwright install chromium
```

Or run locally from checkout:

```sh
npm install
npm run browsers:install
npm test
npm run serve
```

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

## Test Suites and Examples

- **[examples/moonshot-pricing.lms](examples/moonshot-pricing.lms)**: Worked example acquiring Moonshot client-rendered pricing tables and handing them to `lmhtml` for extraction.
- **[neochart](neochart/)**: Integration test suite for [neochart.com](https://neochart.com) (legal document library). Includes exploration notes ([EXPLORE.md](neochart/EXPLORE.md)), test script ([neochart.lms](neochart/neochart.lms)), and runner ([run.sh](neochart/run.sh)).
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
