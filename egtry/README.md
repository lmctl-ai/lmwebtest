# egtry.com Book Switch Integration Test (`egtry`)

Reusable `lmscript` + `lmhtml` integration test suite for verifying `egtry.com` programming books after a v2 content switch.

## Usage

```bash
# Default: --book python --host www.egtry.com
./run.sh

# Explicit book and host
./run.sh --book python --host www.egtry.com
./run.sh --book bash --host www.egtry.com
./run.sh --book c --host www.egtry.com
./run.sh --book cpp --host www.egtry.com
./run.sh --book csharp --host www.egtry.com
./run.sh --book dart --host www.egtry.com
./run.sh --book javascript --host www.egtry.com
./run.sh --book typescript --host www.egtry.com
./run.sh --book go --host www.egtry.com
./run.sh --book java --host www.egtry.com
./run.sh --book kotlin --host www.egtry.com
./run.sh --book lua --host www.egtry.com
./run.sh --book perl --host www.egtry.com
./run.sh --book php --host www.egtry.com
./run.sh --book ruby --host www.egtry.com
./run.sh --book rust --host www.egtry.com
./run.sh --book scala --host www.egtry.com
./run.sh --book sql --host www.egtry.com
./run.sh --book swift --host www.egtry.com
./run.sh --book arithmetic --host www.egtry.com
./run.sh --book prealgebra --host www.egtry.com
./run.sh --book algebra --host www.egtry.com
./run.sh --book precalculus --host www.egtry.com
./run.sh --book calculus --host www.egtry.com
./run.sh --book linear-algebra --host www.egtry.com
./run.sh --book numerical-methods --host www.egtry.com
./run.sh --book probability-statistics --host www.egtry.com
./run.sh --book analytic-geometry --host www.egtry.com
./run.sh --book html --host www.egtry.com
./run.sh --book css --host www.egtry.com
./run.sh --book svg --host www.egtry.com

# Optional flags
./run.sh --book c --host www.egtry.com \
  --v1-host v1.egtry.com \
  --url-map /home/ubuntu/repos/lmctlhq/interp-docs/docs/design/simple-viewer/poc/v7/url-map.json

# Headless Chrome (Playwright) QA suite for a book (under flock /tmp/browser-gate.lock)
./run.sh --chrome --book python --host www.egtry.com
./run.sh --chrome --book c --host www.egtry.com
./run.sh --chrome --book go --host www.egtry.com
./run.sh --chrome --book python --host www.egtry.com --pages 10 --seed 42

# Headless Chrome (Playwright) R37 Homepage QA suite (under flock /tmp/browser-gate.lock)
./run.sh --home --host www.egtry.com
./run.sh --home --host v2.egtry.com
./run.sh --home --host www.egtry.com --seed 3 --autoplay-count 4 --sample-count 40 --min-fit-pct 95
./run.sh --home --host www.egtry.com --forbid-hero-words "book,books,tex,katex,static math" --expected-title "Egtry: learn by watching code run"
./run.sh --home --host www.egtry.com --allow-legacy-hero
```

## Homepage R37 QA Suite (`--home` / `home.lms`)

For a local HTTP candidate with unchanged pages on the live site, run
`./run.sh --home --host http://127.0.0.1:8099 --site-host www.egtry.com --seed 3`.
This also checks the HTTP-to-HTTPS redirect regression: CSS/JS responses must be
counted against the final document origin, with the existing HTTP 200 assertions intact.

Pass `--home` to `./run.sh` (or run `lmscript home.lms --host <host> [options]`) to run the repeatable R37 homepage QA suite (`docs/design/simple-viewer/15-homepage.md`) in headless Chrome via Playwright under `flock /tmp/browser-gate.lock`:

1. **Static DOM & Structure (`curl` + `lmhtml` + Chrome)**: Verifies `<header class="home-hero">`, `section#player.home-player[aria-label="Example player"]`, `section#tracks.tracks` (`>= 14` track cards), `<footer>`, absence of `"Featured diagrams"` / `.featured`, and standard player controls (`Run`, `Step`, `⚙` visible; `Edit` hidden; `Next` hidden in `auto` mode).
2. **Hero Copy Wording & Title (Configurable Params)**: Verifies document `<title>` against `--expected-title` (default: `"Egtry: learn by watching code run"`), and visible text in `.home-hero` against `--forbid-hero-words <csv>` (default: `"book,books,tex,katex,static math"`, or pass `--allow-legacy-hero` to allow pre-polish wording) and `--require-hero-words <csv>` (default: `"interactive lessons,19 programming languages,14 tracks"`).
3. **Page Weight Before Player Loads**: Measures decoded byte weight of HTML + CSS + static JS modules before `books.json`, `pages/<book>.json`, or `data/<example>.json` are fetched (`<= 120 KB`, all `HTTP 200`).
4. **Responsive Layout (`1280×900` and `600×900`)**: Verifies zero horizontal overflow (`scrollWidth <= innerWidth`) and bounded player width at both `1280 px` and `600 px`.
5. **Autoplay Sequence (`>= 4` Examples in a Row)**: Verifies the player autoplays `>= 4` distinct examples in a row across different books with `~3 s` pauses between examples, `.sv-rs` cycling through `▶ Running` -> `■ Ended`, and clean `.sv-note` value comments (`0` leaked internals).
6. **`Open page →` Links**: Verifies the `Open page →` link of every autoplayed example returns `HTTP 200` (along with its `data/<example>.json`) and contains `.sv[data-example="<id>"]`.
7. **`Step`, `Next`, No Way Back, & Refresh**: Verifies clicking `Step` stops autoplay permanently (`data-mode="manual"`) and shows `Next`; completing an example in manual mode stays put after `> 3.5 s` (no way back to autoplay); clicking `Next` loads a different example in `data-state="ready"` (`○ Not started`) without auto-starting; and refreshing the page restores `data-mode="auto"` and restarts autoplay.
8. **`prefers-reduced-motion: reduce`**: Verifies reduced-motion starts in `data-mode="manual"` with `Next` visible and `data-state="ready"` (`○ Not started`), without autoplay.
9. **Blocked Example Fetch Recovery**: Verifies an `HTTP 500` on the first example recording request is skipped and the player seamlessly loads and plays another example with `.sv-error` hidden.
10. **Player Window Fit (`12–26` Rows, `>= 95%` of `40` Sampled Examples Without Internal Scrolling)**: Samples `40` examples in the homepage player window at `1280 px` and `600 px` and verifies all `40/40` example windows have heights within `12–26` rows (`268–562 px`) and `>= 95%` fit without internal scrolling.
11. **Site-Wide Non-Regression URLs**: Verifies `/`, `/index.html`, `/books/`, `5` track pages, `3` non-programming book pages, `/python/`, `/go/`, and `/tracks/programming-languages/` all return `HTTP 200` with `100%` of their CSS/JS subresources returning `HTTP 200` and `0` console errors.
12. **Reports**: Outputs `[PASS]` / `[FAIL]` per check, writes JSON and text reports to `work/home_report_<host>.json` (`.txt`) and `work/home_report.json` (`.txt`), and exits non-zero on any failure.

