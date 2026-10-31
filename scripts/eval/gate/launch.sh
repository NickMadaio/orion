#!/bin/bash
#
# Run the gate runner under launchd and follow it to the end.
#
#   launch.sh <scenarios.json> [run.mjs options]     start a run (e.g. --readonly, --only a1,a2)
#   launch.sh --stop <label>                          SIGTERM: the runner finishes and undoes the current item
#   launch.sh --recover <out dir>                     restore from an interrupted run's in-flight snapshot
#   launch.sh --clean-sandbox                         remove leftover sandbox files (a crash, or a run that was killed)
#   GATE_NO_WAIT=1 launch.sh ...                      start and return
#
# The runner is COPIED to ~/.openclaw/orion-controlled/evals/gate/code-<stamp> first: launchd cannot read
# ~/Desktop. It still drives the INSTALLED scripts (orion-session, orion-reschedule) from ~/Desktop/ORION/scripts
# by absolute path, as the 2026-10-15 sweep did.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME"
GATE_ROOT="$HOME_DIR/.openclaw/orion-controlled/evals/gate"
NODE="$HOME_DIR/.openclaw/tools/node-v24.15.0/bin/node"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--stop" ]; then
  [ -n "${2:-}" ] || { echo "usage: launch.sh --stop <label>"; exit 2; }
  launchctl kill SIGTERM "$DOMAIN/$2" && echo "SIGTERM sent to $2; the runner is finishing and undoing its current item"
  exit $?
fi
if [ "${1:-}" = "--recover" ]; then
  [ -n "${2:-}" ] || { echo "usage: launch.sh --recover <out dir>"; exit 2; }
  exec "$NODE" "$HERE/run.mjs" --recover "$2"
fi

if [ "${1:-}" = "--clean-sandbox" ]; then
  exec "$NODE" "$HERE/run.mjs" --clean-sandbox
fi

SCENARIOS="${1:-}"
[ -f "$SCENARIOS" ] || { echo "usage: launch.sh <scenarios.json> [run.mjs options]"; exit 2; }
shift

[ -x "$NODE" ] || { echo "node not found at $NODE"; exit 1; }
STAMP="$(date +%m%d%H%M%S)"
LABEL="com.nickmadaio.orion.gate-run.$STAMP"
OUT="$GATE_ROOT/run-$STAMP"
CODE="$GATE_ROOT/code-$STAMP"
mkdir -p "$OUT" "$CODE"
cp -R "$HERE/lib" "$HERE/ask.mjs" "$HERE/run.mjs" "$HERE/prefix.mjs" "$CODE/"
cp "$SCENARIOS" "$OUT/scenarios.json"

# Arguments as plist strings. --out is fixed so results land where this script tails.
ARGS_XML="    <string>$OUT/scenarios.json</string>
    <string>--out</string>
    <string>$OUT</string>"
for a in "$@"; do
  esc="${a//&/&amp;}"; esc="${esc//</&lt;}"; esc="${esc//>/&gt;}"
  ARGS_XML="$ARGS_XML
    <string>$esc</string>"
done

# The app passes GOG_KEYRING_PASSWORD from its Secrets; launchd cannot read ~/Desktop/ORION/.env, so read it here.
ENV_XML=""
GOG="$(sed -n 's/^\(export \)\{0,1\}GOG_KEYRING_PASSWORD=//p' "$HOME_DIR/Desktop/ORION/.env" 2>/dev/null | head -1 | sed 's/^["'"'"']//; s/["'"'"']$//')"
if [ -n "$GOG" ]; then
  GOG="${GOG//&/&amp;}"; GOG="${GOG//</&lt;}"
  ENV_XML="    <key>GOG_KEYRING_PASSWORD</key><string>$GOG</string>"
fi

PLIST="$OUT/$LABEL.plist"
umask 077
TEMPLATE="$(cat "$HERE/com.nickmadaio.orion.gate-run.plist.template")"
TEMPLATE="${TEMPLATE//@LABEL@/$LABEL}"
TEMPLATE="${TEMPLATE//@NODE@/$NODE}"
TEMPLATE="${TEMPLATE//@RUNNER@/$CODE/run.mjs}"
TEMPLATE="${TEMPLATE//@HOME@/$HOME_DIR}"
TEMPLATE="${TEMPLATE//@OUT@/$OUT}"
TEMPLATE="${TEMPLATE//@ARGS@/$ARGS_XML}"
TEMPLATE="${TEMPLATE//@ENV@/$ENV_XML}"
printf '%s\n' "$TEMPLATE" > "$PLIST"
plutil -lint "$PLIST" >/dev/null || { echo "generated plist is invalid: $PLIST"; exit 1; }

if [ -n "${GATE_PLIST_ONLY:-}" ]; then echo "plist written and validated, not loaded: $PLIST"; exit 0; fi
launchctl bootstrap "$DOMAIN" "$PLIST" || { echo "launchctl bootstrap failed"; exit 1; }
rm -f "$PLIST"   # launchd holds the definition; do not leave the keyring password on disk
echo "started $LABEL"
echo "  results: $OUT/results.jsonl"
echo "  log:     $OUT/run.log"
echo "  stop:    $0 --stop $LABEL"
[ -n "${GATE_NO_WAIT:-}" ] && exit 0

# Follow the log until the runner says it is done or the job is gone.
touch "$OUT/run.log"
tail -n +1 -f "$OUT/run.log" &
TAIL=$!
trap 'kill $TAIL 2>/dev/null' EXIT
while ! grep -q "GATE RUN DONE\|^run: " "$OUT/run.log" 2>/dev/null; do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 3
done
sleep 1
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
echo
echo "== summary =="
cat "$OUT/summary.json" 2>/dev/null || echo "(no summary.json: the run did not finish)"
