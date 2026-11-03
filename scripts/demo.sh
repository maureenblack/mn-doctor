#!/usr/bin/env bash
# Show mn-doctor against the fixtures. The compiler versions are passed in
# because the Compact devtools are not required to run the demo.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
cli=(node "$root/dist/cli.js")

run() {
  local title="$1"
  shift
  echo
  echo "===== $title ====="
  "${cli[@]}" "$@" --no-color || true
}

run "good public-network project" \
  check --cwd "$root/test/fixtures/good-public" \
  --compact-version 0.31.1 --devtools-version 0.5.1

run "bare compact update (compiler 0.35.0, runtime 0.16.0)" \
  check --cwd "$root/test/fixtures/broken-compiler-ledger9" \
  --compact-version 0.35.0 --devtools-version 0.5.1

run "ledger 9 runtime on Midnight.js 4.1.1" \
  check --cwd "$root/test/fixtures/broken-runtime-ledger9" \
  --compact-version 0.31.1 --devtools-version 0.5.1

run "April 2026 SDK set (consistent, older than the docs matrix)" \
  check --cwd "$root/test/fixtures/sdk-april-2026" \
  --compact-version 0.30.0 --devtools-version 0.5.1
