#!/bin/bash
#
# Exact-gate parity: run the REAL Swift prefix functions over fixture inputs and write the goldens
# the Node port (scripts/eval/gate/prefix.mjs) is asserted against.
#
#   ./Tests/run-gate-parity-test.sh [inputs.json] [goldens.json]
#   ./Tests/run-gate-parity-test.sh --live   also runs the real ~/.openclaw/workspace/SCHEDULING.md through
#                                            SchedulingMemory.context (written to Tests/.build, never committed)
#
# Compiled straight against Sources/Orion/{OutreachContext,SchedulingMemory,LocalRoutingMode}.swift and
# MobileCore's ThinkingPolicy/ChatThinking (all Foundation-only), so no SwiftPM build is needed.
# NOT COVERED: AppState.agentRequest is private to a UI class and cannot be compiled here; the Node test
# pins its template text against AppState.swift's source instead.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"; mkdir -p "$BUILD"
FIX="$ROOT/../../scripts/eval/gate/fixtures"
LIVE=0; ARGS=()
for a in "$@"; do if [ "$a" = "--live" ]; then LIVE=1; else ARGS+=("$a"); fi; done
IN="${ARGS[0]:-$FIX/parity-inputs.json}"
OUT="${ARGS[1]:-$FIX/parity-goldens.json}"
MOBILE="$ROOT/../OrionMobile/Sources/MobileCore"
swiftc -O -o "$BUILD/gate-parity" \
  "$MOBILE/ThinkingPolicy.swift" "$MOBILE/ChatThinking.swift" \
  "$ROOT/Sources/Orion/OutreachContext.swift" "$ROOT/Sources/Orion/SchedulingMemory.swift" \
  "$ROOT/Sources/Orion/LocalRoutingMode.swift" "$HERE/GateParityHarness/main.swift" \
  || { echo "gate parity harness failed to build"; exit 1; }
if [ "$LIVE" = 1 ]; then
  node -e 'const f=require("fs");const i=JSON.parse(f.readFileSync(process.argv[1]));i.liveScheduling=JSON.parse(f.readFileSync(process.argv[2]));f.writeFileSync(process.argv[3],JSON.stringify(i))' "$IN" "$FIX/live-texts.json" "$BUILD/live-in.json" || exit 1
  "$BUILD/gate-parity" "$BUILD/live-in.json" "$BUILD/live-goldens.json"
else
  "$BUILD/gate-parity" "$IN" "$OUT"
fi
