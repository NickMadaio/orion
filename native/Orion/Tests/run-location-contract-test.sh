#!/bin/bash
#
# The cross-language contract for Phase 40's location record.
#
#   ./Tests/run-location-contract-test.sh
#
# WHAT THIS PROVES: that the Mac app's `TimeZonePolicy` decodes the exact bytes
# `scripts/orion-timezone` writes, and that the two runtimes agree about which
# zone NAMES are storable.
#
# The second half is the one that earns its keep. Foundation and ICU (node)
# canonicalise 47 zone names differently, in BOTH directions -- measured
# 2026-09-01: ICU spells it America/Buenos_Aires and has never heard of
# America/Argentina/Buenos_Aires; Foundation is the exact opposite, and rewrites
# America/Nuuk to nothing while ICU rewrites it to America/Godthab. A script
# that writes an ICU-canonical name the Swift side refuses produces a file the
# app cannot read, and the symptom appears somewhere else entirely.
#
# The bytes are REAL: this runs the actual script against a scratch HOME and
# feeds the app the file it produced. A hand-written fixture here would test
# this script's idea of the format rather than the format.
#
# WHAT IT DOES NOT PROVE: anything about the live location.json or the live cron
# jobs. It never touches them -- HOME is redirected, so `set` is not exercised
# at all and only `expect` runs, which writes nothing outside the sandbox.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

NODE="$HOME/.openclaw/tools/node-v24.15.0/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "no node found"; exit 2; }

# A scratch HOME so the script writes a sandbox file and cannot see, or be
# confused by, the real one.
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/.openclaw/orion-controlled"

echo "== producing a record with the real script =="
# `expect` and a home change, without touching cron: HOME is redirected, so the
# openclaw binary is absent and any cron path would fail loudly rather than
# silently reaching the real jobs.
cat > "$SANDBOX/.openclaw/orion-controlled/location.json" <<'JSON'
{
  "home": "Europe/London",
  "place": "London, United Kingdom"
}
JSON
HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-timezone" expect Europe/London 2026-09-08 \
  --place "London, United Kingdom" >/dev/null || { echo "the script failed to record a move"; exit 1; }

RECORD="$SANDBOX/.openclaw/orion-controlled/location.json"
[ -s "$RECORD" ] || { echo "the script wrote no record"; exit 1; }

echo "== building the contract harness against the real domain sources =="
swiftc -O \
  "$ROOT/Sources/SessionDomain/ZonedTime.swift" \
  "$ROOT/Sources/SessionDomain/TimeZonePolicy.swift" \
  "$HERE/LocationContractHarness/main.swift" \
  -o "$BUILD/location-contract" \
  || { echo "contract harness failed to build"; exit 1; }

"$BUILD/location-contract" "$RECORD"
