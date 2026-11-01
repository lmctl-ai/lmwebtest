# lmwebtest

Web integration test suite powered by `lmcurl` or `playwright`, `lmscript`, and `lmhtml`.

[![CI](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml/badge.svg)](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What this repo is — and is not

**`lmwebtest` is not a standalone tool.** There is no `lmwebtest` binary to
install and no library to depend on. This repo is a **skill and knowledge base**:
the method for writing web integration tests, plus **worked examples** you copy
into your own project.

What you take from here is the *shape* of an `.lms` — not an artifact. Each
consumer writes and owns its own script. The tools it orchestrates
(`lmcurl`, `playwright`, `lmhtml`, `lmscript`) are installed separately and are
what actually do the work.

Read `neochart/neochart.lms` first, then `durable-memory/how-to-add-a-check.md`.
Habits worth lifting verbatim from the example:

- the `check(condition, name, detail)` helper with a `{pass, fail}` tally;
- cleaning stale `work/` state up front, so a run never inherits a previous one;
- asserting `timed_out`, exit code, HTTP code and file existence **separately**
  rather than trusting any one of them to imply the others.

`lmwebtest` therefore provides repeatable, CLI-friendly integration testing for
web sites and documentation libraries without heavy browser automation test
runners — as a pattern you adopt, not a dependency you add.

## Architecture

The workflow separates **navigation and download** from **extraction** from
**orchestration**. Navigation has two interchangeable implementations — pick the
cheaper one that works:

| role | tool |
|---|---|
| navigation + download, **HTTP** | **`lmcurl`** (DSL: `context curl: Curl`) |
| navigation + download, **browser** | **`playwright`** (for client-rendered pages) |
| **extraction** | **`lmhtml`** (DSL: `context html: Html`) |
| **orchestration** | **`lmscript`** (`.lms`) |

One `.lms` can hold both acquisition branches: try HTTP first, fall back to the
browser only when the data is not in the fetched document. Keep the fallback a
declared branch with an explicit condition — not a retry loop — so the script
stays deterministic.

The three tools below, in more detail:

1. **`playwright-cli`**: Interactive, ad-hoc site exploration to discover pages, selectors, navigation flows, and dynamic client-side behaviors.
2. **`lmscript`**: Automation engine driving test execution, network fetching, assertion evaluation, and structured PASS/FAIL reporting.
3. **`lmhtml`**: High-performance C++/Lexbor DOM host that parses raw captured HTML and extracts structured DOM elements (titles, headings, links, forms) via DSL bytecode.

```
                     ┌──────────────────┐
                     │  playwright-cli  │  (Ad-hoc exploration, selector discovery)
                     └────────┬─────────┘
                              │ findings
                              ▼
┌──────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Target Site ├─────►│  Test Script     ├─────►│  Raw HTML Files  │
└──────────────┘ curl └────────┬─────────┘ save └────────┬─────────┘
                               │                         │
                               │ compiles _lmcode_       │ Lexbor parse
                               ▼                         ▼
                      ┌──────────────────┐      ┌──────────────────┐
                      │ DSL Bytecode     ├─────►│      lmhtml      │
                      └──────────────────┘ exec └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │  Structured JSON │
                                                └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │ PASS/FAIL Checks │
                                                └──────────────────┘
```

## Quick Start

Run the `neochart` test suite:

```bash
cd neochart
./run.sh
```

To run interactive site exploration with `playwright-cli`:

```bash
cd neochart
./run.sh --explore
```

## Test Suites

- **[neochart](neochart/)**: Integration test suite for [neochart.com](https://neochart.com) (legal document library). Includes ad-hoc exploration notes ([EXPLORE.md](neochart/EXPLORE.md)), the test script ([neochart.lms](neochart/neochart.lms)), and runner ([run.sh](neochart/run.sh)).
- **[egtry](egtry/)**: Reusable post-switch book integration test suite for [egtry.com](https://www.egtry.com) (`./run.sh --book <id> --host www.egtry.com`). Verifies all kept URLs from `url-map.json`, DOM metadata (`title`, `h1`), `.sv` viewer blocks and `data/<example>.json` traces, viewer assets (`simple.css`, `chapter.css`, `page.js`), prev/next pager links, internal relative links, and `/tracks/programming-languages/` parity against `v1.egtry.com`.

## Continuous Integration

The repository CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on Ubuntu using pinned actions and `@lmctl-ai/lmctl@0.2.446`. Because the test suite executes against the live `https://neochart.com` site, CI triggers are limited to manual dispatch (`workflow_dispatch`) and a weekly scheduled cron (`schedule: 0 6 * * 1`) rather than running on every push or pull request. The CI status badge reflects this scheduled health check.

## Durable Memory

Engineering decisions, workflows, and case studies are recorded under [durable-memory/](durable-memory/):

- [Case study: neochart integration test](durable-memory/case-study-neochart.md)
- [How to add an integration check](durable-memory/how-to-add-a-check.md)
- [Architectural decisions](durable-memory/decisions.md)

## License

MIT licensed; see [LICENSE](LICENSE).

Made by **Lattice Systems LLC**.
