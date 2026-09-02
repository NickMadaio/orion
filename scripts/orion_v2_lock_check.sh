#!/bin/bash
#
# Does the panic button still work?  Manifest Phase 43.
#
#   ./scripts/orion_v2_lock_check.sh
#
# WHAT THIS PROVES: that `scripts/orion-lock` actually drops the permission
# profile to the floor, writes the append-only permission audit, and asks for
# every cron job to be disabled -- run as the real script, against a real
# permission-state.json, through the real `changePermissionProfile`.
#
# Why it exists. LOCK ORION is the one command whose whole value is working on
# the worst day, and until now it had no automated check of any kind: it was
# verified once by hand and then left. A kill switch nobody re-tests is a kill
# switch nobody knows still works, and the failure is discovered at exactly the
# wrong moment. An earlier draft of the script already tested for a writer
# status string ("applied") that never occurs, which would have reported a
# SUCCESSFUL lockdown as a failure -- that class of defect is what this catches.
#
# HOW IT AVOIDS THE LIVE SYSTEM. HOME is redirected to a scratch directory, so
# the state, the audit and the openclaw binary the script finds are all the
# sandbox's. `openclaw` is a stub that records the argv it was handed instead of
# touching real cron. The live permission-state.json is hashed before and after
# and asserted unchanged, because "the test ran the panic button" and "the test
# ran the panic button on Nick's machine" differ by one environment variable.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LIVE_STATE="$HOME/.openclaw/orion-controlled/permission-state.json"

NODE="$HOME/.openclaw/tools/node-v24.15.0/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "lock check: no node found"; exit 2; }
[ -f "$REPO/openclaw-plugins/orion-control/dist/permissions.js" ] || {
    echo "lock check: the plugin is not built"; exit 2; }

live_before=""
[ -f "$LIVE_STATE" ] && live_before="$(shasum -a 256 "$LIVE_STATE" | cut -d' ' -f1)"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/.openclaw/orion-controlled" "$SANDBOX/.openclaw/bin"

STATE="$SANDBOX/.openclaw/orion-controlled/permission-state.json"
AUDIT="$SANDBOX/.openclaw/orion-controlled/permission-audit.jsonl"
CRONLOG="$SANDBOX/cron-calls.txt"

# Seed the sandbox at the TOP profile, so a lock has the whole distance to fall.
cat > "$STATE" <<'JSON'
{"profile": "external_connected", "version": 3, "updatedAt": "2026-08-12T23:05:39.845107-04:00"}
JSON

# A stub openclaw that answers `cron list` in the real column layout and records
# every `cron disable` it is asked for.
cat > "$SANDBOX/.openclaw/bin/openclaw" <<STUB
#!/bin/bash
if [ "\$1" = "cron" ] && [ "\$2" = "list" ]; then
  echo "ID                                    SCHEDULE  NAME"
  echo "11111111-1111-1111-1111-111111111111  daily     orion-focus-guard"
  echo "22222222-2222-2222-2222-222222222222  daily     orion-standing-orders"
  echo "33333333-3333-3333-3333-333333333333  daily     orion-daily-memory"
  exit 0
fi
if [ "\$1" = "cron" ] && [ "\$2" = "disable" ]; then
  echo "\$3" >> "$CRONLOG"
  exit 0
fi
exit 1
STUB
chmod +x "$SANDBOX/.openclaw/bin/openclaw"

# State for the transport half: two queued jobs, one pending approval, one live
# link. Without these the Phase 43 checks below would pass vacuously.
cat > "$SANDBOX/.openclaw/orion-controlled/inbox.jsonl" <<'JSON'
{"id":"aaaaaaaaaaaa","from":"local","text":"device","at":1}
{"id":"bbbbbbbbbbbb","from":"local","text":"apps","at":2}
JSON
cat > "$SANDBOX/.openclaw/orion-controlled/remote.json" <<'JSON'
{"missions":{},"pending":{"ap-11223344":{"missionId":"m1","request":"use the staging key","status":"pending"}},"notify":{"sent":[],"deferred":[]}}
JSON
cat > "$SANDBOX/.openclaw/orion-controlled/remote-link.json" <<'JSON'
{"state":"online","connectionId":"session-abc","lastSeen":"2026-09-02T00:00:00.000Z"}
JSON

