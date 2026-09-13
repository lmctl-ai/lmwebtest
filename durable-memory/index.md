# lmwebtest — Durable Memory Index

`lmwebtest` is a lightweight tool and CLI for automated web page validation, screenshot capture, and Playwright test execution.

## Project Overview

- **Repository**: `https://github.com/lmctlhq/lmwebtest.git`
- **Primary Deliverable**: Lightweight CLI tool (`lmwebtest` / `src/cli.js`) to test web pages without heavy frameworks or external CLI parser dependencies.
- **Runtime Requirement**: Node.js >= 20, Playwright (`@playwright/test`).

## Core CLI Capabilities

1. **`lmwebtest test <url> [options]`**
   - Checks HTTP status code (defaults to 200, configurable via `--status`).
   - Verifies page title match via `--title "<expected>"`.
   - Asserts visibility of one or multiple DOM selectors via repeatable `--selector "<css>"`.
   - Validates that all loaded `<img>` tags are intact (checks for natural dimensions).
   - Monitors and flags runtime errors: console error messages, uncaught page errors, failed network requests, and HTTP >=400 resource responses.
   - Measures initial page navigation and load time (`loadTimeMs`).
   - Emits structured JSON result and uses standardized exit codes:
     - `0`: All checks passed.
     - `1`: Check failure or runtime error.
     - `2`: Invalid command-line arguments.

2. **`lmwebtest screenshot <url> --out <filepath> [--no-js]`**
   - Captures full-page headless screenshots.
   - Supports disabling JavaScript execution (`--no-js`) for testing static and server-side rendered previews.

3. **`lmwebtest run [site-id|file|dir] [options]`**
   - Delegates safely to the bundled Playwright test runner (`@playwright/test/cli`) without shell interpolation.

## Architecture & Codebase Layout

- **`src/cli.js`**: Standalone executable CLI using Node's built-in `node:util/parseArgs` and Playwright Chromium API.
- **`playwright.config.ts`**: Playwright test configuration with integrated webServer management and single-worker execution for local test stability.
- **`server.mjs` & `public/`**: Local test fixture server (Express + HTMX file explorer) used to validate the CLI and functional test suites offline.
- **`tests/`**:
  - `tests/cli-commands.spec.ts`: End-to-end tests for all CLI command behaviors, exit codes, and error reporting.
  - `tests/file-explorer.spec.ts`: Functional browser interaction tests.
  - `tests/security.spec.ts`: Path traversal security tests for web API endpoints.
  - `tests/helpers.ts`: Reusable Playwright fixtures and interaction helpers.

## Current State & Verification

- **Tests**: 15/15 tests passing cleanly via `npm test`.
- **Review**: Approved by team Reviewer (`claude`).
- **Git Policy**:
  - `durable-memory/` is committed and maintained across tasks.
  - `*.lmctl` and `.lmctl/` are ignored to prevent leaking machine-specific provider session tokens/IDs.

## Standard per-site workflow

- [Per-site convention](per-site-convention.md): central `sites/<site-id>/` configs, specs, and README; teams run `lmwebtest run <site-id>` after serving UI changes.
- First adopter: `sites/localweb`, five live routes using `LOCALWEB_URL` or port 4173.
- Browser UI checks belong to lmwebtest; CLI/contract integration belongs to localwebcli.
- Next planned adopter: egtry.com (not implemented yet).
