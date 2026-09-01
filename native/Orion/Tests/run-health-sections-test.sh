#!/bin/bash
#
# Phase 34 -- the seven health sections.
#
#   ./Tests/run-health-sections-test.sh
#
# WHAT THIS PROVES, against the REAL Sources/Orion/HealthSectionsModel.swift:
# that all seven sections are produced whatever the data says; that low
# confidence reports observations and never interprets or advises; that a
# missing reading is said out loud rather than shown as a zero or hidden; that
# no clinical term and no over-budget wall of figures survives into any section;
# and that the trend series is truncated by the producer rather than by whoever
# draws it.
#
# It also asserts a POSITIVE -- real numbers must reach Nick on a full day. A
# figure budget that passed by saying nothing would be a Health tab with no
# health in it, and Phase 33 is explicit that his own numbers on his own machine
# are not what the firewall restricts.
#
# WHAT IT DOES NOT PROVE: anything about SwiftUI layout. The rules are properties
# of the CONTENT, which is why they live in a model and are checked here.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

MOBILE_ROOT="$ROOT/../OrionMobile"
(cd "$MOBILE_ROOT" && swift build --product MobileCore >/dev/null 2>&1) \
  || { echo "MobileCore failed to build"; exit 1; }

MODULES="$(find "$MOBILE_ROOT/.build" -type d -name Modules -path '*debug*' | head -1)"
OBJECTS="$(find "$MOBILE_ROOT/.build" -type f -name '*.swift.o' -path '*MobileCore.build*')"
[[ -n "$MODULES" && -n "$OBJECTS" ]] || { echo "could not locate MobileCore build products"; exit 1; }

echo "== building the health sections harness =="
# shellcheck disable=SC2086
swiftc -O \
  -I "$MODULES" $OBJECTS \
  "$ROOT/Sources/Orion/PlanningSignal.swift" \
  "$ROOT/Sources/Orion/HealthSectionsModel.swift" \
  "$HERE/HealthFirewallHarness/Stubs.swift" \
  "$HERE/HealthSectionsHarness/main.swift" \
  -o "$BUILD/health-sections" \
  || { echo "health sections harness failed to build"; exit 1; }

"$BUILD/health-sections" "$@"
