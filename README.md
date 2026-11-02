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

Run all test suites via the top-level runner:

```bash
./run.sh
```

Or run individual suites:

```bash
# Offline deterministic mock web application suite
cd demo-app && ./run.sh

# Live neochart site suite
cd neochart && ./run.sh
```

To run interactive site exploration with `playwright-cli`:

```bash
cd neochart
./run.sh --explore
```

## Test Suites

- **[demo-app](demo-app/)**: Deterministic, fully offline integration test suite for an interactive mock web application running on `lmmock` loopback. Exercises session cookie authentication, route protection, stateful button clicks, and DOM-driven form interactions via `lmhtml`. Executed in CI on every push and pull request.
- **[neochart](neochart/)**: Integration test suite for [neochart.com](https://neochart.com) (legal document library). Includes ad-hoc exploration notes ([EXPLORE.md](neochart/EXPLORE.md)), the test script ([neochart.lms](neochart/neochart.lms)), and runner ([run.sh](neochart/run.sh)). Executed in CI on manual dispatch and weekly schedule.

## Continuous Integration

The repository CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs two separate jobs on Ubuntu using pinned actions and latest dependencies (latest, by design; breakage is fixed forward):
1. **`webapp`**: The offline deterministic suite (`./demo-app/run.sh`). Triggered on every `push` to `main` and on `pull_request` to ensure continuous regression protection without network dependencies.
2. **`neochart`**: The live-site integration suite (`./neochart/run.sh`). Triggered only via manual dispatch (`workflow_dispatch`) and a weekly scheduled cron (`schedule: 0 6 * * 1`) to monitor external site stability without producing flaky CI runs.

## Durable Memory

Engineering decisions, workflows, and case studies are recorded under [durable-memory/](durable-memory/):

- [Case study: neochart integration test](durable-memory/case-study-neochart.md)
- [Case study: mock web application integration testing](durable-memory/case-study-mock-webapp.md)
- [How to add an integration check](durable-memory/how-to-add-a-check.md)
- [Architectural decisions](durable-memory/decisions.md)

## License

MIT licensed; see [LICENSE](LICENSE).

Made by **Lattice Systems LLC**.
