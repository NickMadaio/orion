#!/bin/bash
#
# RunTimeouts — one contract for how long a turn may take, checked as an
# ordering rather than trusted as three separate literals.
#
# Compiled against the REAL Sources/Orion/RunTimeouts.swift, same discipline as
# run-watchdog-test.sh and run-progress-test.sh. Pure Foundation: no
# subprocess, no network, no GUI session.
#
#   ./Tests/run-runtimeouts-test.sh
#
# WHAT THIS PROVES: agentTimeout < terminateAt < killAt < clientReadDeadline <
# watchdogCeiling, with real margin between each pair, and that the audit poll
# interval exceeds the measured cost of one invocation. Move one number without
# its neighbours and this fails by name instead of silently retying two
# backstops the way the old 210/210 tie did.
#
# WHAT THIS DOES NOT PROVE: that GatewayClient.swift and VoiceTuning.swift
# actually READ these constants instead of a hardcoded copy. That is a `grep`,
# not a test — see the batch report for the mutation proof that they do.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the RunTimeouts harness =="
swiftc -O \
  "$ROOT/Sources/Orion/RunTimeouts.swift" \
  "$HERE/RunTimeoutsHarness/main.swift" \
  -o "$BUILD/runtimeouts-harness" \
  || { echo "runtimeouts harness failed to build"; exit 1; }

"$BUILD/runtimeouts-harness" "$@"
