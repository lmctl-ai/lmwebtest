#!/usr/bin/env bash
# Offline file-upload integration test: lmmock serves the site, Playwright (via lmcode) uploads files.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/scripts/lib.sh"

for tool in node lmscript curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Error: $tool is not on PATH" >&2; exit 1; }
done

ensure_lmmock "$ROOT" "$HERE"

# The test program calls `lmwebtest playwright`. An lmwebtest already on PATH (the released executable, or
# `npm link`) wins; otherwise use this checkout through a shim appended to the END of PATH.
if ! command -v lmwebtest >/dev/null 2>&1; then
  mkdir -p "$HERE/build/shim"
  printf '#!/bin/sh\nexec node "%s/src/cli.js" "$@"\n' "$ROOT" > "$HERE/build/shim/lmwebtest"
  chmod +x "$HERE/build/shim/lmwebtest"
  export PATH="$PATH:$HERE/build/shim"
fi
echo "lmwebtest: $(command -v lmwebtest)"

# The schema changes between lmmock releases; always export it from the binary in use.
"$LMMOCK_BIN" schema > "$HERE/schema.json"
mkdir -p "$HERE/build"
echo "Compiling upload-app/app.lms..."
(cd "$HERE" && lmscript app.lms build/app.dslb)

echo "=== Running file-upload integration test under lmmock exec (LMMOCK=$LMMOCK_BIN) ==="
cd "$HERE"
"$LMMOCK_BIN" exec --lmcode "$HERE/build/app.dslb" -- lmscript "$HERE/test.lms" "$@"
