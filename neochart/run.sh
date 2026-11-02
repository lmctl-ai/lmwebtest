#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# -----------------------------------------------------------------------------
# Optional exploration path (--explore)
# -----------------------------------------------------------------------------
if [ "${1:-}" = "--explore" ]; then
  echo "=== Running ad-hoc exploration with playwright-cli ==="
  if ! command -v playwright-cli >/dev/null 2>&1; then
    echo "Installing @playwright/cli@latest into user environment..."
    npm install -g @playwright/cli@latest
  fi
  if ! playwright-cli install-browser --list 2>/dev/null | grep -q "chromium"; then
    echo "Installing Chromium browser for playwright-cli..."
    playwright-cli install-browser chromium
  fi
  exec playwright-cli open https://neochart.com --browser chromium
fi

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
  echo "Error: lmscript is not on PATH" >&2
  echo "Install it with: npm install -g @lmctl-ai/lmctl@latest (or pass --install)" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is not on PATH" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. Locate or obtain lmhtml
# -----------------------------------------------------------------------------
source "$ROOT/scripts/lib.sh"
ensure_lmhtml "$ROOT" "$HERE"
export LMHTML="$LMHTML_BIN"

echo "=== Prerequisites ready (LMHTML=$LMHTML) ==="
echo "=== Running neochart integration test ==="

cd "$HERE"
lmscript neochart.lms "$@"
