#!/usr/bin/env bash
# Shared helper functions for lmwebtest runners
# Uses latest versions dynamically by design; breakage is fixed forward.

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

detect_os_arch() {
  local uname_s uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  case "$uname_s" in
    Linux)  OS="linux" ;;
    Darwin) OS="macos" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *) echo "Error: unsupported OS $uname_s" >&2; return 1 ;;
  esac

  case "$uname_m" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Error: unsupported architecture $uname_m" >&2; return 1 ;;
  esac
  export OS ARCH
}

has_lmcode_schema() {
  local bin="$1"
  [ -x "$bin" ] && "$bin" --lmcode-schema --json >/dev/null 2>&1
}

# Ensures lmhtml is available. Sets LMHTML_BIN.
ensure_lmhtml() {
  local root="$1"
  local here="$2"

  local candidate="${LMHTML:-}"
  if [ -n "$candidate" ] && [ -x "$candidate" ] && has_lmcode_schema "$candidate"; then
    LMHTML_BIN="$candidate"
    export PATH="$(dirname "$LMHTML_BIN"):$PATH"
    return 0
  fi

  if command -v lmhtml >/dev/null 2>&1 && [ -x "$(command -v lmhtml)" ] && has_lmcode_schema "$(command -v lmhtml)"; then
    LMHTML_BIN="$(command -v lmhtml)"
    export PATH="$(dirname "$LMHTML_BIN"):$PATH"
    return 0
  fi

  if [ -f "$root/bin/lmhtml" ] && [ -x "$root/bin/lmhtml" ] && has_lmcode_schema "$root/bin/lmhtml"; then
    LMHTML_BIN="$root/bin/lmhtml"
    export PATH="$(dirname "$LMHTML_BIN"):$PATH"
    return 0
  fi

  if [ -f "$here/bin/lmhtml" ] && [ -x "$here/bin/lmhtml" ] && has_lmcode_schema "$here/bin/lmhtml"; then
    LMHTML_BIN="$here/bin/lmhtml"
    export PATH="$(dirname "$LMHTML_BIN"):$PATH"
    return 0
  fi

  local bin_dir="$root/bin"
  mkdir -p "$bin_dir"
  LMHTML_BIN="$bin_dir/lmhtml"

  detect_os_arch

  local asset="lmhtml-${OS}-${ARCH}"
  if [ "$OS" = "windows" ]; then asset="${asset}.exe"; fi

  local download_ok=0
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT INT TERM

  # Resolve latest release tag dynamically
  local tag=""
  tag="$(curl -fsSL --max-time 15 https://api.github.com/repos/lmctl-ai/lmhtml/releases/latest 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  if [ -z "$tag" ]; then
    tag="$(curl -fsSI --max-time 15 -o /dev/null -w '%{redirect_url}' https://github.com/lmctl-ai/lmhtml/releases/latest 2>/dev/null | sed -E 's|.*/tag/([^/]+).*|\1|' || true)"
  fi
  if [ -n "$tag" ]; then
    echo "Resolved latest lmhtml release tag: $tag"
    echo "Attempting to download published lmhtml release $tag (${asset})..."
    if curl -fsSL --max-time 30 "https://github.com/lmctl-ai/lmhtml/releases/download/${tag}/${asset}" -o "$work/$asset" \
       && curl -fsSL --max-time 15 "https://github.com/lmctl-ai/lmhtml/releases/download/${tag}/SHA256SUMS" -o "$work/SHA256SUMS"; then
      local expected_hash actual_hash
      expected_hash="$(grep " ${asset}\$" "$work/SHA256SUMS" | awk '{print $1}')"
      actual_hash="$(compute_sha256 "$work/$asset")"
      if [ -n "$expected_hash" ] && [ "$actual_hash" = "$expected_hash" ]; then
        chmod +x "$work/$asset"
        if has_lmcode_schema "$work/$asset"; then
          cp "$work/$asset" "$LMHTML_BIN"
          chmod +x "$LMHTML_BIN"
          download_ok=1
          echo "Downloaded and verified compatible published lmhtml release $tag."
        else
          echo "Notice: published release $tag emits DSL bytecode v5; installed lmscript requires DSL bytecode v6."
          echo "Falling back to building lmhtml from git main HEAD..."
        fi
      else
        echo "Notice: SHA256 mismatch on downloaded lmhtml binary. Falling back to build from source."
      fi
    else
      echo "Notice: lmhtml release binary download failed. Falling back to build from source."
    fi
  else
    echo "Notice: unable to query latest lmhtml release tag. Falling back to build from source."
  fi

  if [ "$download_ok" -ne 1 ]; then
    echo "Checking source build prerequisites..."
    command -v cmake >/dev/null 2>&1 || { echo "Error: cmake required to build lmhtml from source" >&2; exit 1; }
    command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || { echo "Error: C++ compiler required to build lmhtml from source" >&2; exit 1; }
    command -v git >/dev/null 2>&1 || { echo "Error: git required to fetch lmhtml source" >&2; exit 1; }

    echo "Fetching lmhtml repository from main HEAD..."
    local source_dir="$work/lmhtml-src"
    git clone --depth 1 https://github.com/lmctl-ai/lmhtml.git "$source_dir"
    local resolved_sha
    resolved_sha="$(git -C "$source_dir" rev-parse HEAD)"
    echo "Resolved lmhtml main HEAD commit: $resolved_sha"

    echo "Building lmhtml from source in $source_dir..."
    (
      cd "$source_dir"
      ./scripts/sync-lexbor.sh
      cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
      cmake --build build --parallel 4
    )
    cp "$source_dir/build/lmhtml" "$LMHTML_BIN"
    chmod +x "$LMHTML_BIN"
    echo "Built and installed lmhtml ($resolved_sha) to $LMHTML_BIN"
  fi

  export PATH="$(dirname "$LMHTML_BIN"):$PATH"
  rm -rf "$work"
  trap - EXIT INT TERM
}

