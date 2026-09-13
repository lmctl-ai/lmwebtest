# localweb browser checks

Run after any localweb UI change, with the live application already running:

```sh
lmwebtest run localweb
# Without npm link, from any repository:
node /home/mma/repos/tools/lmwebtest/src/cli.js run localweb
# Override the live target:
LOCALWEB_URL=http://127.0.0.1:4173 lmwebtest run localweb
```

| Route | Expected title | Critical content |
| --- | --- | --- |
| `/` | Overview | `main#main`, `[data-testid="page-intro"]` |
| `/tasks` | Tasks | intro, task filter form, table |
| `/running` | Running | section table |
| `/comm/math` | Math inbox | Requests and replies section |
| `/sessions/:team/:alias` | Session: | `#session-detail`, `#comm-messages` |

The session URL comes from the first session link on `/tasks` (currently
`/sessions/law2/Lead`). Missing session links fail the check rather than skip it.
All routes check HTTP 200, title, heading, main region, visible critical content,
zero console/page/network/HTTP resource errors, and zero broken or unfinished
images. Each successful route captures a full-page PNG in
`test-results/localweb/<test-name>/`, attached to its test result; failures retain
Playwright traces and failure screenshots. Later asynchronous activity beyond
the observation window is not covered. No forms are submitted or data changed.

This suite does not launch or reset localweb. Default URL:
`process.env.LOCALWEB_URL || 'http://127.0.0.1:4173'`.
Use `lmwebtest run localweb --list` to list checks without contacting the site,
or `--grep tasks` to select a route. Each run replaces previous output artifacts.
