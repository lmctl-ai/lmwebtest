# npm releases of @lmctl-ai/lmwebtest

Fully automatic since 2026-11-21. A push to main that passes CI ends up on npm with no human step:

1. ci.yml's `release` job (after test, webapp, upload and playwright-host pass) picks the next patch after the latest GitHub release, builds the Bun executables and creates `vX.Y.Z`.
2. The same job dispatches `.github/workflows/release.yml` with `tag=vX.Y.Z` (job permission `actions: write`). A release created with the workflow token starts no workflow by itself, but a workflow_dispatch does.
3. release.yml checks out the tag, sets package.json to X.Y.Z (the committed `version` field is not used), and runs `npm publish --provenance` through npm trusted publishing (OIDC). It then waits until the registry's version document shows X.Y.Z with a provenance attestation.
4. release.yml also runs hourly (minute 41) and publishes the latest release if npm lacks it, so a failed dispatch only delays npm. A version already on npm is skipped; an older tag published late gets the dist-tag `backfill`, not `latest`.

By hand, for one tag: `gh workflow run release.yml -R lmctl-ai/lmwebtest --ref main -f tag=vX.Y.Z`.

npm trusts the workflow by file name (repository lmctl-ai/lmwebtest, workflow release.yml, no environment). Renaming the file or adding a GitHub environment breaks publishing with ENEEDAUTH until the trusted publisher is changed on npmjs.com or with `lmauth publish --trust-repo ... --trust-file ...` (lmctl-ai/lmauth docs/npm-publish.md).

History:

- 0.1.0 (2026-11-13) was published by hand. The first release.yml run (2026-11-21) failed with ENEEDAUTH: the package had no trusted publisher.
- 0.1.73 (2026-11-21) was published with `lmauth publish ... --trust-repo lmctl-ai/lmwebtest --trust-file release.yml`, which also attached the trusted publisher. The operator clicked two approval pages (npm login, publish 2FA).
- From then on release.yml publishes every GitHub release. GitHub v0.1.72 and earlier are not on npm. The next-version step in ci.yml skips numbers npm already has, so after v0.1.72 the next GitHub release is v0.1.74 (npm 0.1.73 was the hand publish, from commit 20a129a).

Gotchas: right after a publish, `npm install @lmctl-ai/lmwebtest@NEW` can answer `notarget` for minutes while the package document catches up; the version document is right at once. The provenance attestation names the workflow run on main, while the published files come from the tag's commit (the same commit when CI dispatches it).
