# lmwebtest durable memory

lmwebtest is a util/service project providing reusable web UI testing infrastructure.
The service owns the tool, scaffolding, conventions and batch runner. Consumer
website teams own and author their test cases.

- [Service ownership model](service-model.md): authoritative operator boundary.
- [Per-site convention](per-site-convention.md): central workspaces and run-on-change.
- [Architecture](architecture.md): original CLI and demo implementation notes.
- [Consumer onboarding](../docs/ONBOARDING.md): scaffold, author, run and aggregate.

CLI: test, screenshot, run [site|file|dir], init <site> [--url], batch, run --all.
Runtime: Node >=20 and Playwright Chromium. src/cli.js handles commands;
src/sites.js provides scaffolding and batch aggregation. tests/ owns service
regression coverage; sites/ hosts consumer-owned cases. No new parser dependency.

Localweb is the reference starter scaffold (one home smoke case), default port
4173 via LOCALWEB_URL. Localweb owns further UI cases; localwebcli owns CLI/contract
integration. Next planned consumer: egtry.com, whose team will author its cases.

Batch reports: test-results/batch-report.json with ISO timestamp, aggregate site
and test counts, per-site exit codes and output. Generated artifacts and local
*.lmctl/.lmctl provider metadata remain ignored; durable-memory is maintained.

## Test-owner team composition

Each consumer must stand up an **agy/agy/codex** test-owner team:
Lead = `agy` (Gemini 3.8 Flash), Coder = `agy` (Gemini 3.8 Flash),
Reviewer = `codex` (independent cross-reviewer). Affordable Gemini bulk case
authoring is paired with independent cross-provider Codex review; author !=
reviewer. Create the central workspace, author cases, and run batch on change.
The service owns the infrastructure; this recipe governs consumer teams.
The onboarding guide and generated site README include a starter `.lmctl`
teamfile with `model="Gemini 3.8 Flash (Medium)"` for both agy members.
