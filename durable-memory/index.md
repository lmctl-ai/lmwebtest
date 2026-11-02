# lmwebtest durable memory

lmwebtest provides reusable web UI testing infrastructure and an LMScript DSL (`context web: Web`) for multi-step integration testing.
The service owns the tool, scaffolding, conventions, and LMScript DSL host. Consumer website teams own and author their test cases.

- [Service ownership model](service-model.md): authoritative operator boundary.
- [Per-site convention](per-site-convention.md): central workspaces and run-on-change.
- [Architecture](architecture.md): original CLI and demo implementation notes.
- [Consumer onboarding](../docs/ONBOARDING.md): scaffold, author, run and aggregate.
- [Case study: neochart integration testing](case-study-neochart.md): integration testing of neochart.com.
- [Architectural decisions in web testing](decisions.md): decisions and workflow separation.
- [Case study: mock web application](case-study-mock-webapp.md): offline lmmock web app tested through lmhtml DOM extraction.
- [Adding a check to an integration test](how-to-add-a-check.md): guide for adding integration assertions.

CLI: test, screenshot, run [site|file|dir], init <site> [--url], batch, run --all.
DSL: `context web: Web`, `context report: Report`, compiled via `_dsl_ cli="lmwebtest"`.
Runtime: Node >=20 and Playwright Chromium.

## Test-owner team composition

Each consumer must stand up an **agy/agy/codex** test-owner team:
Lead = `agy` (Gemini 3.8 Flash), Coder = `agy` (Gemini 3.8 Flash),
Reviewer = `codex` (independent cross-reviewer). Affordable Gemini bulk case
authoring is paired with independent cross-provider Codex review; author !=
reviewer. Create the central workspace, author cases, and run batch on change.
The service owns the infrastructure; this recipe governs consumer teams.
The onboarding guide and generated site README include a starter `.lmctl`
teamfile with `model="Gemini 3.8 Flash (Medium)"` for both agy members.
