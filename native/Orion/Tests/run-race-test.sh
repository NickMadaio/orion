#!/bin/bash
#
# Health-log race test: does a concurrent UI edit and voice edit lose updates?
#
# ~/.openclaw/orion-controlled/health-log.json has two writers that do not share
# a process — Orion.app (HealthLog.mutate, plus a 3s polling watcher) and the
# orion-control plugin (health.ts, driven from executors.ts). Both do
# read-modify-write. The atomic rename both sides already used prevents a torn
# READ; it does nothing about a LOST UPDATE, where both read the same state,
# each edits its own corner, and the second rename erases the first one's change.
# Nick ticks a supplement, says "took my magnesium" a second later, and the tick
# is gone with nothing logged anywhere.
#
# So this runs both real writers at once against one scratch file, each adding
# uniquely-named supplements, and counts how many survive. Names are distinct, so
# survivors == updates that were not clobbered, exactly.
#
# It runs TWICE: once replaying the pre-fix code (no lock) to show the failure is
# real, then once through the shipping path. The second run must lose zero.
#
#   ./Tests/run-race-test.sh [seconds-per-round]
#
# Bounded by time rather than by a fixed iteration count, so both sides are
# contending for the whole window. With fixed counts node finished its share four
# times faster than Swift and spent the rest of the run racing nobody, which made
# the unlocked baseline lose 4% instead of the ~25% it really loses.
#
# Exits non-zero if the locked run loses anything, so it can gate a deploy.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PLUGIN="$ROOT/../../openclaw-plugins/orion-control"
BUILD="$HERE/.build"
SECONDS_PER_ROUND="${1:-4}"

SCRATCH="$(mktemp -d)/health-log.json"
trap 'rm -rf "$(dirname "$SCRATCH")"' EXIT

echo "== building the two racers =="

mkdir -p "$BUILD"
source "$HERE/build-modules.sh"

swiftc $MODULE_FLAGS -O \
  "$ROOT/Sources/Orion/OrionDay.swift" \
  "$ROOT/Sources/Orion/HealthLog.swift" \
  "$HERE/RaceHarness/main.swift" \
  -o "$BUILD/race-swift" || { echo "swift racer failed to build"; exit 1; }

( cd "$PLUGIN" && node_modules/.bin/tsc -p tsconfig.json ) \
  || { echo "plugin failed to build"; exit 1; }

echo "   swift racer: $BUILD/race-swift"
echo "   plugin dist: $PLUGIN/dist/health.js"

# Count supplements whose name carries a given prefix. Anything the harness
# wrote and the file kept.
survivors() {
  node -e '
    const fs = require("fs");
    let log;
    try { log = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { console.log("0 0 unreadable"); process.exit(0); }
    const names = new Set((log.supplements ?? []).map((s) => s.name));
    const of = (p) => [...names].filter((n) => n.startsWith(p + "-")).length;
    console.log(`${of("swift")} ${of("node")} ${names.size}`);
  ' "$SCRATCH"
}

field() { node -e '
  const fs = require("fs");
  console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]] ?? 0);
' "$1" "$2"; }

