#!/bin/bash
#
# The capability catalog and the permission-profile ladder.
#
# Compiled against the REAL Sources/Orion/Capabilities.swift, so the catalog it
# checks is the one that ships. `GatewayClient` and `OrionLog` are stubbed —
# see Stubs.swift for why that changes nothing this harness asserts.
#
#   ./Tests/run-capability-test.sh
#
# WHAT THIS PROVES: that the profile ladder orders the way the orion-control
# plugin's PROFILE_TIERS orders it, that a switch which is on but below its
# required profile is reported as such, and that no boolean flag in the live
# openclaw.json has been left without a switch in Settings.
#
# WHAT IT DOES NOT PROVE: that a write lands. That goes through
# `openclaw config set`, which validates on the way in, and every write leaves a
# timestamped copy under ~/.openclaw/backups/orion-config — which is the
# evidence to look at if a toggle ever appears to do nothing.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the capability harness =="
swiftc -O \
  "$ROOT/Sources/Orion/Capabilities.swift" \
  "$HERE/CapabilityHarness/Stubs.swift" \
  "$HERE/CapabilityHarness/main.swift" \
  -o "$BUILD/capability-harness" \
  || { echo "capability harness failed to build"; exit 1; }

"$BUILD/capability-harness" "$@"
