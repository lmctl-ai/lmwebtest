# Consumer onboarding

lmwebtest is a util/service project, like lmbio, lmsim and lmda. The lmwebtest
team owns the CLI, browser infrastructure, workspace conventions, templates and
batch aggregation. Each website's owner team authors, reviews and maintains its
own site-specific test cases. A supplied smoke scaffold is a starting point, not
an assertion that the service team has tested the application's features.

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

Save this starter as `<site>-tests.lmctl` in your project/workspace:

```text
# Website UI test-owner team: replace <site> with your site ID.
# Workspace: sites/<site>/ in lmwebtest.
# Lead coordinates; Coder authors; Reviewer independently cross-reviews.
_MEMBER_ alias=Lead provider=agy model="Gemini 3.8 Flash (Medium)"
_MEMBER_ alias=Coder provider=agy model="Gemini 3.8 Flash (Medium)"
_MEMBER_ alias=Reviewer provider=codex
```

The quoted model value uses the local agy label for Gemini 3.8 Flash (Medium).
Codex uses the consumer's configured model default. This is a starter teamfile,
without provider session IDs; scaffolding does not launch team members.

## Create your workspace

In lmwebtest, run `npm install`, `npm run browsers:install`, and optionally
`npm link`. Then, from any directory:

```sh
lmwebtest init my-site --url http://127.0.0.1:8080
```

Without npm link, use `node /home/mma/repos/tools/lmwebtest/src/cli.js` in place
of `lmwebtest`. The command creates `sites/my-site/playwright.config.ts`,
`routes.spec.ts` and `README.md` inside the tool repository. Existing directories
are never overwritten. Names use lowercase letters, digits and hyphens.
The optional URL defaults to `http://127.0.0.1:3000`; the generated config accepts
`MY_SITE_URL` (uppercase name with hyphens replaced by underscores, plus `_URL`).

You can also create those three files manually. Keep `testDir` within your site
folder and `outputDir` at `../../test-results/<site>/`. Use
[localweb](../sites/localweb/README.md) as the reference starter scaffold.

## Author your cases

The consumer team replaces the generic selector and expands `*.spec.ts` using
Playwright's `test` and `expect`:

```ts
import { test, expect } from '@playwright/test';

test('home is usable', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Your application/);
  await expect(page.locator('main')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  expect(errors).toEqual([]);
});
```

Choose routes, titles, selectors, valid empty states and assertions based on your
application's contract. Add console-error, failed-request and image checks where
appropriate. Register listeners before navigation. Use stable selectors and
explicit readiness assertions; keep actions safe for the configured environment.
The consumer team decides what coverage is required and keeps its README current.

## Run on change

Start or deploy your changed application, then run:

```sh
lmwebtest run my-site
MY_SITE_URL=http://127.0.0.1:8081 lmwebtest run my-site
lmwebtest run my-site --grep home
```

Add the command after server readiness in your existing watch/build/CI workflow.
It runs once; it does not watch, deploy or start consumer applications. No target
(`lmwebtest run`) runs lmwebtest's own demo and CLI regression suite.

## Batch execution

```sh
lmwebtest batch
# Equivalent:
lmwebtest run --all
```

Batch discovers immediate directories under `sites/` containing
`playwright.config.ts`, runs them sequentially in name order, and continues after
failures. All consumer targets must already be available. Batch accepts no extra
options; configure per-site behavior in each workspace. It overrides the output
directory to `test-results/<site>/` and reporters to list plus JSON for aggregation.
Consumer configs and tests are executable code and must come from trusted teams.

Stdout contains one JSON report, also saved at `test-results/batch-report.json`:
`ok`, ISO `timestamp`, `summary` totals, and `sites` entries with exit codes,
combined runner output and test counts. The saved report replaces the prior run.
Counts represent test cases, not retry attempts; eventual flaky passes count as
passed, and skipped tests count in totalTests with a per-site skippedTests count.
Runner/config/report errors can fail a site with zero failed test cases. Empty
discovery succeeds with zero totals. Exit 0 means all discovered sites passed,
1 means a test/runtime/report failure, and 2 means invalid CLI arguments.
Root `npm test` clears its output directory, including previous batch artifacts.
