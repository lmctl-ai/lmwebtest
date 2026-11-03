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

## Playwright through lmcode (`lmwebtest playwright`)

`lmwebtest playwright` is an [lmcode](https://github.com/lmctl-ai/lmcode) host for the **whole Playwright API**: launch,
pages, frames, locators, actions, **file upload** (`set_input_files`, file choosers, in-memory files), downloads, popups,
dialogs, routing and HAR replay, `ApiContext` HTTP requests, retrying `expect` assertions, tracing, and a reflective
`call(method, argsJson)` on every handle for anything not wrapped. Scripts bind to it with `cli="lmwebtest playwright"`:

```lmscript
program = _lmcode_ cli="lmwebtest playwright";
let b = pw.launch("chromium");
let p = b.new_page();
p.goto(pw.env("LMMOCK_URL") + "/upload");
p.set_input_files("#file", "[{\"name\":\"a.txt\",\"mimeType\":\"text/plain\",\"text\":\"alpha\"}, \"/tmp/b.png\"]");
let resp = p.click_response("#send", "**/upload");
$return.status = resp.status();
$return.count = p.text_content("#count");
b.close();
end _lmcode_
let res = run_lmcode(program, {command: ["lmwebtest", "playwright", "--lmcode", "$DSLFILE"]});
```

`lmwebtest playwright --lmcode-signatures` lists every method. Options are JSON strings, files are a path, a JSON array of
paths, or `{"name","mimeType","text"|"base64"}` objects. The VM is synchronous, so Playwright runs in a worker thread and each
call blocks on it. The lmcode runtime is a vendored snapshot of [lmcode-js](https://github.com/lmctl-ai/lmcode-js)
(`src/playwright/lmcode-js`, see `VENDORED.md`); set `LMCODE_JS` to use another checkout. `LMCODE_HEADED=1` shows the browser.

## Single-file executables

`scripts/build-binary.sh [OUTDIR] [TARGET...]` compiles `lmwebtest` with [Bun](https://bun.sh) into one executable per platform
(`linux-x64`, `linux-arm64`, `macos-x64`, `macos-arm64`, `windows-x64`), with the runtime, Playwright, the lmcode VM and the
schema embedded. Node is not needed to run them; the browser still is: `npx playwright install chromium`. In the executable,
`lmwebtest run` / `batch` (which launch the Playwright test runner against a checkout's `sites/`) are unavailable; everything
else, including `playwright`, the Web DSL (`--lmcode`) and `test`/`screenshot`, works.
macOS binaries are not code-signed.

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
- **[upload-app](upload-app/)**: Offline file-upload integration test. `lmmock` serves a site that accepts multipart uploads (multiple files, type blocking, empty-submit errors, download back); `lmwebtest playwright` drives a real browser through it from an `.lms`. Run `./upload-app/run.sh`.
- **[demo-app](demo-app/)**: Deterministic, fully offline integration test for an interactive mock web app (session-cookie auth, protected routes, stateful buttons) served by `lmmock` and driven through `lmhtml` DOM extraction. Runs in CI on every push and pull request via `./demo-app/run.sh`.
- **[egtry](egtry/)**: Reusable post-switch book integration test suite for [egtry.com](https://www.egtry.com).
- **[sites/localweb](sites/localweb/)**: Reference starter scaffold.

## Continuous Integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs: `test` (Playwright suite; plus the live moonshot worked example on dispatch/schedule), `webapp` (offline mock web app), `upload` (offline file-upload site, once with Node and once with the compiled Linux executable), `playwright-host` (the `lmwebtest playwright` suite) and, only on manual dispatch and the weekly schedule, `neochart` (live site). The offline jobs use the latest lmctl, lmmock and lmhtml by design; breakage is fixed forward. `./run.sh` runs the suites locally.

### Automatic releases

On every push to `main`, once `test`, `webapp`, `upload` and `playwright-host` all pass, the `release` job picks the next patch version after the latest GitHub release, builds the five executables with `scripts/build-binary.sh`, smoke-tests the Linux one, and publishes `vX.Y.Z` with `lmwebtest-<os>-<arch>[.exe]`, `SHA256SUMS` and generated notes (asset names are what `lmscript install` downloads). A failing job blocks the release; a re-run of the same commit does not publish twice. For a minor or major bump, publish that release by hand once; the next automatic one continues from it.

## Durable Memory

Engineering decisions, workflows, and case studies are recorded under [durable-memory/](durable-memory/):

- [Case study: neochart integration test](durable-memory/case-study-neochart.md)
- [Case study: mock web application integration testing](durable-memory/case-study-mock-webapp.md)
- [How to add an integration check](durable-memory/how-to-add-a-check.md)
- [Architectural decisions](durable-memory/decisions.md)
- [Service ownership model](durable-memory/service-model.md)
- [Per-site convention](durable-memory/per-site-convention.md)

## License

MIT licensed; see [LICENSE](LICENSE).