failures=0
check() {
    if [ "$1" = "0" ]; then printf 'ok   %s\n' "$2"; else printf 'FAIL %s\n' "$2"; failures=$((failures + 1)); fi
}
profile_now() { "$NODE" -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$STATE','utf8')).profile)"; }
version_now() { "$NODE" -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$STATE','utf8')).version))"; }

echo "== locking, in a sandbox =="
HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-lock" > "$SANDBOX/lock.out" 2>&1
lock_status=$?
sed 's/^/   | /' "$SANDBOX/lock.out"

check "$lock_status" "orion-lock exits 0"
[ "$(profile_now)" = "restricted_read_only" ]
check $? "the profile is dropped to the floor (was external_connected, now $(profile_now))"
[ "$(version_now)" = "4" ]
check $? "the state version is bumped to 4, so a concurrent writer's stale expectation is refused"
[ -s "$AUDIT" ]
check $? "the append-only permission audit was written"
grep -q "restricted_read_only" "$AUDIT"
check $? "and the audit names the profile it moved to"
grep -q "orion-lock" "$AUDIT"
check $? "and records that orion-lock was what asked -- a panic button that bypasses the audit cannot be reconstructed afterwards"

# CONTENTS, not a count: the three ids the stub listed are the three that must
# have been disabled. A count of three would pass if it disabled one job thrice.
sort -u "$CRONLOG" 2>/dev/null > "$SANDBOX/disabled.txt"
printf '11111111-1111-1111-1111-111111111111\n22222222-2222-2222-2222-222222222222\n33333333-3333-3333-3333-333333333333\n' > "$SANDBOX/expected.txt"
diff -q "$SANDBOX/disabled.txt" "$SANDBOX/expected.txt" >/dev/null 2>&1
check $? "every scheduled job was asked to be disabled, by id"

# What the lock is actually WORTH, measured rather than asserted. "The profile
# string changed" is a weak claim; "78 of 78 actions were reachable and now 15
# are" is the thing Nick is relying on. Read out of the live plugin and the live
# catalogue, so widening restricted_read_only in permissions.ts fails here.
echo ""
echo "== what the floor actually denies =="
"$NODE" --input-type=module -e "
import { profileAllowedTiers } from '$REPO/openclaw-plugins/orion-control/dist/permissions.js';
import { ACTION_CATALOG } from '$REPO/openclaw-plugins/orion-control/dist/catalog.js';
const reach = (p) => {
  const tiers = new Set(profileAllowedTiers(p));
  return Object.values(ACTION_CATALOG).filter((a) => tiers.has(a.capabilityTier)).length;
};
const tiers = [...profileAllowedTiers('restricted_read_only')].sort().join(',');
const total = Object.keys(ACTION_CATALOG).length;
console.log(JSON.stringify({ tiers, floor: reach('restricted_read_only'), top: reach('external_connected'), total }));
" > "$SANDBOX/reach.json" 2>"$SANDBOX/reach.err" || { echo "FAIL could not measure the floor: $(cat "$SANDBOX/reach.err" | head -2)"; failures=$((failures + 1)); }

if [ -s "$SANDBOX/reach.json" ]; then
    echo "   | $(cat "$SANDBOX/reach.json")"
    # CONTENTS, not a count: three tiers whose names are the point. A count of
    # three would survive swapping desktop_read for file_mutate.
    grep -q '"tiers":"ambient_info,desktop_read,simulation"' "$SANDBOX/reach.json"
    check $? "the floor allows exactly ambient_info, desktop_read and simulation -- nothing writes, sends or modifies Orion"
    grep -q '"floor":15' "$SANDBOX/reach.json"
    check $? "which leaves 15 of the catalogue's actions reachable"
    grep -q '"top":78,"total":78' "$SANDBOX/reach.json"
    check $? "down from all 78 -- that reduction is what the panic button is worth"
fi

# Phase 43's three transport-dependent requirements, which could not be checked
# until Phase 44 gave them something to act on.
echo ""
echo "== what the lock does to the remote channel =="
LOCKFILE="$SANDBOX/.openclaw/orion-controlled/lock.json"
[ -f "$LOCKFILE" ]
check $? "a lock FLAG is written -- 'is ORION locked' is now a fact rather than an inference from the profile"
grep -q '"locked": true' "$LOCKFILE"
check $? "and it says so explicitly"

# The flag has to actually stop a dispatch, or it is decoration. This runs the
# REAL orion-remote against the sandbox lock.
DENIED=$(HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-remote" handle "device" --from local 2>&1)
echo "$DENIED" | grep -qi "locked"
check $? "and orion-remote refuses a command while it is up (said: $(echo "$DENIED" | head -1 | cut -c1-60))"

# Queued work is cancelled by advancing the cursor past it, so nothing waiting
# is handed to a verb when the lock is released.
CURSOR=$("$NODE" -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$SANDBOX/.openclaw/orion-controlled/remote-inbound.json','utf8')).cursor))" 2>/dev/null || echo missing)
[ "$CURSOR" = "2" ]
check $? "the inbox cursor is advanced past all 2 queued job(s), so none of them run later (cursor=$CURSOR)"

# A pending approval is a standing authorisation a remote message could still
# redeem. A lockdown that left one redeemable would leave behind the single
# thing that grants permission.
PENDING=$("$NODE" -e "
const s = JSON.parse(require('fs').readFileSync('$SANDBOX/.openclaw/orion-controlled/remote.json','utf8'));
process.stdout.write(Object.values(s.pending ?? {}).map(p => p.status).join(','));" 2>/dev/null || echo missing)
[ "$PENDING" = "expired_by_lock" ]
check $? "the pending approval is expired rather than left redeemable (status=$PENDING)"

# The live session is dropped, so a reconnect identifies afresh instead of
# resuming the one that was open when the button was pressed.
RESUMED=$("$NODE" -e "
const l = JSON.parse(require('fs').readFileSync('$SANDBOX/.openclaw/orion-controlled/remote-link.json','utf8'));
process.stdout.write(String(l.connectionId) + '/' + String(l.lockedOut));" 2>/dev/null || echo missing)
[ "$RESUMED" = "null/true" ]
check $? "the link's session is dropped so it cannot be resumed (connectionId/lockedOut=$RESUMED)"

echo ""
echo "== release lets him back in without restoring authority =="
HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-lock" release > "$SANDBOX/release.out" 2>&1
check $? "release exits 0"
[ ! -f "$LOCKFILE" ]
check $? "the flag is gone"
ALLOWED=$(HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-remote" handle "device" --from local 2>&1)
echo "$ALLOWED" | grep -qi "locked"
if [ $? -eq 0 ]; then check 1 "and commands are accepted again"; else check 0 "and commands are accepted again"; fi
[ "$(profile_now)" = "restricted_read_only" ]
check $? "but the profile is STILL on the floor -- release is not an unlock, and undoing the emergency stays a separate decision"

echo ""
echo "== locking again, when already locked =="
: > "$CRONLOG"
HOME="$SANDBOX" "$NODE" "$REPO/scripts/orion-lock" > "$SANDBOX/lock2.out" 2>&1
check $? "a second lock is not an error -- panicking twice must not fail"
[ "$(version_now)" = "4" ]
check $? "and it does not churn the version when there is nothing to change"
grep -q "already restricted_read_only" "$SANDBOX/lock2.out"
check $? "it says the profile was already at the floor"

echo ""
echo "== the live system was not touched =="
live_after=""
[ -f "$LIVE_STATE" ] && live_after="$(shasum -a 256 "$LIVE_STATE" | cut -d' ' -f1)"
[ "$live_before" = "$live_after" ]
check $? "the real permission-state.json is byte-identical"

echo ""
if [ "$failures" -eq 0 ]; then echo "lock check: OK"; exit 0; fi
echo "lock check: FAIL ($failures)"
exit 1
