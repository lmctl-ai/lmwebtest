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

## Physics R42 (`--physics` / `physics.lms`)

```bash
./run.sh --physics --book mechanics --host www.egtry.com
./run.sh --physics --book mechanics --host v2.egtry.com \
  --report /path/to/interp-worktree/docs/spikes/v7-switch-mechanics-qa.md
# Development sample only: HTTP still checks every legacy + target slug.
./run.sh --physics --book mechanics --host www.egtry.com --pages 2 --seed 731
# Suite regression tests (working and deliberately broken local fixtures):
flock /tmp/browser-gate.lock node --test physics-helper.test.mjs
```

`physics.lms` calls the Playwright CLI helper under `flock /tmp/browser-gate.lock`.
Requires Node, lmscript, Playwright and installed Chromium; `CHROME=/path/to/chrome`
selects a system Chrome. Physics mode uses Playwright DOM extraction, without
installing/downloading lmhtml. Run `npm ci` in a fresh lmwebtest worktree first.
`--host` and `--v1-host` accept a hostname or full local HTTP origin.

Default coverage is **every page**, every model and every exercise at **1280×900
and 390×900**. The independent legacy index (default `v1.egtry.com`) supplies old
slugs: the target index must list each, its lesson links must stay on the target
origin, and every old/new lesson must return 200 at its original path. Index and
lesson metadata, horizontal overflow, console/page errors and failed network
requests are checked. A missing legacy slug is tested even if omitted from the
target index. New lesson slugs are checked too.

Each model canvas must contain varied pixels, change pixels at two separate
moments while playing, stop changing when paused, advance with Step and stay
paused afterward. Every exercise must show worked steps after a wrong answer;
the visible solution supplies the answer, then reloading `?seed=731` must
reproduce the problem and accept that answer; Next must change the problem.
Missing widgets and unsupported contracts **fail**. A legacy static page is an
expected negative baseline, never accepted as a completed R42 page. Static
physical models use the explicit parameter-change adapters described below;
unsupported models fail rather than receiving fake animation.

Public DOM contract (coordinate with the physics framework owner):

| Part | Default selector / state |
|---|---|
| Model root / scene | `[data-physics-model]` or `.physics-model`; first `canvas` (2D) |
| Play / Pause / Step | `[data-action="play"]` (or `.ph-play`); Pause uses same button or `[data-action="pause"]`; `[data-action="step"]` (or `.ph-step`) |
| Playing indication | Pause label or Play `aria-pressed="true"` |
| Exercise root | `[data-physics-exercise]` or `.physics-exercise`; `data-state="open\|wrong\|shown\|right"` |
| Input / Check / Next | `[data-answer-input]` (or text/number input); `[data-action="check"]`; `[data-action="next"]` |
| Problem / solution | `[data-problem]`; `[data-worked-solution]` (visible worked steps after wrong answer) |
| Visible worked answer | solution descendant `[data-solution-answer="6"]` (numeric/text value to type) or `[data-solution-answer]` whose text is the answer |
| Feedback | `[role="status"]` or `.ph-feedback` |

`--selectors FILE` merges a JSON object into the selectors in
`physics-helper.mjs` (`model`, `canvas`, `play`, `pause`, `step`, `exercise`,
`input`, `check`, `next`, `problem`, `solution`, `answer`, `feedback`). It adapts
names only; it never suppresses checks. Seed reproduction and exercise state
remain required. The learner-visible worked solution is used for the right
answer test; no private engine internals or arbitrary expected answer is used.
This is interaction QA, not independent scientific verification of that answer.

Per-check PASS/FAIL evidence goes to `work/physics_report_<book>.json` and `.txt`;
`--out-dir DIR` changes that directory. `--report FILE` additionally writes a
Markdown table with Overall Verdict suitable for `v7-switch-<book>-qa.md`.
Any failed check exits nonzero; invalid CLI arguments exit 2. `--pages N` keeps
first/last plus seeded interior pages and marks the report **sample-only**;
it is insufficient for whole-book signoff. Reports omit scientific judgement:
agy QA must add tested revisions, severity and physical correctness findings.

### Physics second-review checks and static applets

The suite now completes the **actual worked replay**, using the shared
`.mb-player` Step control: equations AND explanatory notes must be perceptible,
steps must advance, and the completed board must include at least the law,
substitution, calculation and check. A prose/answer-only box, hidden steps,
transparent steps, same-colour text on a solid background or a hidden answer fails. The visible dimensioned answer must
agree with its answer attribute. After revealing a solution, the suite also
reloads and rejects a numerically wrong value WITH VALID UNITS, then a value
with incompatible dimensions, before testing the correct answer and Next.
The JSON/text/Markdown evidence includes the completed equations and notes so
reviewers can audit the actual teaching procedure.

Static applets have their own behavior checks; a clock is not required:

| Applet | Supported contract | Required interaction |
|---|---|---|
| Quantity calculator | `[data-physics-solver]` or `[data-physics-quantity]` | Visible numeric parameter changes the dimensioned result AND worked replay; restoring givens restores result |
| Quantity response plot | `[data-physics-model][data-model-kind="quantity"]` | Nonblank canvas, parameter/result/replay checks, and canvas responds to the changed quantity |
| Static physical explorer | `[data-physics-model][data-model-mode="static"]` | Nonblank canvas, changed parameter updates result, geometry/plot pixels AND worked replay |
| Time model | Other `[data-physics-model]` roots | Nonblank/animating canvas, Play/Pause/Step and worked replay |

