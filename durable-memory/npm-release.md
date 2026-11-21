# npm releases of @lmctl-ai/lmwebtest

Two release channels, kept on the same version number:

- GitHub releases (`vX.Y.Z` with the Bun executables) are automatic: the `release` job in ci.yml runs on every push to main once the suites pass and picks the next patch after the latest GitHub release.
- npm (`@lmctl-ai/lmwebtest`) is published by `.github/workflows/release.yml`, run by hand: `gh workflow run release.yml -R lmctl-ai/lmwebtest --ref main`. It publishes the version in package.json if npm does not have it yet, through npm trusted publishing (OIDC, `--provenance`). No npm token exists anywhere.

To ship a version to npm: set package.json to the version the next GitHub release will get (`npm version X.Y.Z --no-git-tag-version`, so both channels carry the same number), commit, push, then run release.yml.

History:

- 0.1.0 (2026-11-13) was published by hand; release.yml had never succeeded, and the package had no trusted publisher, so its first run failed with `ENEEDAUTH` (2026-11-21).
- 0.1.73 (2026-11-21, GitHub release v0.1.73) was published with `lmauth publish ... --trust-repo lmctl-ai/lmwebtest --trust-file release.yml`, which also attached the trusted publisher. The operator clicked two approval pages (npm login, publish 2FA). Procedure: lmctl-ai/lmauth docs/npm-publish.md.
- From 0.1.74 on, release.yml should publish with no click. The first such run is the real test of the trusted publisher; if it fails with ENEEDAUTH again, check the trusted publisher on npmjs.com (repository lmctl-ai/lmwebtest, workflow release.yml, no environment).

Gotcha: right after a publish, `npm install @lmctl-ai/lmwebtest@NEW` can answer `notarget` for minutes. The version document (https://registry.npmjs.org/@lmctl-ai/lmwebtest/NEW) is already correct.
