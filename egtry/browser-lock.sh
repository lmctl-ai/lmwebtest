#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -lt 2 ]; then
  echo 'Usage: browser-lock.sh LOCK COMMAND [ARGS...]' >&2
  exit 2
fi
browser_lock_path=$1
shift
: >> "$browser_lock_path"
held_exclusive() {
  local owner=$1 descriptor=$2
  [[ "/proc/$owner/fd/$descriptor" -ef "$browser_lock_path" ]] &&
    awk '$1=="lock:" && $3=="FLOCK" && $5=="WRITE" {held=1} END {exit !held}' "/proc/$owner/fdinfo/$descriptor" 2>/dev/null
}
parent_of() { awk '/^PPid:/ {print $2}' "/proc/$1/status" 2>/dev/null || true; }
# LMScript's process bridge closes extra descriptors. An explicit context from
# this wrapper may cross it, but is trusted only while an ancestor STILL holds
# the matching exclusive flock. A stale environment value never bypasses locking.
if [[ ${LMWEBTEST_BROWSER_LOCK_OWNER:-} =~ ^([0-9]+):([0-9]+)$ ]]; then
  owner=${BASH_REMATCH[1]} descriptor=${BASH_REMATCH[2]} ancestor=$$
  while [[ $ancestor =~ ^[0-9]+$ && $ancestor -gt 1 ]]; do
    if [[ $ancestor == "$owner" ]] && held_exclusive "$owner" "$descriptor"; then exec "$@"; fi
    ancestor=$(parent_of "$ancestor")
  done
fi
unset LMWEBTEST_BROWSER_LOCK_OWNER
# A caller such as `flock LOCK run.sh --physics` has passed this exact open
# description to us. Do not acquire another description of the same lock.
for candidate in /proc/$$/fd/[0-9]*; do
  descriptor=${candidate##*/}
  if held_exclusive "$$" "$descriptor" && flock -xn "$descriptor"; then
    export LMWEBTEST_BROWSER_LOCK_OWNER="$$:$descriptor"
    exec "$@"
  fi
done
# Fail closed rather than deadlock if raw lmscript was wrapped externally and its
# bridge dropped the descriptor without a context. Official run.sh propagates it.
ancestor=$PPID
while [[ $ancestor =~ ^[0-9]+$ && $ancestor -gt 1 ]]; do
  for candidate in /proc/$ancestor/fd/[0-9]*; do
    if held_exclusive "$ancestor" "${candidate##*/}"; then
      echo 'Browser lock held by an ancestor without context; use run.sh --physics or browser-lock.sh around lmscript.' >&2
      exit 2
    fi
  done
  ancestor=$(parent_of "$ancestor")
done
# Open after forking so an unrelated inherited descriptor cannot retain this
# newly acquired lock in the parent after the command exits.
exec {descriptor}>> "$browser_lock_path"
flock -x "$descriptor"
export LMWEBTEST_BROWSER_LOCK_OWNER="$$:$descriptor"
exec "$@"
