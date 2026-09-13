# localweb consumer hand-off

**The localweb team owns and authors the test cases in this workspace.**
lmwebtest provides the runner, infrastructure, scaffold and batch reporting.
The previous service-authored route suite has been replaced by one starter smoke
case: load `/`, expect HTTP 200, and verify `main#main` is visible. This is not
complete localweb feature coverage. Localweb owners should expand or replace the
starter with their own routes, expectations, valid empty states and screenshots.

Target: `process.env.LOCALWEB_URL || 'http://127.0.0.1:4173'`.
Start localweb yourself, then run after each UI change:

```sh
lmwebtest run localweb
LOCALWEB_URL=http://127.0.0.1:4173 lmwebtest run localweb
# Without npm link, from any directory:
node /home/mma/repos/tools/lmwebtest/src/cli.js run localweb
```

Artifacts go to `test-results/localweb/`; failures retain screenshots and traces.
`lmwebtest batch` includes this workspace alongside other configured sites.
See [consumer onboarding](../../docs/ONBOARDING.md) for authoring and workflow
instructions. localwebcli owns CLI/contract integration; browser cases belong
here and are maintained by localweb's consumer team.

## Team Recipe for Test-Owner Teams

Each website's test-owner team must use **agy/agy/codex**:

| Role | Provider | Model / responsibility |
| --- | --- | --- |
| Lead | `agy` | Gemini 3.8 Flash; coordinate scope and completion |
| Coder | `agy` | Gemini 3.8 Flash; author and maintain test cases |
| Reviewer | `codex` | Independent cross-reviewer from a different provider |

The recipe pairs affordable, high-throughput Gemini case generation with
independent cross-provider Codex review. The author must not review their own
work: the Coder authors cases, and the Reviewer independently checks coverage,
assertions and execution evidence before signoff.

Mandate: To own a website's UI tests, stand up a test-owner team as agy/agy/codex,
create your workspace under the lmwebtest convention, author cases, and run in
batch on change once the consumer targets are ready.

Save this starter as `localweb-tests.lmctl` in your project/workspace:

```text
# Website UI test-owner team: replace localweb with your site ID.
# Workspace: sites/localweb/ in lmwebtest.
# Lead coordinates; Coder authors; Reviewer independently cross-reviews.
_MEMBER_ alias=Lead provider=agy model="Gemini 3.8 Flash (Medium)"
_MEMBER_ alias=Coder provider=agy model="Gemini 3.8 Flash (Medium)"
_MEMBER_ alias=Reviewer provider=codex
```

The quoted model value uses the local agy label for Gemini 3.8 Flash (Medium).
Codex uses the consumer's configured model default. This is a starter teamfile,
without provider session IDs; scaffolding does not launch team members.
