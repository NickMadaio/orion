#!/bin/bash
#
# Phase 33 -- the health privacy firewall.
#
# Compiled against the REAL Sources/Orion/PlanningSignal.swift, so what it
# checks is what ships.
#
#   ./Tests/run-health-firewall-test.sh
#
# WHAT THIS PROVES: that no raw measurement -- HRV, resting heart rate, recovery
# percentage, sleep score, sleep hours, strain -- survives into the text a model
# is given, asserted by pulling every number out of the prompt rather than by
# grepping for words. A rephrasing that still leaks the value fails.
#
# It also proves the firewall is not satisfied by saying nothing: a good day and
# a poor day must produce different prompts.
#
# WHAT IT DOES NOT PROVE: that the Health TAB hides anything. It does not, and
# should not -- Nick reading his own numbers is not what Phase 33 restricts.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

# MobileCore is a SwiftPM library target, so there is no libMobileCore.a to link
# against -- SwiftPM compiles it straight into whatever depends on it. Rather
# than fight that, link the object files it already produced. `swift build`
# regenerates them, so this stays honest about which MobileCore is being tested.
MOBILE_ROOT="$ROOT/../OrionMobile"
(cd "$MOBILE_ROOT" && swift build --product MobileCore >/dev/null 2>&1) \
  || { echo "MobileCore failed to build"; exit 1; }

MODULES="$(find "$MOBILE_ROOT/.build" -type d -name Modules -path '*debug*' | head -1)"
OBJECTS="$(find "$MOBILE_ROOT/.build" -type f -name '*.swift.o' -path '*MobileCore.build*')"
[[ -n "$MODULES" && -n "$OBJECTS" ]] || { echo "could not locate MobileCore build products"; exit 1; }

echo "== building the health firewall harness =="
# shellcheck disable=SC2086
swiftc -O \
  -I "$MODULES" $OBJECTS \
  "$ROOT/Sources/Orion/PlanningSignal.swift" \
  "$HERE/HealthFirewallHarness/Stubs.swift" \
  "$HERE/HealthFirewallHarness/main.swift" \
  -o "$BUILD/health-firewall" \
  || { echo "health firewall harness failed to build"; exit 1; }

"$BUILD/health-firewall" "$@"
