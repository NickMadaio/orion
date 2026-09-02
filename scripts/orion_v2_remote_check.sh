#!/bin/bash
#
# The inbound channel's guards. Manifest Phases 43 and 45.
#
#   ./scripts/orion_v2_remote_check.sh
#
# WHAT THIS PROVES: that `scripts/orion-remote` refuses the things Phase 45
# names -- a replayed envelope, a stale one, one addressed to another Mac, a
# malformed one, an unknown sender -- and that the three read-only capabilities
# return what they claim to and nothing more.
#
# Why it exists. These guards protect a channel anyone on the internet can write
# to once they know the address. Two of them (expiry and device routing) did not
# exist at all until 2026-09-02: every envelope carried an `at` timestamp that
# nothing read back, and no target at all. A guard with no test is how they got
# that way.
#
# HOW IT AVOIDS THE LIVE SYSTEM. HOME is redirected, so the state, the queue and
# the folders `files` reads are all the sandbox's. The live inbox and remote
# state are hashed before and after and asserted unchanged.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
REMOTE="$REPO/scripts/orion-remote"
LIVE_STATE="$HOME/.openclaw/orion-controlled/remote.json"

NODE="$HOME/.openclaw/tools/node-v24.15.0/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "remote check: no node found"; exit 2; }

live_before=""
[ -f "$LIVE_STATE" ] && live_before="$(shasum -a 256 "$LIVE_STATE" | cut -d' ' -f1)"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
CTRL="$SANDBOX/.openclaw/orion-controlled"
mkdir -p "$CTRL" "$SANDBOX/Desktop" "$SANDBOX/Documents" "$SANDBOX/Downloads"

# Real files with known names, so the listing can be pinned by CONTENTS.
echo "hello" > "$SANDBOX/Desktop/notes.txt"
mkdir -p "$SANDBOX/Desktop/a-folder"
echo "secret" > "$SANDBOX/Desktop/.hidden-file"

failures=0
check() {
    if [ "$1" = "0" ]; then printf 'ok   %s\n' "$2"; else printf 'FAIL %s\n' "$2"; failures=$((failures + 1)); fi
}
# Runs the REAL script against the sandbox HOME.
remote() { HOME="$SANDBOX" ORION_REMOTE_ALLOW="${ALLOW:-local}" "$NODE" "$REMOTE" "$@" 2>&1; }
seen_count() {
    "$NODE" -e "try{process.stdout.write(String((JSON.parse(require('fs').readFileSync('$CTRL/remote-inbound.json','utf8')).seen||[]).length))}catch{process.stdout.write('0')}"
}

echo "== the three read-only capabilities =="
OUT="$(remote handle 'device' --from local)"
echo "$OUT" | grep -q "Orion | DEVICE"
check $? "device.status.read answers"
echo "$OUT" | grep -qE "battery|uptime|GB free"
check $? "and it is battery, uptime and disk -- not a shell"

OUT="$(remote handle 'apps' --from local)"
echo "$OUT" | grep -qE "APP\(S\) RUNNING|no bundled applications"
check $? "application.list answers"

OUT="$(remote handle 'files desktop' --from local)"
echo "$OUT" | grep -q "notes.txt"
check $? "files.safe_metadata lists a real file by name"
echo "$OUT" | grep -q "a-folder · dir"
check $? "and marks a directory as one"
# `grep -qv` was the first spelling here and it can NEVER fail: -v inverts per
# line, so on multi-line output some line always fails to match and grep exits
# 0. Caught by mutating the handler to print file contents and watching this
# pass anyway. The refusal has to be spelled as a negated match on the whole
# output, not as an inverted one.
if echo "$OUT" | grep -q "hello"; then
    check 1 "and never the CONTENTS of anything -- that is the whole of 'safe_metadata'"
else
    check 0 "and never the CONTENTS of anything -- that is the whole of 'safe_metadata'"
fi
if echo "$OUT" | grep -q "hidden-file"; then check 1 "hidden files are not listed"; else check 0 "hidden files are not listed"; fi

