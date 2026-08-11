#!/bin/zsh
#
# Does health-log.json still lose writes when both owners write at once?
#
# health-log.json has two independent read-modify-write implementations — the
# app's HealthLog.swift and the plugin's health.ts — and they run in different
# processes. Ticking a supplement in the dashboard and telling Orion you took it
# are the same act on the same file from two directions, so they overlap for
# real, not just in theory.
#
# The atomic rename both sides use does NOT make that safe. It stops a reader
# seeing half a file; it does nothing about a lost update, where both sides read
# the same state, each edits its corner, and the second rename erases the first
# one's change. Nothing throws. The only evidence is a supplement quietly
# un-ticking itself later.
#
# So this drives both implementations flat out at the same file, in a
# synchronized window, and counts. Every write appends a uniquely named
# supplement, so "how many did we lose" is exactly "how many of the names we
# issued are missing at the end".
#
# Measured on this machine, 4-second window, three runs each:
#
#   before FileLock.swift / withHealthLock:   1187–1241 of ~4950 updates LOST
#                                             (plus 300+ hard write errors from
#                                             both sides sharing one .tmp name)
#   after:                                    0 lost, 0 errors, ~7400 writes
#
# It hammers the REAL file, on purpose: a harness pointed at its own temp path
# cannot see the failure where the two sides lock DIFFERENT lockfiles and
# exclude nothing. The real log is backed up first and restored afterwards, and
# the restore is verified byte-for-byte before this exits.
#
#   ./run.sh          4-second window, 3 runs
#   ./run.sh 10 1     10-second window, 1 run

set -e
cd "$(dirname "$0")"

SECS=${1:-4}
RUNS=${2:-3}
LOG=~/.openclaw/orion-controlled/health-log.json
PLUGIN=~/Desktop/ORION/openclaw-plugins/orion-control/dist/health.js
SOURCES=~/Desktop/ORION/native/Orion/Sources/Orion
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Orion polls and writes this file every few seconds. Leaving it running would
# add a third writer and make the counts meaningless.
if pgrep -f "/Applications/Orion.app" > /dev/null; then
  echo "Orion.app is running — quit it first (osascript -e 'quit app \"Orion\"')."
  exit 1
fi
[[ -f $PLUGIN ]] || { echo "build the plugin first: (cd ../../openclaw-plugins/orion-control && node_modules/.bin/tsc -p tsconfig.json)"; exit 1; }

echo "building the swift side against the real HealthLog.swift..."
swiftc -O "$SOURCES/HealthLog.swift" "$SOURCES/OrionDay.swift" "$SOURCES/FileLock.swift" \
  main.swift -o "$WORK/swiftrace"

cp "$LOG" "$WORK/backup.json"
echo "backed up $LOG"

# Both sides must agree on the file AND the lockfile, or each takes a lock
# nobody else respects and the whole exercise proves nothing.
SWIFT_PATH=$("$WORK/swiftrace" --print-path)
TS_PATH=$(node -e 'import(process.argv[1]).then(m=>console.log(m.defaultHealthLogPath()))' "$PLUGIN")
[[ "$SWIFT_PATH" == "$TS_PATH" ]] || { echo "PATH MISMATCH: swift=$SWIFT_PATH ts=$TS_PATH"; exit 1; }
echo "both sides target $SWIFT_PATH (+ .lock)"
echo

for RUN in $(seq 1 $RUNS); do
  cp "$WORK/backup.json" "$LOG"
  rm -f $LOG.lock $LOG.tmp*(N)
  START=$(( $(python3 -c 'import time;print(int(time.time()*1000))') + 1500 ))
  echo "=== run $RUN — ${SECS}s synchronized concurrent window ==="
  "$WORK/swiftrace" swift $SECS $START "$WORK/swift.count" & SW=$!
  node tsrace.mjs ts $SECS $START "$WORK/ts.count" & TS=$!
  wait $SW; wait $TS
  python3 count.py "$WORK/swift.count" "$WORK/ts.count"
  echo
done

cp "$WORK/backup.json" "$LOG"
rm -f $LOG.lock $LOG.tmp*(N)
if diff -q "$LOG" "$WORK/backup.json" > /dev/null; then
  echo "real health-log.json restored, identical to the original."
else
  echo "!! RESTORE FAILED — a copy is at $WORK/backup.json"
  exit 1
fi