run_round() {
  local mode="$1"
  echo
  echo "== $mode: both sides writing flat out for ${SECONDS_PER_ROUND}s =="

  # Start from the real app's v3 shape, with fields the plugin does not own.
  # The old plugin treated this as an empty log and erased every sentinel on
  # its first write even when locking was otherwise perfect.
  printf '{"schema":"orion.health.v3","updatedAt":"","supplements":[{"id":"keep-me","name":"Existing","dose":"","timeOfDay":"anytime"}],"supplementLog":{},"workouts":[],"days":{"2026-08-13":{"waterBottles":3,"calories":2100,"supplementIDs":["keep-me"],"updatedAt":"sentinel"}},"nutritionLog":{"2026-08-13":[{"id":"meal-1","title":"Dinner","meal":"Dinner","calories":700,"protein":30,"carbohydrates":80,"fat":20,"fiber":8,"notes":"sentinel","loggedAt":"2026-08-13T23:00:00Z"}]},"futureField":{"keep":true}}\n' > "$SCRATCH"
  rm -f "$SCRATCH.lock"

  ORION_HEALTH_LOG="$SCRATCH" "$BUILD/race-swift" \
    --seconds "$SECONDS_PER_ROUND" --prefix swift --mode "$mode" > "$BUILD/swift-$mode.json" &
  local swift_pid=$!

  ORION_HEALTH_LOG="$SCRATCH" node "$HERE/race-node.mjs" \
    --seconds "$SECONDS_PER_ROUND" --prefix node --mode "$mode" --dist "$PLUGIN/dist" \
    > "$BUILD/node-$mode.json" &
  local node_pid=$!

  wait $swift_pid; wait $node_pid

  echo "   swift: $(cat "$BUILD/swift-$mode.json")"
  echo "   node : $(cat "$BUILD/node-$mode.json")"

  read -r kept_swift kept_node total <<< "$(survivors)"

  # A write the code REFUSED (lock timeout) never claimed to have landed, so it
  # is not a lost update — but it is not free either, so it is reported on its
  # own line rather than folded into the total.
  local tried_swift refused_swift tried_node refused_node
  tried_swift=$(field "$BUILD/swift-$mode.json" attempted)
  refused_swift=$(field "$BUILD/swift-$mode.json" failures)
  tried_node=$(field "$BUILD/node-$mode.json" attempted)
  refused_node=$(field "$BUILD/node-$mode.json" failures)

  local expected=$(( tried_swift - refused_swift + tried_node - refused_node ))
  local kept=$(( kept_swift + kept_node ))
  local lost=$(( expected - kept ))
  local percent=0
  [ "$expected" -gt 0 ] && percent=$(( lost * 100 / expected ))

  echo "   ------------------------------------------------"
  printf '   expected %d   kept %d   LOST %d  (%d%%)\n' "$expected" "$kept" "$lost" "$percent"
  printf '   swift kept %d/%d    node kept %d/%d    file has %d\n' \
    "$kept_swift" "$(( tried_swift - refused_swift ))" \
    "$kept_node" "$(( tried_node - refused_node ))" "$total"
  printf '   refused outright (never claimed to land): swift %d, node %d\n' \
    "$refused_swift" "$refused_node"

  # Handed back in a variable rather than on stdout, so the round can narrate
  # while it runs instead of being swallowed by a command substitution.
  LOST=$lost
}

run_round unlocked
unlocked_lost=$LOST
run_round locked
locked_lost=$LOST

if ! node -e '
  const fs = require("fs");
  const log = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const ok = log.schema === "orion.health.v3"
    && log.days?.["2026-08-13"]?.waterBottles === 3
    && log.nutritionLog?.["2026-08-13"]?.[0]?.title === "Dinner"
    && log.futureField?.keep === true
    && log.supplements?.some((s) => s.id === "keep-me");
  process.exit(ok ? 0 : 1);
' "$SCRATCH"; then
  echo "FAIL: the shipping writer discarded fields from the native v3 log."
  exit 1
fi
echo "PASS: native v3 history and unknown future fields survived the race."

echo
echo "================================================================"
echo " pre-fix (no lock) lost : $unlocked_lost"
echo " shipping (locked) lost : $locked_lost"
echo "================================================================"

if [ "$locked_lost" -ne 0 ]; then
  echo "FAIL: the locked path lost $locked_lost updates. Do not deploy."
  exit 1
fi
locked_refused_swift=$(field "$BUILD/swift-locked.json" failures)
locked_refused_node=$(field "$BUILD/node-locked.json" failures)
if [ "$locked_refused_swift" -ne 0 ] || [ "$locked_refused_node" -ne 0 ]; then
  echo "FAIL: the shipping path refused writes (swift $locked_refused_swift, node $locked_refused_node)."
  exit 1
fi
if [ "$unlocked_lost" -eq 0 ]; then
  echo "INCONCLUSIVE: the unlocked baseline lost nothing, so this run proved"
  echo "nothing about the lock. Raise the iteration count and try again."
  exit 1
fi
echo "PASS: the lock recovered all $unlocked_lost updates the old code dropped."
