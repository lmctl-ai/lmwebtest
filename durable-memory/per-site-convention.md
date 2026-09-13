# Per-site convention

Suites live centrally under sites/<site-name>/ within lmwebtest. This centralizes
tool infrastructure; consumer website teams retain ownership and authorship of
all site-specific cases. Each workspace has playwright.config.ts, *.spec.ts and
README.md. The service team provides a generic template through `lmwebtest init
<site-name> --url <url>` and never overwrites existing consumer workspaces.

Names use lowercase letters, digits and hyphens. Generated configs use an uppercase
site URL environment variable (hyphens become underscores), bounded timeouts,
and test-results/<site>/ artifacts. Consumers adapt the generic main selector,
expand coverage and keep their usage/readiness requirements in their README.

After serving a UI change, the consumer runs `lmwebtest run <site>` from any repo
(after npm link), or uses the absolute path to src/cli.js. The command is one-shot
and does not launch applications. No target runs the service's root tests.
`lmwebtest batch` / `lmwebtest run --all` discover configured site folders, run
sequentially, continue after failures and save test-results/batch-report.json.
Exit codes: 0 pass, 1 failure, 2 invalid CLI arguments.

First consumer scaffold: sites/localweb, LOCALWEB_URL or http://127.0.0.1:4173.
One home smoke test checks HTTP 200 and main#main. Localweb's team must author
additional cases; the former five-route suite is no longer the active contract.
Browser cases live here; localwebcli owns CLI/contract integration.
Next planned consumer: egtry.com, with test authorship assigned to its owner team.
See service-model.md and ../docs/ONBOARDING.md.

## Test-owner team composition

Each consumer must stand up an **agy/agy/codex** test-owner team:
Lead = `agy` (Gemini 3.8 Flash), Coder = `agy` (Gemini 3.8 Flash),
Reviewer = `codex` (independent cross-reviewer). Affordable Gemini bulk case
authoring is paired with independent cross-provider Codex review; author !=
reviewer. Create the central workspace, author cases, and run batch on change.
The service owns the infrastructure; this recipe governs consumer teams.
The onboarding guide and generated site README include a starter `.lmctl`
teamfile with `model="Gemini 3.8 Flash (Medium)"` for both agy members.
