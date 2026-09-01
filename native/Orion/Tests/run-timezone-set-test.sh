#!/bin/bash
#
# `orion-timezone set` -- the one command Nick runs on the day he lands.
#
#   ./Tests/run-timezone-set-test.sh
#
# WHAT THIS PROVES: that the command re-homes every cron job, writes the record,
# clears a satisfied expectation, is idempotent on a second run, and -- the part
# that matters most -- REFUSES TO WRITE THE RECORD when a job did not actually
# move. A record that is ahead of the world is the exact failure the whole
# timezone batch exists to remove.
#
# It runs the REAL script against a fake gateway (ORION_OPENCLAW_BIN) whose job
# store persists between invocations, so the script's verify-by-re-reading step
# is genuinely exercised. A fake that forgot its writes would let a broken
# verification pass.
#
# It exists because of orion-lock: written to treat a status of "applied" as
# success, which changePermissionProfile never returns, so a SUCCESSFUL
# emergency lockdown would have reported failure. Caught only by running it.
#
# WHAT IT DOES NOT PROVE: that `openclaw cron edit --tz` behaves as assumed.
# That is proven by a real round trip, recorded in planning/v2/HANDOFF.md.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
NODE="$HOME/.openclaw/tools/node-v24.15.0/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/.openclaw/orion-controlled"

export ORION_OPENCLAW_BIN="$HERE/TimezoneSetHarness/fake-openclaw"
export ORION_FAKE_CRON="$SANDBOX/cron.json"

pass=0; fail=0
ok   () { pass=$((pass+1)); echo "  ok    $1"; }
bad  () { fail=$((fail+1)); echo "  FAIL  $1 -- $2"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3], got [$2]"; fi; }

seed () {
  cat > "$ORION_FAKE_CRON" <<'JSON'
{"jobs":[
 {"id":"a-1","name":"orion-focus-guard","enabled":true,"schedule":{"kind":"cron","expr":"* * * * *","tz":"America/New_York"}},
 {"id":"b-2","name":"orion-standing-orders","enabled":true,"schedule":{"kind":"cron","expr":"0 * * * *","tz":"America/New_York"}},
 {"id":"c-3","name":"orion-daily-memory","enabled":true,"schedule":{"kind":"cron","expr":"10 2 * * *","tz":"America/New_York"}}
]}
JSON
  cat > "$SANDBOX/.openclaw/orion-controlled/location.json" <<'JSON'
{"home":"America/New_York","place":"Montvale, New Jersey",
 "expectedMove":{"destination":"Europe/London","on":"2026-09-08","place":"London, United Kingdom"}}
JSON
}

tz_of () { "$NODE" -e 'const s=JSON.parse(require("fs").readFileSync(process.env.ORION_FAKE_CRON,"utf8"));
  process.stdout.write(s.jobs.find(j=>j.name===process.argv[1]).schedule.tz??"null")' "$1"; }
rec () { "$NODE" -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  process.stdout.write(String(eval("s."+process.argv[2])))' "$SANDBOX/.openclaw/orion-controlled/location.json" "$1" 2>/dev/null || echo MISSING; }

run () { HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-timezone" "$@" 2>&1; }

echo "== the happy path =="
seed
out="$(run set Europe/London --place "London, United Kingdom")"; status=$?
check "exits 0" "$status" "0"
check "focus-guard re-homed"     "$(tz_of orion-focus-guard)"     "Europe/London"
check "standing-orders re-homed" "$(tz_of orion-standing-orders)" "Europe/London"
check "daily-memory re-homed"    "$(tz_of orion-daily-memory)"    "Europe/London"
check "record home"  "$(rec home)"  "Europe/London"
check "record place" "$(rec place)" "London, United Kingdom"
check "satisfied expectation cleared" "$(rec expectedMove)" "undefined"
case "$out" in *"Undo:"*) ok "prints the undo command";; *) bad "prints the undo command" "absent";; esac

echo "== idempotent =="
out="$(run set Europe/London --place "London, United Kingdom")"
case "$out" in *unchanged*) ok "a second run reports unchanged";; *) bad "a second run reports unchanged" "$out";; esac

echo "== a job the gateway refuses =="
seed
export ORION_FAKE_REFUSE="orion-daily-memory"
out="$(run set Europe/London --place "London, United Kingdom")"; status=$?
unset ORION_FAKE_REFUSE
check "exits non-zero" "$([ $status -ne 0 ] && echo yes || echo no)" "yes"
check "the refusing job did NOT move" "$(tz_of orion-daily-memory)" "America/New_York"
# The load-bearing assertion: the record must still say New York, because the
# world does. A record ahead of the world is the failure being prevented.
check "the record was NOT written" "$(rec home)" "America/New_York"
case "$out" in *"still not on"*) ok "names the jobs that did not move";; *) bad "names the jobs that did not move" "$out";; esac

echo "== a zone that must be refused before anything is touched =="
seed
for z in UTC EST GMT+0500 Etc/UTC Mars/Olympus; do
  out="$(run set "$z")"; status=$?
  if [ $status -eq 2 ] && [ "$(tz_of orion-daily-memory)" = "America/New_York" ]; then
    ok "$z refused, nothing touched"
  else
    bad "$z refused, nothing touched" "status=$status tz=$(tz_of orion-daily-memory)"
  fi
done

echo ""
if [ $fail -eq 0 ]; then echo "$pass checks passed"; exit 0; fi
echo "$fail of $((pass+fail)) checks failed"; exit 1
