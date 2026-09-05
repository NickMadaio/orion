#!/bin/bash
#
# The progress feed — what Nick sees instead of a blank "Thinking…".
#
# Covers `RunProgressModel` against a clock the harness owns, compiled against
# the REAL Sources/Orion/RunProgressModel.swift and Sources/Orion/RunTimeouts.swift
# so it cannot drift from what ships. Pure Foundation: no audit subprocess, no
# network, no GUI session — safe to run anywhere, including over ssh, same as
# run-watchdog-test.sh.
#
#   ./Tests/run-progress-test.sh
#
# WHAT THIS PROVES: the feed text, the fold, the silence line and the wedge
# verdict are all right, at the right second, off pure inputs.
#
# WHAT IT DOES NOT PROVE: that AppState actually calls `GatewayClient.auditSince`
# on the right cadence and feeds the result here. That is IO and is verified in
# the running app.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the progress harness =="
swiftc -O \
  "$ROOT/Sources/Orion/RunTimeouts.swift" \
  "$ROOT/Sources/Orion/RunProgressModel.swift" \
  "$HERE/ProgressHarness/main.swift" \
  -o "$BUILD/progress-harness" \
  || { echo "progress harness failed to build"; exit 1; }

"$BUILD/progress-harness" "$@"
