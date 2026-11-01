# neochart Integration Test

Sample CLI integration test for [neochart.com](https://neochart.com) (which redirects to `https://www.neochart.com/`).

This suite demonstrates the three-tool workflow:
1. **`playwright-cli`**: Used for ad-hoc browser exploration to discover pages, selectors, and dynamic behavior (see [EXPLORE.md](EXPLORE.md)).
2. **`lmscript`**: Automation engine driving test execution, network fetching, assertion logic, and PASS/FAIL reporting.
3. **`lmhtml`**: High-performance C++/Lexbor DOM host that parses raw captured HTML and extracts structured DOM elements (titles, headings, links, forms) via DSL bytecode.

---

## Prerequisites

- **Node.js** >= 24 (with `lmscript` from `@lmctl-ai/lmctl` on `PATH`)
- **curl** (for capturing raw HTML responses)
- **lmhtml** (located via `PATH` or `$LMHTML`; automatically provided or built by `run.sh`)

---

## How to Run

### One-Command Runner (Recommended)

`run.sh` verifies prerequisites (`node`, `lmscript`, `curl`), locates or downloads/builds `lmhtml`, and runs the test:

```bash
cd neochart
./run.sh
```

### Direct Execution with `lmscript`

When `lmhtml` is located on `PATH` or exported via `LMHTML`:

```bash
cd neochart
export LMHTML=/path/to/lmhtml
lmscript neochart.lms
```

### Syntax Validation

To perform a static check without executing network requests:

```bash
lmscript --check neochart.lms
```

### Optional Interactive Exploration

To launch `playwright-cli` and inspect the site interactively:

```bash
./run.sh --explore
```

---

## How It Works

```
                     ┌──────────────────┐
                     │  playwright-cli  │  (Ad-hoc exploration, selector discovery)
                     └────────┬─────────┘
                              │ findings
                              ▼
┌──────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  neochart.com├─────►│  neochart.lms    ├─────►│  work/home.html  │
└──────────────┘ curl └────────┬─────────┘ save └────────┬─────────┘
                               │                         │
                               │ compiles _lmcode_       │ Lexbor parse
                               ▼                         ▼
                      ┌──────────────────┐      ┌──────────────────┐
                      │ work/extract.dslb├─────►│      lmhtml      │
                      └──────────────────┘ exec └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │work/extracted.json│
                                                └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │ PASS/FAIL Checks │
                                                └──────────────────┘
```

1. **Stale State Cleanup**: At startup, `neochart.lms` deletes `work/*.html` and `work/extracted.json` to prevent stale files from generating false passes.
2. **Routing Verification**: Checks that `https://neochart.com` returns `HTTP 301` redirecting exactly to `https://www.neochart.com/`.
3. **Raw HTML Capture**: Uses `curl -fsSL --max-time 20 --retry 2` to fetch the raw HTML of the homepage (`work/home.html`) and the reference page `https://www.neochart.com/about/index.html` (`work/about.html`). If capture fails, the script aborts immediately with a clear failure summary to avoid cascading errors.
4. **DOM Extraction**: An embedded `_lmcode_ cli="lmhtml" install="github:lmctl-ai/lmhtml@latest"` block compiles against the `lmhtml` schema to generate `work/extract.dslb`. The `lmhtml` binary executes this bytecode, parsing the raw HTML with Lexbor and emitting structured DOM findings to `work/extracted.json`.
5. **Stable Assertions**:
   - Exact page title: `neochart — Legal Document Library`
   - Masthead brand heading: `neochart · a free legal document library`
   - Search CTA: `<form class="searchbar" action="/search/">` with input `name="q"`
   - Navigation links: All 5 core library corpora links present (`/about/index.html`, `/constitution/index.html`, `/usc/index.html`, `/texas/index.html`, `/caselaw/index.html`)
   - Nav links resolution: Loops through all 5 core navigation URLs and confirms each returns `HTTP 200`
   - Linked page (`/about/index.html`): Exact title (`About & provenance — neochart`), exact `h1` (`About & provenance`), and required section headings (`Sources`, `Method`, `Not legal advice`)
6. **Output & Exit Code**: Each check outputs `[PASS]` or `[FAIL]`. Failures display expected versus actual values and error diagnostics. Any failure exits with code `1`.

---

## Tool Limitation: `savedsl` vs `run_lmcode`

In `lmscript 0.2.446`, `run_lmcode` is not available (calling it results in an undefined function error). Instead, `savedsl(program, path)` plus `--lmcode` is used. The script compiles the `_lmcode_` block to `work/extract.dslb` via `savedsl` and invokes `lmhtml` via `system([lmhtml_bin, "--lmcode", ...])` to extract structured JSON to `work/extracted.json`.

Furthermore, published `lmhtml` release `v0.7.4` reads DSL bytecode version 5, whereas `lmscript 0.2.446` emits DSL bytecode version 6. Because of this bytecode mismatch, `run.sh` builds `lmhtml` from pinned commit `bb8bc196f46400c7a54018be9efb310b91cb8e28`, which supports DSL version 6 and the `--lmcode` CLI flags.

---

## How to Add a Check

Adding a check takes three steps:

### 1. Extract the Element in the `_lmcode_` Block

Inside `neochart.lms`, locate the `_lmcode_` block and query the DOM using Lexbor methods:

```lms
let footer_links = home.select("footer a");
if (footer_links.len() > 0) {
  report.add("footer_text", "home.html", 0, footer_links.at(0).text());
}
```

### 2. Collect the Finding in `lmscript`

In the findings loop:

```lms
let footer_text = "";
for (k in range(0, findings.len())) {
  let item = findings.get(k, {});
  if (item.get("kind", "") == "footer_text") {
    footer_text = item.get("message", "");
  }
}
```

### 3. Assert with `check()`

```lms
let footer_ok = index_of(footer_text, "About") >= 0;
check(footer_ok,
  "Footer Link Text",
  footer_ok ? f"'{footer_text}' contains 'About'"
            : f"expected 'About' in footer link, got '{footer_text}'");
```

The `check(condition, name, detail)` helper updates the pass/fail tally and prints structured output.

---

## Deliverables Summary

| File | Purpose |
|---|---|
| `EXPLORE.md` | Findings from ad-hoc site exploration with `playwright-cli` |
| `neochart.lms` | Main integration test script written in real LMScript |
| `run.sh` | One-command runner that handles prerequisites and runs tests |
| `README.md` | Documentation for running, architecture, and extending tests |
