#!/usr/bin/env bash
# Root integration runner for lmwebtest
# Runs both the offline deterministic demo-app suite and the live neochart suite.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=================================================="
echo "Running offline demo-app integration test suite"
echo "=================================================="
"$HERE/demo-app/run.sh" "$@"

echo ""
echo "=================================================="
echo "Running live-site neochart integration test suite"
echo "=================================================="
"$HERE/neochart/run.sh" "$@"

echo ""
echo "=================================================="
echo "All integration test suites completed successfully"
echo "=================================================="