## Headless Chrome QA Suite (`--chrome` / `chrome.lms`)

Pass `--chrome` to `./run.sh` (or run `lmscript chrome.lms --book <id> --host <host> [--pages N] [--seed S]`) to run the repeatable browser QA suite in headless Chrome via Playwright under `flock /tmp/browser-gate.lock`:

1. **Tracks Link Navigation**: Opens `https://<host>/tracks/programming-languages/` in Chrome, verifies the `/<book>/` link is present, and clicks it to navigate to `https://<host>/<book>/` (`HTTP 200`).
2. **Book Index & Deterministic Page Sampling**: Discovers all lesson links on `/<book>/` in reading order via `lmhtml` (`_lmcode_`), verifies `/<book>/` in Chrome, and samples `N` lesson pages (default `10`: the first lesson, the last lesson, and `N - 2` deterministic seeded random interior lessons).
3. **Run State & Value Comments**: On each sampled page, clicks `Run` (`.sv-run`) and verifies the run-state label (`.sv-rs`) transitions `○ Not started` -> `▶ Running` -> `■ Ended`, value comments (`.sv-note`) appear (`//...`), and no leaked internals (`[object Object]`, `__lm`, `<object`, `Traceback`) appear.
4. **Recorded Output Matching**: Fetches `data/<example>.json` for each sampled page and verifies the viewer's rendered `out:` notes/titles match the recorded `output` events in the trace.
5. **Step & Edit Controls**: Verifies clicking `Step` (`.sv-step`) enters `data-state="stepping"` at `step=1` (`▶ Running`) with the current line highlighted, and clicking `Edit` (`.sv-edit-btn`) enters `data-state="edit"` (`○ Not started`, `aria-pressed="true"`) with the editable `.sv-edit` textarea populated with the recorded source.
6. **Pager & Breadcrumbs Navigation**: Verifies `nav.sv-crumbs` and `nav.sv-pager` (`rel="prev"`, `rel="next"`, and `All pages`) on every sampled page, including live browser click navigation on `next` from the first page and `prev` from the last page.
7. **Zero Console or Network Errors**: Verifies zero `console.error`, zero `pageerror`, and zero failed HTTP requests (`status >= 400`) on every visited page.
8. **Reports**: Outputs `[PASS]` / `[FAIL]` per check, writes JSON and text reports to `work/chrome_report_<book>.json` (`.txt`) and `work/chrome_report.json` (`.txt`), and exits non-zero on any failure.

## Default HTTP + DOM Suite (`egtry.lms`) — What It Checks

For every kept URL of `/<book>/` in `url-map.json` (plus the book index `/<book>/`):

1. **HTTP 200 Capture**: Fetches the book index `/<book>/` and all kept lesson pages in parallel with `curl` (`-Z --parallel-max 16`) and verifies every kept URL responds `HTTP 200`.
2. **DOM Extraction (`lmhtml` via `_lmcode_`)**: Compiles an `_lmcode_ cli="lmhtml"` block and executes `lmhtml` over `work/pages/` and `work/tracks_*.html` to extract `<title>`, `<h1>`, `links()`, `<link rel="stylesheet">`, `<script src>`, `.sv` / `.sv-run` example elements, `nav.sv-pager a`, and `nav.sv-crumbs a`.
3. **Metadata & Headings**: Verifies every kept page has a non-empty `<title>` and `<h1>`.
4. **Executable Example Viewer Elements**: Verifies every lesson page contains `.sv[data-example]` example blocks and loads `page.js` (or static `.sv-run` buttons).
5. **Viewer Assets**: Verifies viewer stylesheets (`simple.css`, `chapter.css`) and scripts (`page.js`) resolve and return `HTTP 200`.
6. **Previous / Next / All-Pages Navigation**: Verifies `nav.sv-crumbs` and `nav.sv-pager` (`rel="prev"`, `rel="next"`, and `All pages` index link) on every lesson page resolve to valid kept URLs returning `HTTP 200`.
7. **Internal Relative Links**: Resolves all relative and root-relative links across the book and verifies zero broken internal links (`HTTP 200`).
8. **Tracks Page Comparison**: Fetches `https://<host>/tracks/programming-languages/` and `https://<v1-host>/tracks/programming-languages/`, compares title/heading/links, and verifies the `/<book>/` link is present and returns `HTTP 200`.
