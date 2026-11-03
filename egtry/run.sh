#!/usr/bin/env bash
set -euo pipefail

LMHTML_COMMIT_PIN="bb8bc196f46400c7a54018be9efb310b91cb8e28"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# -----------------------------------------------------------------------------
# 0. Handle help / usage & mode flags
# -----------------------------------------------------------------------------
CHROME_MODE=0
HOME_MODE=0
PASS_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then
    echo "Usage: ./run.sh [--home | --chrome] [--book <name>] [--host <host>] [--pages <N>] [--seed <S>] [--v1-host <host>] [--url-map <path>]"
    echo ""
    echo "Options:"
    echo "  --home                     Run headless Chrome (Playwright) R37 homepage QA suite (home.lms) under flock /tmp/browser-gate.lock"
    echo "  --chrome                   Run headless Chrome (Playwright) book QA suite (chrome.lms) under flock /tmp/browser-gate.lock"
    echo "  --book <name>              Book slug to test (default: python, e.g. bash, c, cpp, csharp, dart, go, java, javascript, kotlin, lua, perl, php, ruby, scala, sql, swift, typescript, rust, python)"
    echo "  --host <host>              Production or candidate host (default: www.egtry.com, or v2.egtry.com)"
    echo "  --pages <N>                Number of lesson pages to sample in --chrome mode (default: 10: first, last, N-2 seeded random)"
    echo "  --seed <S>                 Deterministic PRNG seed for sampling (--chrome or --home mode)"
    echo "  --forbid-hero-words <csv>  Comma-separated words forbidden in .home-hero in --home mode (default: books,tex,katex)"
    echo "  --require-hero-words <csv> Comma-separated words required in .home-hero in --home mode"
    echo "  --allow-legacy-hero        Allow legacy pre-polish hero wording in --home mode"
    echo "  --min-fit-pct <P>          Minimum % of 40-example sample fitting without scroll in --home mode (default: 95)"
    echo "  --v1-host <host>           Legacy host for tracks comparison in default curl+lmhtml mode (default: v1.egtry.com)"
    echo "  --url-map <path>           Path to url-map.json in default curl+lmhtml mode"
    echo "  --help, -h                 Show this help message and exit"
    exit 0
  elif [ "$arg" = "--chrome" ]; then
    CHROME_MODE=1
  elif [ "$arg" = "--home" ]; then
    HOME_MODE=1
  else
    PASS_ARGS+=("$arg")
  fi
done

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
elif [ -f "$HOME/lmwebtest/bin/lmhtml" ] && [ -x "$HOME/lmwebtest/bin/lmhtml" ] && has_lmcode_schema "$HOME/lmwebtest/bin/lmhtml"; then
  LMHTML_BIN="$HOME/lmwebtest/bin/lmhtml"
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
        echo "Notice: published release v0.7.4 emits older DSL schema; building lmhtml from pinned commit ${LMHTML_COMMIT_PIN}..."
      fi
    fi
  fi

  if [ "$DOWNLOAD_OK" -ne 1 ]; then
    command -v cmake >/dev/null 2>&1 || { echo "Error: cmake required to build lmhtml from source" >&2; exit 1; }
    command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || { echo "Error: C++ compiler required to build lmhtml from source" >&2; exit 1; }
    command -v git >/dev/null 2>&1 || { echo "Error: git required to fetch lmhtml source pin" >&2; exit 1; }

    SOURCE_DIR="$WORK/lmhtml-src"
    mkdir -p "$SOURCE_DIR"
    git -C "$SOURCE_DIR" init -q
    git -C "$SOURCE_DIR" remote add origin https://github.com/lmctl-ai/lmhtml.git
    git -C "$SOURCE_DIR" fetch -q --depth 1 origin "$LMHTML_COMMIT_PIN"
    git -C "$SOURCE_DIR" checkout -q FETCH_HEAD
    (
      cd "$SOURCE_DIR"
      ./scripts/sync-lexbor.sh
      cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
      cmake --build build --parallel 4
    )
    cp "$SOURCE_DIR/build/lmhtml" "$LMHTML_BIN"
    chmod +x "$LMHTML_BIN"
  fi

  rm -rf "$WORK"
  trap - EXIT INT TERM
fi

export LMHTML="$LMHTML_BIN"
export PATH="$(dirname "$LMHTML_BIN"):$PATH"

echo "=== Prerequisites ready (LMHTML=$LMHTML) ==="

cd "$HERE"
if [ "$HOME_MODE" -eq 1 ]; then
  echo "=== Running egtry Homepage R37 QA suite (${PASS_ARGS[*]:-}) ==="
  exec lmscript home.lms "${PASS_ARGS[@]}"
elif [ "$CHROME_MODE" -eq 1 ]; then
  echo "=== Running egtry Chrome QA suite (${PASS_ARGS[*]:-}) ==="
  exec lmscript chrome.lms "${PASS_ARGS[@]}"
else
  echo "=== Running egtry integration test ($*) ==="
  exec flock /tmp/egtry-suite.lock lmscript egtry.lms "$@"
fi
