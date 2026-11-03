#!/usr/bin/env bash
# Builds single-file executables of lmwebtest with Bun (no Node needed at runtime).
#   scripts/build-binary.sh [OUTDIR] [TARGET...]
# TARGET is one of: linux-x64 linux-arm64 macos-x64 macos-arm64 windows-x64 (default: all)
# Output: OUTDIR/lmwebtest-<target>[.exe] plus SHA256SUMS. OUTDIR defaults to dist/.
# Playwright browsers are not embedded: install them once with `npx playwright install chromium`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
shift || true
TARGETS=("$@")
[ ${#TARGETS[@]} -gt 0 ] || TARGETS=(linux-x64 linux-arm64 macos-x64 macos-arm64 windows-x64)

command -v bun >/dev/null 2>&1 || { echo "Error: bun is not on PATH (https://bun.sh)" >&2; exit 1; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# The legacy DSL schema is read at startup; Bun embeds it only as a non-JS asset.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$ROOT/schema/lmwebtest.dsl.json" "$STAGE/lmwebtest.dsl.schema"

cd "$ROOT"
for target in "${TARGETS[@]}"; do
  ext=""
  case "$target" in
    linux-x64)    bun_target=bun-linux-x64 ;;
    linux-arm64)  bun_target=bun-linux-arm64 ;;
    macos-x64)    bun_target=bun-darwin-x64 ;;
    macos-arm64)  bun_target=bun-darwin-arm64 ;;
    windows-x64)  bun_target=bun-windows-x64; ext=".exe" ;;
    *) echo "Error: unknown target $target" >&2; exit 2 ;;
  esac
  echo "Building lmwebtest-${target}${ext} ..."
  # src/playwright/worker.cjs is the Playwright worker thread, embedded as an entrypoint.
  bun build --compile --target="$bun_target" \
    --external 'chromium-bidi/*' --external electron --external 'electron/*' \
    src/cli.js src/playwright/worker.cjs "$STAGE/lmwebtest.dsl.schema" \
    --outfile "$OUT/lmwebtest-${target}${ext}"
done

( cd "$OUT" && for f in lmwebtest-*; do
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi
  done > SHA256SUMS )
ls -la "$OUT"
