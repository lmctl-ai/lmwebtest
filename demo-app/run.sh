#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# Source shared helpers
source "$ROOT/scripts/lib.sh"

# -----------------------------------------------------------------------------
# Optional install flag (--install)
# -----------------------------------------------------------------------------
if [ "${1:-}" = "--install" ]; then
  echo "Installing @lmctl-ai/lmctl@latest into user environment..."
  npm install -g @lmctl-ai/lmctl@latest
  shift || true
fi

# -----------------------------------------------------------------------------
# 1. Check prerequisites
# -----------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not on PATH" >&2
  exit 1
fi

if ! command -v lmscript >/dev/null 2>&1; then
  echo "Error: lmscript is not on PATH." >&2
  echo "Install it with: npm install -g @lmctl-ai/lmctl@latest (or pass --install)" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is not on PATH" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. Locate or obtain host binaries (lmhtml and lmmock)
# -----------------------------------------------------------------------------
ensure_lmhtml "$ROOT" "$HERE"
export LMHTML="$LMHTML_BIN"

ensure_lmmock "$ROOT" "$HERE"
export LMMOCK="$LMMOCK_BIN"

# Always export the schema from the lmmock binary actually in use: the schema
# changes between lmmock releases and the bytecode must match it exactly.
"$LMMOCK_BIN" schema > "$HERE/schema.json"

# -----------------------------------------------------------------------------
# 3. Compile mock app bytecode
# -----------------------------------------------------------------------------
mkdir -p "$HERE/build"
echo "Compiling demo-app/app.lms against schema.json..."
lmscript "$HERE/app.lms" "$HERE/build/app.dslb"

# -----------------------------------------------------------------------------
# 4. Run integration test under lmmock exec
# -----------------------------------------------------------------------------
echo "=== Prerequisites ready (LMHTML=$LMHTML, LMMOCK=$LMMOCK) ==="
echo "=== Running mock webapp integration test under lmmock exec ==="

cd "$HERE"
"$LMMOCK_BIN" exec --lmcode "$HERE/build/app.dslb" -- lmscript "$HERE/webapp.lms" "$@"
