#!/bin/bash
#
# The phase watchdogs — the floor under `.speaking` and `.thinking`.
#
# Covers the decision `StallWatchdog` makes, against a clock the harness owns,
# compiled against the REAL Sources/Orion/StallWatchdog.swift so it cannot drift
# from what ships. Pure Foundation: no audio device, no network, no subprocess,
# no GUI session, so unlike the other swiftc harnesses in this directory this
# one is safe to run anywhere, including over ssh.
#
#   ./Tests/run-watchdog-test.sh
#
# WHAT THIS PROVES: that a wedged phase reaches a verdict, at the right second.
#
# WHAT IT DOES NOT PROVE: that AppState wires that verdict to the right
# recovery. That is a switch in `checkPhaseWatchdog`, and the evidence for it is
# in the running app's log — grep orion-app.log for either of:
#
#   [speech] watchdog recovered a stuck speaking phase — …
#   [think]  watchdog recovered a stuck thinking phase — …
#
# The second line is the one that did not exist on 2026-08-12, when `.thinking`
# wedged on a blocked `readDataToEndOfFile()` inside a serial queue and left
# Orion deaf for twelve minutes with a live level meter. `orion-doctor` greps
# for both.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the watchdog harness =="
swiftc -O \
  "$ROOT/Sources/Orion/StallWatchdog.swift" \
  "$HERE/WatchdogHarness/main.swift" \
  -o "$BUILD/watchdog-harness" \
  || { echo "watchdog harness failed to build"; exit 1; }

"$BUILD/watchdog-harness" "$@"
