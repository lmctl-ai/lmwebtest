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
