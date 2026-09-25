#!/bin/bash
# Phase 48: an installed copy that was changed outside its installer does not run.
# Drives scripts/lib/orion-integrity.mjs (the verifier launchd starts in place of
# the bridge) against a sandbox copy and a sandbox gate; touches nothing live.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
export ORION_GATE_DIR="$SANDBOX/gate" ORION_INTEGRITY_REFUSE_DELAY_MS=0
mkdir -p "$SANDBOX/copy/scripts"
echo 'console.log("bridge ran")' > "$SANDBOX/copy/scripts/bridge.mjs"
echo 'TOKEN=abc' > "$SANDBOX/copy/.env"
V="$REPO/scripts/lib/orion-integrity.mjs"
failures=0
check() { if [ "$1" = "0" ]; then printf 'ok   %s\n' "$2"; else printf 'FAIL %s\n' "$2"; failures=$((failures + 1)); fi; }

"$NODE" "$V" run bridge "$SANDBOX/copy" -- "$NODE" "$SANDBOX/copy/scripts/bridge.mjs" > "$SANDBOX/out" 2>&1
[ $? != 0 ] && ! grep -q "bridge ran" "$SANDBOX/out"
check $? "with no manifest recorded, the copy does not run"
"$NODE" "$V" record bridge "$SANDBOX/copy" >/dev/null; check $? "the installer records a manifest in the gate"
"$NODE" "$V" run bridge "$SANDBOX/copy" -- "$NODE" "$SANDBOX/copy/scripts/bridge.mjs" > "$SANDBOX/out" 2>&1
[ $? = 0 ] && grep -q "bridge ran" "$SANDBOX/out"; check $? "an untouched copy runs"
echo 'console.log("tampered")' > "$SANDBOX/copy/scripts/bridge.mjs"
"$NODE" "$V" run bridge "$SANDBOX/copy" -- "$NODE" "$SANDBOX/copy/scripts/bridge.mjs" > "$SANDBOX/out" 2>&1
status=$?
[ "$status" = 78 ] && ! grep -q "tampered" "$SANDBOX/out" && grep -q "changed: scripts/bridge.mjs" "$SANDBOX/out"
check $? "a changed file is refused before it runs, and named (exit $status)"
"$NODE" "$V" record bridge "$SANDBOX/copy" >/dev/null
echo 'TOKEN=stolen' > "$SANDBOX/copy/.env"
"$NODE" "$V" verify bridge "$SANDBOX/copy" > "$SANDBOX/out" 2>&1
[ $? != 0 ] && grep -q ".env" "$SANDBOX/out"; check $? "the token file is covered too"
[ "$failures" = "0" ] && echo "integrity check: OK" || { echo "integrity check: $failures FAILED"; exit 1; }
