# Architecture & Implementation Notes

## CLI Design (`src/cli.js`)
- **Zero-Dependency Argument Parsing**: Utilizes `node:util/parseArgs` from standard Node.js library to keep the tool lightweight and eliminate external CLI framework bloat.
- **Strict Input Validation**:
  - Protocols restricted strictly to `http:` and `https:`.
  - Timeouts and HTTP status codes validated with strict regular expressions (`/^\d+$/`, `/^\d{3}$/`).
  - Required arguments (such as `--out` for screenshots) verified before browser launch.
- **Playwright Chromium Lifecycle**:
  - Launches headless Chromium instance per invocation.
  - Attaches listeners for `console`, `pageerror`, `requestfailed`, and `response` before navigating to capture startup errors.
  - Ensures clean browser shutdown in a `finally` block regardless of failure mode.
- **Subprocess Delegation for `run`**:
  - Uses `spawn` passing argument vectors directly rather than shell strings, avoiding command injection vulnerabilities.

## Demo Server & Fixtures (`server.mjs`)
- Serves as an integrated offline target for testing.
- HTMX 1.9.10 is vendored in `public/vendor/` to avoid remote CDN dependencies during automated test execution.
- Reset endpoint `/api/reset` re-initializes seeded files in `docroot/` before each test run.
