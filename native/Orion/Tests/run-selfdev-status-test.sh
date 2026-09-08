#!/bin/bash
#
# SelfDevelopmentStatus — the three states the Project tab renders.
#
# Compiled against the REAL Sources/Orion/SelfDevelopmentStatus.swift, same
# discipline as run-watchdog-test.sh. Pure Foundation: no GUI session, no
# subprocess, no timer. `isAlive` is injected so "is that pid running" is a
# decision the test makes rather than a fact about this machine.
#
#   ./Tests/run-selfdev-status-test.sh
#
# WHAT THIS PROVES: a dead pid with no finish time reports STOPPED WITHOUT
# FINISHING rather than FINISHED, which is the state that would otherwise lie;
# a finish time wins over a live pid; and a missing or corrupt file reads as
# never-run instead of throwing into the tab.
#
# WHAT THIS DOES NOT PROVE: that the tab renders any of it. That needs a window.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the SelfDevelopmentStatus harness =="
swiftc -O \
  "$ROOT/Sources/Orion/SelfDevelopmentStatus.swift" \
  "$HERE/SelfDevStatusHarness/main.swift" \
  -o "$BUILD/selfdev-status-harness" \
  || { echo "selfdev-status harness failed to build"; exit 1; }

"$BUILD/selfdev-status-harness" "$@"
