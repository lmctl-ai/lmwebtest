# lmwebtest

Web integration test suite powered by `playwright-cli`, `lmscript`, and `lmhtml`.

[![CI](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml/badge.svg)](https://github.com/lmctl-ai/lmwebtest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`lmwebtest` provides repeatable, CLI-friendly integration testing for web sites and documentation libraries without heavy browser automation test runners.

## Architecture

The testing workflow separates responsibilities into three distinct tools:

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
