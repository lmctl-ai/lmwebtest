# egtry.com Book Switch Integration Test (`egtry`)

Reusable `lmscript` + `lmhtml` integration test suite for verifying `egtry.com` programming books after a v2 content switch.

## Usage

```bash
# Default: --book python --host www.egtry.com
./run.sh

# Explicit book and host
./run.sh --book python --host www.egtry.com

# Optional flags
./run.sh --book python --host www.egtry.com \
  --v1-host v1.egtry.com \
  --url-map /home/ubuntu/repos/lmctlhq/interp-docs/docs/design/simple-viewer/poc/v7/url-map.json
```

## What It Checks

For every kept URL of `/<book>/` in `url-map.json` (plus the book index `/<book>/`):

1. **HTTP 200 Capture**: Fetches the book index `/<book>/` and all kept lesson pages in parallel with `curl` (`-Z --parallel-max 16`) and verifies every kept URL responds `HTTP 200`.
2. **DOM Extraction (`lmhtml` via `_lmcode_`)**: Compiles an `_lmcode_ cli="lmhtml"` block and executes `lmhtml` over `work/pages/` and `work/tracks_*.html` to extract `<title>`, `<h1>`, `links()`, `<link rel="stylesheet">`, `<script src>`, `.sv` / `.sv-run` example elements, `nav.sv-pager a`, and `nav.sv-crumbs a`.
3. **Metadata & Headings**: Verifies every kept page has a non-empty `<title>` and `<h1>`.
4. **Executable Example Viewer Elements**: Verifies every lesson page contains `.sv[data-example]` example blocks and loads `page.js` (or static `.sv-run` buttons).
5. **Viewer Assets**: Verifies viewer stylesheets (`simple.css`, `chapter.css`) and scripts (`page.js`) resolve and return `HTTP 200`.
6. **Previous / Next / All-Pages Navigation**: Verifies `nav.sv-crumbs` and `nav.sv-pager` (`rel="prev"`, `rel="next"`, and `All pages` index link) on every lesson page resolve to valid kept URLs returning `HTTP 200`.
7. **Internal Relative Links**: Resolves all relative and root-relative links across the book and verifies zero broken internal links (`HTTP 200`).
8. **Tracks Page Comparison**: Fetches `https://<host>/tracks/programming-languages/` and `https://<v1-host>/tracks/programming-languages/`, compares title/heading/links, and verifies the `/<book>/` link is present and returns `HTTP 200`.
