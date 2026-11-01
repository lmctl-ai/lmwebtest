#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
VERSION="0.1.0"

echo "Packaging lmwebtest v${VERSION} release assets..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PAYLOAD_TAR="$TMP_DIR/payload.tar.gz"

# Create clean archive containing code, schemas, and dependencies
tar -czf "$PAYLOAD_TAR" \
  --exclude="dist" \
  --exclude=".git" \
  --exclude="test-results" \
  --exclude="playwright-report" \
  --exclude=".cli-fixture-*" \
  -C "$REPO_ROOT" \
  package.json package-lock.json src schema sites node_modules

PAYLOAD_SIZE=$(wc -c < "$PAYLOAD_TAR")
echo "Payload tar.gz size: $PAYLOAD_SIZE bytes"

# Template for POSIX self-extracting runner
make_posix_runner() {
  local outfile="$1"
  cat << 'RUNNER_EOF' > "$outfile"
#!/bin/sh
set -e

VERSION="0.1.0"

if [ "$1" = "--version" ] || [ "$1" = "-v" ]; then
  echo "lmwebtest ${VERSION}"
  exit 0
fi

if [ -n "$NODE_BIN" ]; then
  NODE="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  echo "lmwebtest: error: Node.js (node) is required on PATH to run lmwebtest" >&2
  exit 1
fi

CACHE_BASE="${XDG_CACHE_HOME:-$HOME/.cache}/lmwebtest"
CACHE_DIR="${CACHE_BASE}/runtime-v${VERSION}"
MARKER="${CACHE_DIR}/.installed"

if [ ! -f "$MARKER" ]; then
  mkdir -p "$CACHE_DIR"
  ARCHIVE_LINE=$(awk '/^__ARCHIVE_BELOW__/ {print NR + 1; exit 0; }' "$0")
  tail -n +"$ARCHIVE_LINE" "$0" | tar -xz -C "$CACHE_DIR"
  touch "$MARKER"
fi

exec "$NODE" "$CACHE_DIR/src/cli.js" "$@"
__ARCHIVE_BELOW__
RUNNER_EOF

  cat "$PAYLOAD_TAR" >> "$outfile"
  chmod +x "$outfile"
}

# Generate POSIX binaries for all platforms
for target in linux-x64 linux-arm64 macos-x64 macos-arm64; do
  make_posix_runner "$DIST_DIR/lmwebtest-$target"
  echo "Created $DIST_DIR/lmwebtest-$target"
done

# Generate Windows executable
WIN_EXE="$DIST_DIR/lmwebtest-windows-x64.exe"
WIN_C="$TMP_DIR/win_wrapper.c"
cat << 'WIN_EOF' > "$WIN_C"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <process.h>

#define VERSION "0.1.0"

int main(int argc, char* argv[]) {
    if (argc >= 2 && (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0)) {
        printf("lmwebtest %s\n", VERSION);
        return 0;
    }

    const char* user_appdata = getenv("LOCALAPPDATA");
    if (!user_appdata) user_appdata = getenv("APPDATA");
    if (!user_appdata) user_appdata = "C:\\Temp";

    char script[4096];
    snprintf(script, sizeof(script), "%s\\lmwebtest\\runtime-v%s\\src\\cli.js", user_appdata, VERSION);

    char** node_args = (char**)malloc((argc + 2) * sizeof(char*));
    if (!node_args) {
        fprintf(stderr, "lmwebtest: out of memory\n");
        return 1;
    }

    node_args[0] = "node";
    node_args[1] = script;
    for (int i = 1; i < argc; i++) {
        node_args[i + 1] = argv[i];
    }
    node_args[argc + 1] = NULL;

    int ret = (int)_spawnvp(_P_WAIT, "node", (const char* const*)node_args);
    free(node_args);
    return ret;
}
WIN_EOF

x86_64-w64-mingw32-gcc -O2 "$WIN_C" -o "$WIN_EXE"
echo "Created $WIN_EXE"

# Generate SHA256SUMS
cd "$DIST_DIR"
sha256sum lmwebtest-* > SHA256SUMS
echo "Generated SHA256SUMS:"
cat SHA256SUMS
