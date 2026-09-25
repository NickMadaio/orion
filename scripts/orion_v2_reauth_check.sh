#!/bin/bash
# Phase 43: loosening ORION's guard needs the Mac's owner in person.
#
# Drives the real orion-mode against a scratch HOME. The owner check is a
# stand-in there (lib/orion-reauth.mjs honours ORION_REAUTH_BIN only when HOME
# is not the real home), so this never raises a Touch ID prompt, and the live
# strictness file is hashed before and after and must not change.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
LIVE="$HOME/.openclaw/orion-gate/strictness.json"
before=$(shasum "$LIVE" 2>/dev/null | cut -d' ' -f1)
mkdir -p "$SANDBOX/.openclaw/orion-gate"
# orion-mode loads the INSTALLED plugin's compiled modules from HOME; point the
# sandbox at the real, read-only copy.
mkdir -p "$SANDBOX/.openclaw/extensions"
ln -s "$HOME/.openclaw/extensions/orion-control" "$SANDBOX/.openclaw/extensions/orion-control"
printf '#!/bin/sh\nexit 1\n' > "$SANDBOX/deny"; chmod +x "$SANDBOX/deny"
printf '#!/bin/sh\n[ "$1" = authenticate ] && [ "$2" = --reason ] && [ -n "$3" ] || exit 2\nexit 0\n' > "$SANDBOX/confirm"; chmod +x "$SANDBOX/confirm"
failures=0
check() { if [ "$1" = "0" ]; then printf 'ok   %s\n' "$2"; else printf 'FAIL %s\n' "$2"; failures=$((failures + 1)); fi; }
mode() { HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-mode" --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).mode||JSON.parse(s).state.mode))'; }
run() { HOME="$SANDBOX" ORION_REAUTH_BIN="$SANDBOX/$1" "$NODE" "$REPO/scripts/orion-mode" "${@:2}" > "$SANDBOX/out" 2>&1; }

start=$(mode)
[ "$start" = "guarded" ]; check $? "a fresh sandbox starts guarded (got $start)"

run deny open --yes --for 1h; status=$?
[ "$status" != "0" ] && [ "$(mode)" = "guarded" ]
check $? "relaxing to open is refused when the owner does not confirm, and the mode is unchanged"
grep -q "Touch ID or password" "$SANDBOX/out"; check $? "and it says what it needs"

run confirm open --yes --for 1h; status=$?
[ "$status" = "0" ] && [ "$(mode)" = "open" ]
check $? "once the owner confirms, it relaxes"

run deny contained; status=$?
[ "$status" = "0" ] && [ "$(mode)" = "contained" ]
check $? "tightening never asks: the panic direction stays one step, even with a refusing owner check"

run deny guarded --yes; status=$?
[ "$status" != "0" ] && [ "$(mode)" = "contained" ]
check $? "lifting containment back to the default is a relaxation, and asks"

# Phase 50: --within scopes the delegation to folders, stored as absolute paths.
run confirm open --yes --for 1h --within "$SANDBOX/Projects"; status=$?
STORED=$("$NODE" -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync('$SANDBOX/.openclaw/orion-gate/strictness.json','utf8')).resources))")
[ "$status" = "0" ] && [ "$STORED" = "[\"$SANDBOX/Projects\"]" ]
check $? "--within stores the delegation's folders as absolute paths ($STORED)"
HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-mode" 2>/dev/null | grep -q "within    $SANDBOX/Projects"
check $? "and status shows the scope"

# Review 2026-09-26, M3: scope is part of the delegation.
run deny open --yes --for 1h; status=$?
STORED=$("$NODE" -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync('$SANDBOX/.openclaw/orion-gate/strictness.json','utf8')).resources))")
[ "$status" != "0" ] && [ "$STORED" = "[\"$SANDBOX/Projects\"]" ]
check $? "dropping --within at the same mode widens scope, so it asks the owner, and the scope stays ($STORED)"
run deny open --yes --for 1h --within "$SANDBOX/Projects/sub"; status=$?
[ "$status" = "0" ] && grep -q "Projects/sub" "$SANDBOX/.openclaw/orion-gate/strictness.json"
check $? "narrowing scope at the same mode is written, not answered with 'Already', and needs nobody"
run deny contained; status=$?
[ "$status" = "0" ] && [ "$(mode)" = "contained" ]
check $? "and tightening to contained still never asks, whatever it does to scope"

after=$(shasum "$LIVE" 2>/dev/null | cut -d' ' -f1)
[ "$before" = "$after" ]; check $? "the live strictness file is byte-identical"
[ "$failures" = "0" ] && echo "reauth check: OK" || { echo "reauth check: $failures FAILED"; exit 1; }
