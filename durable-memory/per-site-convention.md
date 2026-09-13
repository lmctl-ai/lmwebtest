# Per-site web UI testing convention

Decision: lmwebtest is the standard reusable browser UI test tool. Keep suites
centrally at `sites/<site-id>/` inside lmwebtest, rather than duplicating the
runner and browser infrastructure in every website repository. Site teams own
their route expectations and update their central suite with relevant UI changes.
The website repository only needs an invocation in its workflow.

Each directory contains `playwright.config.ts`, `*.spec.ts`, and `README.md`.
Use a site-specific URL environment variable with a live default, bounded
timeouts, and isolated `test-results/<site-id>/` artifacts. Check each route's
HTTP 200, title and critical visible selectors; capture console errors, uncaught
page errors, failed requests and broken images; save full-page screenshots.

Run-on-change contract: once the site's changed build is served, its team runs
`lmwebtest run <site-id>` (after `npm link` in lmwebtest), or
`node /home/mma/repos/tools/lmwebtest/src/cli.js run <site-id>` from any repo.
The command is one-shot, suitable for an existing watcher or CI step. It does not
start or deploy the application. Exit 0 passes, 1 fails, 2 rejects invalid CLI
arguments. No target runs the isolated root demo suite. Named sites select their
own config; explicit file/directory filters retain Playwright behavior against
the root config. Runner execution always uses lmwebtest as its working directory.

First adopter: `sites/localweb`, URL `LOCALWEB_URL` or
`http://127.0.0.1:4173`. Five MPA routes: Overview `/`, `/tasks`, `/running`,
Math inbox `/comm/math`, and `/sessions/:team/:alias` discovered from `/tasks`.
The route suite reads live pages without mutating application data. Screenshots
and retained failure traces go under `test-results/localweb/`.

Role boundaries: lmwebtest validates browser-rendered UI; localwebcli validates
CLI behavior and contract integration. Both checks complement each other.

Next planned adopter: egtry.com. Add its central site folder after route scope
and selectors are established; it is not implemented by the localweb adoption.