# Ensures lmmock is available. Sets LMMOCK_BIN.
ensure_lmmock() {
  local root="$1"
  local here="$2"

  local candidate="${LMMOCK:-}"
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    LMMOCK_BIN="$candidate"
    export PATH="$(dirname "$LMMOCK_BIN"):$PATH"
    return 0
  fi

  if command -v lmmock >/dev/null 2>&1 && [ -x "$(command -v lmmock)" ]; then
    LMMOCK_BIN="$(command -v lmmock)"
    export PATH="$(dirname "$LMMOCK_BIN"):$PATH"
    return 0
  fi

  if [ -f "$root/bin/lmmock" ] && [ -x "$root/bin/lmmock" ]; then
    LMMOCK_BIN="$root/bin/lmmock"
    export PATH="$(dirname "$LMMOCK_BIN"):$PATH"
    return 0
  fi

  if [ -f "$here/bin/lmmock" ] && [ -x "$here/bin/lmmock" ]; then
    LMMOCK_BIN="$here/bin/lmmock"
    export PATH="$(dirname "$LMMOCK_BIN"):$PATH"
    return 0
  fi

  local bin_dir="$root/bin"
  mkdir -p "$bin_dir"
  LMMOCK_BIN="$bin_dir/lmmock"

  detect_os_arch

  local asset="lmmock-${OS}-${ARCH}"
  if [ "$OS" = "windows" ]; then asset="${asset}.exe"; fi

  local download_ok=0
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT INT TERM

  # Resolve latest release tag dynamically
  local tag=""
  tag="$(curl -fsSL --max-time 15 https://api.github.com/repos/lmctl-ai/lmmock/releases/latest 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  if [ -z "$tag" ]; then
    tag="$(curl -fsSI --max-time 15 -o /dev/null -w '%{redirect_url}' https://github.com/lmctl-ai/lmmock/releases/latest 2>/dev/null | sed -E 's|.*/tag/([^/]+).*|\1|' || true)"
  fi
  if [ -z "$tag" ]; then
    tag="v0.1.36"
  fi
  echo "Resolved latest lmmock release: $tag"

  echo "Attempting to download published lmmock release ${tag} (${asset})..."
  if curl -fsSL --max-time 30 "https://github.com/lmctl-ai/lmmock/releases/download/${tag}/${asset}" -o "$work/$asset" \
     && curl -fsSL --max-time 15 "https://github.com/lmctl-ai/lmmock/releases/download/${tag}/SHA256SUMS" -o "$work/SHA256SUMS"; then
    local expected_hash actual_hash
    expected_hash="$(grep " ${asset}\$" "$work/SHA256SUMS" | awk '{print $1}')"
    actual_hash="$(compute_sha256 "$work/$asset")"
    if [ -n "$expected_hash" ] && [ "$actual_hash" = "$expected_hash" ]; then
      chmod +x "$work/$asset"
      cp "$work/$asset" "$LMMOCK_BIN"
      chmod +x "$LMMOCK_BIN"
      download_ok=1
      echo "Downloaded and verified published lmmock release ${tag}."
    else
      echo "Notice: SHA256 verification failed on downloaded lmmock binary."
    fi
  else
    echo "Notice: lmmock release binary download failed."
  fi

  if [ "$download_ok" -ne 1 ]; then
    echo "Checking Go compiler for fallback build of lmmock..."
    if command -v go >/dev/null 2>&1; then
      echo "Building lmmock from repository source at tag ${tag}..."
      local source_dir="$work/lmmock-src"
      git clone --depth 1 --branch "$tag" https://github.com/lmctl-ai/lmmock.git "$source_dir" 2>/dev/null || \
        git clone --depth 1 https://github.com/lmctl-ai/lmmock.git "$source_dir"
      (
        cd "$source_dir"
        CGO_ENABLED=0 go build -o "$LMMOCK_BIN" ./cmd/lmmock
      )
      chmod +x "$LMMOCK_BIN"
      echo "Built and installed lmmock to $LMMOCK_BIN"
    else
      echo "Error: failed to download lmmock and Go is not available to build from source" >&2
      rm -rf "$work"
      exit 1
    fi
  fi

  export PATH="$(dirname "$LMMOCK_BIN"):$PATH"
  rm -rf "$work"
  trap - EXIT INT TERM
}
