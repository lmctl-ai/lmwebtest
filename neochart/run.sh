#!/usr/bin/env bash
set -euo pipefail

LMHTML_COMMIT_PIN="bb8bc196f46400c7a54018be9efb310b91cb8e28"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# -----------------------------------------------------------------------------
# Optional exploration path (--explore)
# -----------------------------------------------------------------------------
if [ "${1:-}" = "--explore" ]; then
  echo "=== Running ad-hoc exploration with playwright-cli ==="
  if ! command -v playwright-cli >/dev/null 2>&1; then
    echo "Installing @playwright/cli@0.1.23 into user environment..."
    npm install -g @playwright/cli@0.1.23
  fi
  if ! playwright-cli install-browser --list 2>/dev/null | grep -q "chromium"; then
    echo "Installing Chromium browser for playwright-cli..."
    playwright-cli install-browser chromium
  fi
  exec playwright-cli open https://neochart.com --browser chromium
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
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is not on PATH" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. Locate or obtain lmhtml
# -----------------------------------------------------------------------------
# Probes whether a candidate binary supports --lmcode-schema only (DSL v6 cutover)
has_lmcode_schema() {
  local bin="$1"
  [ -x "$bin" ] && "$bin" --lmcode-schema --json >/dev/null 2>&1
}

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

LMHTML_CANDIDATE="${LMHTML:-}"

if [ -n "$LMHTML_CANDIDATE" ] && [ -x "$LMHTML_CANDIDATE" ] && has_lmcode_schema "$LMHTML_CANDIDATE"; then
  LMHTML_BIN="$LMHTML_CANDIDATE"
elif command -v lmhtml >/dev/null 2>&1 && [ -x "$(command -v lmhtml)" ] && has_lmcode_schema "$(command -v lmhtml)"; then
  LMHTML_BIN="$(command -v lmhtml)"
elif [ -f "$ROOT/bin/lmhtml" ] && [ -x "$ROOT/bin/lmhtml" ] && has_lmcode_schema "$ROOT/bin/lmhtml"; then
  LMHTML_BIN="$ROOT/bin/lmhtml"
elif [ -f "$HERE/bin/lmhtml" ] && [ -x "$HERE/bin/lmhtml" ] && has_lmcode_schema "$HERE/bin/lmhtml"; then
  LMHTML_BIN="$HERE/bin/lmhtml"
else
  BIN_DIR="$ROOT/bin"
  mkdir -p "$BIN_DIR"
  LMHTML_BIN="$BIN_DIR/lmhtml"

  UNAME_S="$(uname -s)"
  UNAME_M="$(uname -m)"

  case "$UNAME_S" in
    Linux)  OS="linux" ;;
    Darwin) OS="macos" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *) echo "Error: unsupported OS $UNAME_S" >&2; exit 1 ;;
  esac

  case "$UNAME_M" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Error: unsupported architecture $UNAME_M" >&2; exit 1 ;;
  esac

  ASSET="lmhtml-${OS}-${ARCH}"
  if [ "$OS" = "windows" ]; then ASSET="${ASSET}.exe"; fi

  DOWNLOAD_OK=0
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT INT TERM

  echo "Attempting to download published lmhtml release (${ASSET})..."
  if curl -fsSL --max-time 30 "https://github.com/lmctl-ai/lmhtml/releases/download/v0.7.4/${ASSET}" -o "$WORK/$ASSET" \
     && curl -fsSL --max-time 15 "https://github.com/lmctl-ai/lmhtml/releases/download/v0.7.4/SHA256SUMS" -o "$WORK/SHA256SUMS"; then
    EXPECTED_HASH="$(grep " ${ASSET}\$" "$WORK/SHA256SUMS" | awk '{print $1}')"
    ACTUAL_HASH="$(compute_sha256 "$WORK/$ASSET")"
    if [ "$ACTUAL_HASH" = "$EXPECTED_HASH" ]; then
      chmod +x "$WORK/$ASSET"
      if has_lmcode_schema "$WORK/$ASSET"; then
        cp "$WORK/$ASSET" "$LMHTML_BIN"
        chmod +x "$LMHTML_BIN"
        DOWNLOAD_OK=1
        echo "Downloaded and verified published lmhtml release."
      else
        echo "Notice: published release v0.7.4 emits DSL bytecode v5; installed lmscript 0.2.446 emits DSL bytecode v6."
        echo "Falling back to building lmhtml from pinned commit ${LMHTML_COMMIT_PIN}..."
      fi
    else
      echo "Notice: SHA256 mismatch on downloaded binary. Falling back to build from source."
    fi
  else
    echo "Notice: release binary download failed. Falling back to build from source."
  fi

  if [ "$DOWNLOAD_OK" -ne 1 ]; then
    echo "Checking source build prerequisites..."
    command -v cmake >/dev/null 2>&1 || { echo "Error: cmake required to build lmhtml from source" >&2; exit 1; }
    command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || { echo "Error: C++ compiler required to build lmhtml from source" >&2; exit 1; }
    command -v git >/dev/null 2>&1 || { echo "Error: git required to fetch lmhtml source pin" >&2; exit 1; }

    echo "Fetching lmhtml repository at pinned commit ${LMHTML_COMMIT_PIN}..."
    SOURCE_DIR="$WORK/lmhtml-src"
    mkdir -p "$SOURCE_DIR"
    git -C "$SOURCE_DIR" init -q
    git -C "$SOURCE_DIR" remote add origin https://github.com/lmctl-ai/lmhtml.git
    git -C "$SOURCE_DIR" fetch -q --depth 1 origin "$LMHTML_COMMIT_PIN"
    git -C "$SOURCE_DIR" checkout -q FETCH_HEAD
    HAVE_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
    if [ "$HAVE_COMMIT" != "$LMHTML_COMMIT_PIN" ]; then
      echo "Error: commit pin mismatch (expected ${LMHTML_COMMIT_PIN}, got ${HAVE_COMMIT})" >&2
      rm -rf "$WORK"
      exit 1
    fi

    echo "Building lmhtml from source in $SOURCE_DIR..."
    (
      cd "$SOURCE_DIR"
      ./scripts/sync-lexbor.sh
      cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
      cmake --build build --parallel 4
    )
    cp "$SOURCE_DIR/build/lmhtml" "$LMHTML_BIN"
    chmod +x "$LMHTML_BIN"
    echo "Built and installed lmhtml to $LMHTML_BIN"
  fi

  rm -rf "$WORK"
  trap - EXIT INT TERM
fi

export LMHTML="$LMHTML_BIN"

echo "=== Prerequisites ready (LMHTML=$LMHTML) ==="
echo "=== Running neochart integration test ==="

cd "$HERE"
lmscript neochart.lms "$@"