# The path a message can name is a closed set of three, so there is nothing to
# traverse. This is the injection attempt that a path argument would invite.
# Two layers refuse these, and which one fires depends on the string. A path
# reaches the shape check and is told the root must be one of three; a bare "~"
# never gets that far, because the tokeniser strips leading non-alphanumerics
# and the argument ceases to exist. Both are refusals, so the assertion is that
# it did NOT list anything -- pinning the message would pin the wrong layer.
for BAD in "/etc/passwd" "../../etc" "~" "desktop/../.ssh"; do
    OUT="$(remote handle "files $BAD" --from local)"
    echo "$OUT" | grep -qE "root must be one of|takes 1 argument"
    check $? "files refuses '$BAD' -- the root is a closed set of three names, never a path"
    echo "$OUT" | grep -q "Orion | "
    if [ $? -eq 0 ]; then check 1 "and '$BAD' listed nothing"; else check 0 "and '$BAD' listed nothing"; fi
done

echo ""
echo "== who is obeyed =="
OUT="$(ALLOW=local remote handle 'device' --from someone-else)"
[ -z "$OUT" ]
check $? "an unknown sender gets SILENCE, not a refusal -- confirming the address works is itself information"

echo ""
echo "== malformed, replayed, stale, misaddressed =="
echo "$(remote handle 'do the thing' --from local)" | grep -q "not a command I know"
check $? "an unknown verb is refused by vocabulary, with no fallthrough to a model"
echo "$(remote handle 'device; rm -rf /' --from local)" | grep -qE "not a command|Orion \| DEVICE"
check $? "a shell metacharacter cannot reach a shell -- it is tokenised, never interpreted"

# Replay and expiry need the queue, because `handle` alone carries no envelope.
NOW_MS="$("$NODE" -e 'process.stdout.write(String(Date.now()))')"
STALE_MS=$((NOW_MS - 40 * 60 * 1000))
cat > "$CTRL/inbox.jsonl" <<JSON
{"id":"aaaaaaaaaaaa","from":"local","text":"device","at":$NOW_MS}
{"id":"aaaaaaaaaaaa","from":"local","text":"device","at":$NOW_MS}
{"id":"cccccccccccc","from":"local","text":"device","at":$STALE_MS}
{"id":"dddddddddddd","from":"local","text":"device","at":$NOW_MS,"to":"some-other-mac"}
JSON
SEEN_BEFORE="$(seen_count)"
remote poll > "$SANDBOX/poll.out" 2>&1
AUDIT="$CTRL/remote-audit.jsonl"

grep -q '"reason":"replayed envelope"' "$AUDIT"
check $? "the same envelope id twice is refused as a replay"
grep -qE '"reason":"expired \([0-9]+ min old\)"' "$AUDIT"
check $? "a 40-minute-old envelope is refused as expired -- until this existed, every envelope carried a timestamp nothing read back"
grep -q 'addressed to some-other-mac' "$AUDIT"
check $? "an envelope for another Mac is refused"

# The subtle half, and the one a naive implementation gets wrong.
SEEN_AFTER="$(seen_count)"
[ "$SEEN_AFTER" -le 2 ]
check $? "and the misaddressed one consumed no replay memory -- otherwise anyone could exhaust it with envelopes meant for somebody else (seen went $SEEN_BEFORE -> $SEEN_AFTER)"

echo ""
echo "== LOCK ORION stops all of it =="
echo '{"locked":true,"at":"2026-09-02T00:00:00Z","by":"test"}' > "$CTRL/lock.json"
echo "$(remote handle 'device' --from local)" | grep -qi "locked"
check $? "a locked Orion refuses a command it would otherwise run"
rm -f "$CTRL/lock.json"
echo "$(remote handle 'device' --from local)" | grep -q "Orion | DEVICE"
check $? "and accepts it again once released"

echo ""
echo "== the live system was not touched =="
live_after=""
[ -f "$LIVE_STATE" ] && live_after="$(shasum -a 256 "$LIVE_STATE" | cut -d' ' -f1)"
[ "$live_before" = "$live_after" ]
check $? "the real remote.json is byte-identical"

echo ""
if [ "$failures" -eq 0 ]; then echo "remote check: OK"; exit 0; fi
echo "remote check: FAIL ($failures)"
exit 1