Calculator controls use `[data-quantity-parameter]` or `.ph-controls input[type=number]`,
and results use `[data-quantity-result]` or `.ph-measure` (optional label followed
by `:` or `=`). An explicit `[data-action=calculate]` is clicked when present;
automatic change handlers are supported too. The finite real-amplitude adapter
can change `a` AND `b` together through Calculate to preserve normalization; it
tries normalized basis and 3–4–5 pairs rather than perturbing a constrained state
one coordinate at a time. When a canvas is present, that coordinated change must
update its pixels too. This is an interaction probe, not a new source model.
Other constrained state spaces need an explicit scientifically valid adapter.

Additional selector keys are `solver`, `parameter`, `result`, `staticParameter`,
`staticResult`, `modelWorked`, `replay`, `replayStep`, `replayLine`, `replayNote`.
`physics-checks.mjs` contains the shared replay/quantity probes.
Run both adversarial suites under the browser gate:

```bash
flock /tmp/browser-gate.lock node --test --test-concurrency=1 \
  physics-helper.test.mjs physics-quantity.test.mjs
```

The fixtures additionally reject frozen calculator outputs, output changes with
stale steps, hidden/same-colour equations or captions, frozen canvases after
coordinated normalized inputs, hidden results, answer attributes inconsistent with visible answers,
and accepting valid-unit wrong answers or incompatible dimensions. These fixtures
establish suite sensitivity; they do not certify a book's scientific correctness.

For bounded/discrete domains, `--scenarios FILE` supplies a JSON object mapping
family IDs to arrays of valid **givens only**, with parameter names as keys.
The UI must still change its visible result, canvas (where present) and worked
steps and restore the original result. Scenarios never supply expected answers
or suppress checks. From an interp-docs worktree, generate reviewed inputs with:

```bash
node scripts/physics/qa-scenarios.mjs --book BOOK --out /tmp/BOOK-qa-inputs.json
# Then, from lmwebtest/egtry:
./run.sh --physics --book BOOK --host HOST --scenarios /tmp/BOOK-qa-inputs.json
```

Reports record the helper/check module SHA-256 hashes at execution and the
scenario file hash, which identifies code/input evidence even while worktrees
are awaiting the shared browser lock.

### New books, readable procedures and queued-run progress

`--inventory /path/to/interp-docs/durable-memory/physics-track-inventory.json`
keeps the live v1 baseline for **every old book**. Only a book explicitly listed
in `new_books` (and absent from `books`) uses its planned chapter/page slugs as
its independent reference, since that new URL has no v1 predecessor. Its report
says `Legacy: none (new book; committed physics inventory)` and records the
inventory hash. Missing/duplicate/unsafe planned slugs fail; an old book can
never gain an exemption merely by also appearing in `new_books`.

Replay extraction batches DOM reads while preserving Step advancement, visible
MathML equations and notes, and hidden/transparent descendant detection. Ink is
compared against composited solid CSS backgrounds; readable light chalk on a dark
board remains supported. Equations
must not expose program properties (`e.force`), arrow functions, template fragments,
undefined/NaN/Infinity values, or a numeric-substitution caption without numbers.
The independent scientific review remains necessary; readable text alone cannot
prove a physical derivation.

`work/physics_progress_<book>.json` (or the selected `--out-dir`) is atomically
updated with current page/width, completed visits, counts, last failure and code
hashes during a long run. Final reports remain exhaustive. The automated report
marks Scientific Review NOT PERFORMED; agy must complete that review and change
the marker before the lead's switch gate accepts its Overall PASS.


### Optional parallel lesson pages

`--workers 2` runs two lesson pages concurrently in ONE Chrome browser while
`physics.lms` retains `/tmp/browser-gate.lock`. Default is `--workers 1`;
only 1 and 2 are supported. Every selected page still runs all model/exercise,
console/network and layout checks at BOTH widths. Index discovery and exhaustive
HTTP coverage are unchanged. Reports record requested workers and actual peak
concurrent lesson pages; progress includes the active pages. Named checks can
interleave, so assess them by URL/width rather than output order.

The full adversarial fixture compares the complete named check set between serial
and parallel runs and verifies two active pages, four completed visits and every
mutation rejection. A separate real-model Mechanics smoke covers actual animated
and static models; sampling remains explicitly `sample-only` and cannot substitute
for whole-book acceptance.

```bash
./run.sh --physics --book mechanics --host HOST --workers 2 --report REPORT.md
```


### Browser lock ownership

`run.sh --physics` owns the browser gate; an extra outer flock is unnecessary.
The Linux wrapper also supports an existing exclusive outer flock without
acquiring a second description of the same lock. `browser-lock.sh` verifies
actual exclusive ownership and propagates validated context across LMScript's
process bridge. Separate callers still serialize, and stale context cannot
bypass the gate or retain a lock in an unrelated parent.

Use the official `run.sh` entrypoint when wrapping an existing lock. A raw
`flock ... lmscript physics.lms` call loses inherited descriptors in the process
bridge and now fails promptly with guidance instead of deadlocking. Direct
unwrapped `lmscript physics.lms` still acquires the gate normally.

`node --test browser-lock.test.mjs` tests standalone/nested execution, mutual
exclusion, stale context, descriptor lifetime, exit propagation and the actual
LMScript entrypoint, using temporary locks and no Chrome process.
