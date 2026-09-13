# Util/service ownership model

Operator clarification: lmwebtest is a util/service project, like lmbio/lmsim/lmda.
The service team owns the tool, CLI, browser infrastructure, conventions, scaffold
and batch runner. Consumer teams (website owners) author, review and maintain
THEIR site's cases. lmwebtest does not write other teams' feature test suites.

Central hosting under sites/<site>/ does not transfer test ownership to the
service team. `init` supplies only a generic smoke starter; consumers choose
routes, assertions, readiness, valid empty states and coverage requirements.

Localweb is the first hand-off scaffold. Its earlier five-route service-authored
suite was intentionally replaced with one HTTP 200 / main#main home smoke case.
The localweb team owns further cases. localwebcli handles CLI/contract integration.
Next planned consumer is egtry.com; its owner team authors its suite.

Service regression tests belong in tests/. init and batch tests use disposable
isolated workspaces, so the tool's own verification does not require consumer
applications. Batch runs configured consumer sites and preserves per-site outcome
and output in test-results/batch-report.json, continuing after failures.
See ../docs/ONBOARDING.md for consumer instructions.
