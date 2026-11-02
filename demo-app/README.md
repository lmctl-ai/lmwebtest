# Mock Web Application Integration Test

Fully offline, deterministic integration test for an interactive web application, built with `lmmock`, `lmcode`, `lmscript`, and `lmhtml`.

---

## Overview

Unlike external live-site tests that depend on network connectivity and third-party uptime, this suite runs entirely offline on loopback (`127.0.0.1:0`). It validates:
- HTTP session cookie authentication (`Set-Cookie`, `HttpOnly`, `SameSite=Lax`).
- Protected routes redirecting unauthenticated requests.
- Server-side stateful counters updated via button clicks.
- Extraction of raw HTML DOM elements using `lmhtml` to drive form submissions and button interactions dynamically from the parsed document rather than hardcoded endpoints.

---

## Architecture

```
┌──────────────────┐
│   lmmock exec    │  (Allocates loopback port, runs client test, propagates exit code)
└────────┬─────────┘
         │ binds 127.0.0.1:0, sets LMMOCK_URL
         ▼
┌──────────────────┐               HTTP requests / cookies
│  demo-app/       │◄─────────────────────────────────────┐
│  app.lms         │ (Go loopback host + lmcode handlers) │
└──────────────────┘                                      │
                                                          │
┌──────────────────┐      raw HTML      ┌─────────────────┴─┐
│  lmhtml          │◄───────────────────┤   demo-app/       │
│  (Lexbor parser) │   DOM findings     │   webapp.lms      │
└────────┬─────────┘───────────────────►│   (LMScript test) │
         │ (extracts actions, buttons)  └───────────────────┘
```

1. **`app.lms`**: The mock web application. Written in `lmcode` SAM handlers compiled against `schema.json`. It provides `/health`, `/login`, `/dashboard`, `/click`, `/reset`, and `/logout`.
2. **`webapp.lms`**: The test script written in `lmscript`. Reads `LMMOCK_URL`, communicates via `curl` with a cookie jar, parses raw HTML responses with `lmhtml`, extracts form actions and button IDs, and evaluates 26 assertions.
3. **`run.sh`**: Runner script that verifies prerequisites, ensures `lmmock` and `lmhtml` binaries are present and checksum-verified (latest, by design; breakage is fixed forward), compiles `app.lms` to bytecode, and runs `lmmock exec`.

---

## Authentication & Credentials

This is a local test fixture, not a production service. Fixed test credentials are:

- **Username**: `demo`
- **Password**: `demo-pass`

### Session Lifecycle

1. `POST /login` validates credentials with `secure_equal()`.
2. On success, a cryptographic token is generated via `random_token()` and saved in server memory (`x.set("session:" + token, username)`).
3. The server responds with `HTTP 303` redirecting to `/dashboard` and sets `Set-Cookie: session=<token>; Path=/; HttpOnly; SameSite=Lax`.
4. Protected routes (`GET /dashboard`, `POST /click`, `POST /reset`, `POST /logout`) inspect incoming cookies via `x.header("Cookie")`.
5. `POST /logout` removes the token from memory (`x.take("session:" + token)`), clears the cookie header, and redirects to `/login`.

### CSRF Design Note

Cross-Site Request Forgery (CSRF) protection tokens are intentionally omitted from this mock. The mock application is designed specifically to test DOM extraction, cookie handling, and state manipulation in command-line integration test environments. In production web applications, synchronizer tokens or `SameSite=Strict` cookies must protect state-modifying POST requests.

---

## How to Run

### One-Command Runner

```bash
cd demo-app
./run.sh
```

### Direct Execution with `lmmock`

When `lmmock` and `lmhtml` are on `PATH`:

```bash
cd demo-app
mkdir -p build
lmscript app.lms build/app.dslb
lmmock exec --lmcode build/app.dslb -- lmscript webapp.lms
```

---

## Test Coverage

The test suite evaluates 26 checks:

| Area | Checks |
| --- | --- |
| **System** | `GET /health` returns HTTP 200 OK |
| **Route Protection** | Unauthenticated `GET /dashboard` redirects `HTTP 303` to `/login` |
| **DOM Contracts** | `GET /login` title, form action (`/login`), method (`POST`), input names (`username`, `password`), submit button (`submit-login`) |
| **Negative Auth** | Invalid credentials return `HTTP 401`, display `<div id="login-error">`, issue no cookie |
| **Valid Login** | Valid credentials return `HTTP 303` redirecting to `/dashboard` and issue `session` cookie |
| **Dashboard DOM** | Authenticated `GET /dashboard` displays username (`demo`), initial counter, and form actions/button IDs for `#inc`, `#reset`, `#logout` |
| **State Reset** | State-order independent: initial reset ensures counter is 0 |
| **Stateful Actions** | Clicking increment button N times updates server counter and DOM (`1`, `2`, `3`) |
| **Reset Action** | Reset button resets server counter and DOM back to `0` |
| **Action Auth Rules** | `POST /click` without cookie rejected with `HTTP 401`; `POST /reset` without cookie rejected with `HTTP 401` |
| **Logout & Invalidation** | `POST /logout` redirects to `/login`; subsequent `GET /dashboard` with old cookie redirects to `/login`; subsequent `POST /click` with old cookie rejected with `HTTP 401` |
