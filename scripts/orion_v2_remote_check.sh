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
# A stub brain, so the checks exercise ROUTING without spending a model turn --
# and so a machine with no gateway can still run them. It answers in the real
# envelope shape, which is the shape that matters: the first version of the
# reply extraction guessed at fields that do not exist and would have answered
# every question with "(Orion had nothing to say)" while reporting success.
BRAIN_STUB="$SANDBOX/fake-openclaw"
cat > "$BRAIN_STUB" <<'STUB'
#!/bin/bash
# argv: agent --session-key <k> --timeout <s> --json --message-file <path>
for i in "$@"; do :; done
msg=""
brief="no"
prev=""
for a in "$@"; do
  if [ "$prev" = "--message-file" ]; then
    # The message file now carries a transport brief followed by Nick's line.
    # Report them separately: the LAST line is what he actually sent, and
    # whether the brief arrived is its own assertion below.
    grep -q "orion-remote. Context from the transport" "$a" && brief="yes"
    msg="$(tail -1 "$a")"
  fi
  [ "$prev" = "--session-key" ] && session="$a"
  prev="$a"
done
echo "{\"runId\":\"run-stub-1\",\"status\":\"ok\",\"summary\":\"completed\",\"result\":{\"payloads\":[{\"text\":\"STUBBRAIN saw [$msg] in session [$session] brief=[$brief]\",\"mediaUrl\":null}]}}"
STUB
chmod +x "$BRAIN_STUB"

remote() { HOME="$SANDBOX" ORION_REMOTE_ALLOW="${ALLOW:-local}" ORION_BRAIN_BIN="$BRAIN_STUB" "$NODE" "$REMOTE" "$@" 2>&1; }
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
# A path that SURVIVES tokenisation is clearly a command attempt, and gets the
# usage line naming the three roots. A bare "~" does not survive -- the
# tokeniser strips leading non-alphanumerics, so the argument ceases to exist
# and the message becomes indistinguishable from typing "files" in conversation.
# Since 2026-09-02 that case goes to the brain, because capturing bare English
# words was hijacking real messages: "pause", meaning pause the music, was
# answered with "pause needs a mission id".
#
# What must hold in EVERY case is the thing that actually matters: nothing
# outside the three roots is ever listed.
for BAD in "/etc/passwd" "../../etc" "desktop/../.ssh"; do
    OUT="$(remote handle "files $BAD" --from local)"
    echo "$OUT" | grep -qE "root must be one of|files needs one of"
    check $? "files refuses '$BAD' and names the three valid roots"
    if echo "$OUT" | grep -q "Orion | "; then check 1 "and '$BAD' listed nothing"; else check 0 "and '$BAD' listed nothing"; fi
done
for BARE in "~" "."; do
    OUT="$(remote handle "files $BARE" --from local)"
    if echo "$OUT" | grep -q "Orion | "; then check 1 "'files $BARE' lists nothing"; else check 0 "'files $BARE' lists nothing"; fi
done

# The regression that prompted all of this: a bare verb word is CONVERSATION.
BARE_VERB="$(remote handle 'pause' --from local)"
echo "$BARE_VERB" | grep -q "STUBBRAIN saw \[pause\]"
check $? "a bare 'pause' reaches the brain -- far more often about music than about a mission"
if echo "$BARE_VERB" | grep -q "needs a mission id"; then
    check 1 "and is NOT captured by the mission verb"
else
    check 0 "and is NOT captured by the mission verb"
fi

# Every guard must run BEFORE the brain, or attaching it widened the attack
# surface rather than the usefulness. These are the same four rules as above,
# re-asserted against a message that would otherwise reach the model.
echo ""
echo "== the brain sits BEHIND every guard =="
UNKNOWN="$(ALLOW=local remote handle 'tell me a secret' --from a-stranger)"
[ -z "$UNKNOWN" ]
check $? "a stranger's question never reaches the brain -- silence, not an answer"

echo '{"locked":true,"at":"2026-09-02T00:00:00Z","by":"test"}' > "$CTRL/lock.json"
LOCKED_Q="$(remote handle 'what is the capital of France' --from local)"
echo "$LOCKED_Q" | grep -q "Orion is locked"
check $? "and a locked Orion will not think either -- LOCK ORION stops the brain, not just the verbs"
if echo "$LOCKED_Q" | grep -q "STUBBRAIN"; then check 1 "and the model was never invoked"; else check 0 "and the model was never invoked"; fi
rm -f "$CTRL/lock.json"

echo ""
echo "== who is obeyed =="
OUT="$(ALLOW=local remote handle 'device' --from someone-else)"
[ -z "$OUT" ]
check $? "an unknown sender gets SILENCE, not a refusal -- confirming the address works is itself information"

echo ""
echo "== a message cannot forge its own sender =="
#
# The bridge builds: node orion-remote inject --from <id> -- <text>. The old
# order put the text first, and a message beginning with "--" was taken as a
# flag name that then SWALLOWED the --from after it: `flags.from` was never set,
# the sender fell back to "local", and a stranger was attributed to -- and where
# "local" is allowlisted, authorised as -- the local account. It also wrote the
# real sender id into the audit as the message TEXT.
rm -f "$CTRL/inbox.jsonl"
remote inject --from "999888777" -- "--x" > /dev/null 2>&1
FORGED="$("$NODE" -e "
const l=require('fs').readFileSync('$CTRL/inbox.jsonl','utf8').trim().split('\n').pop();
const e=JSON.parse(l); process.stdout.write(e.from + '|' + e.text);")"
[ "$FORGED" = "999888777|--x" ]
check $? "a message beginning with -- stays the message and the sender stays the sender (got: $FORGED)"

# The layer that would have caught it even without the terminator.
#
# Output is captured BEFORE grepping. `set -o pipefail` is on and these two
# commands correctly exit 2 when they refuse, so `remote ... | grep -q ...`
# returns 2 even when the grep matches -- the assertion would read a working
# refusal as a failure. This is the pipefail trap, and it is why every other
# assertion in this file greps a variable rather than a pipeline.
REFUSAL="$(remote inject "--x" --from "999888777")"
echo "$REFUSAL" | grep -q "unknown option --x"
check $? "and an unrecognised flag is REFUSED rather than silently accepted (said: $REFUSAL)"
NOVALUE="$(remote inject --from)"
echo "$NOVALUE" | grep -q "needs a value"
check $? "a flag with no value is an error rather than undefined (said: $NOVALUE)"

echo ""
echo "== malformed, replayed, stale, misaddressed =="
# THE DESIGN CHANGED HERE, DELIBERATELY. This file used to assert "no
# fallthrough to a model", which was the original safety property. Nick's
# decision on 2026-09-02 -- "the idea is that its a remote way to directly speak
# to the orion brain" -- inverts it: anything that is not one of the verbs is a
# question, and gets an answer. What must remain true is that every guard still
# runs FIRST, which is what the rest of this section now pins.
BRAINED="$(remote handle 'what is the capital of France' --from local)"
# Pinned to the MESSAGE, not just to the brain being reached. "STUBBRAIN saw"
# alone passed a mutant in which the transport brief REPLACED Nick's words
# instead of preceding them -- the brain was reached and heard nothing he said.
echo "$BRAINED" | grep -q "STUBBRAIN saw \[what is the capital of France\]"
check $? "a message that is not a verb reaches the brain intact, rather than being refused or swallowed"
echo "$BRAINED" | grep -q "in session \[orion-app-v2\]"
check $? "and it lands in orion-app-v2 -- the SAME session GatewayClient.swift uses, so it is one Orion with one memory rather than a forgetful lookalike"

# The brain must be TOLD what channel it is speaking through. Without this it
# described its own permission state from memory, offered to "enable" a channel
# it was already answering on, and invented an approval syntax that does not
# exist -- fluent, confident and wrong, where the pre-brain answer had been a
# true "not a command I know".
echo "$BRAINED" | grep -q "brief=\[yes\]"
check $? "and it arrives with the transport brief, so Orion knows the channel exists and is already working"
SHELLY="$(remote handle 'device; rm -rf /' --from local)"
echo "$SHELLY" | grep -qE "takes no arguments|not a command|Orion \| DEVICE"
check $? "a shell metacharacter cannot reach a shell -- it is tokenised, never interpreted (said: $(echo "$SHELLY" | head -1 | cut -c1-50))"
# A zero-argument verb given arguments must produce a sentence, not half of one.
echo "$(remote handle 'device now please' --from local)" | grep -q "device takes no arguments"
check $? "and a verb that takes no arguments says exactly that, rather than 'device needs ' with nothing after it"

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

# An envelope that cannot say WHEN it was sent cannot be shown to be fresh. This
# was the fail-open-on-absent-field pattern and nothing covered it: `at` missing
# entirely, or present but not a number. Note Number(null) is 0, not NaN, so a
# naive coercion dates an unstamped envelope to the epoch and "expires" it with
# a nonsense age -- right answer, wrong reason, and it stops being the right
# answer the moment anyone compares against a window instead of a threshold.
cat > "$CTRL/inbox.jsonl" <<JSON
{"id":"eeeeeeeeeeee","from":"local","text":"device"}
{"id":"ffffffffffff","from":"local","text":"device","at":"yesterday"}
{"id":"111111111111","from":"local","text":"device","at":null}
JSON
"$NODE" -e "
const fs=require('fs'); const p='$CTRL/remote-inbound.json';
const s=JSON.parse(fs.readFileSync(p,'utf8')); s.cursor=0; fs.writeFileSync(p,JSON.stringify(s));"
remote poll > /dev/null 2>&1
[ "$(grep -c 'expired (no usable timestamp)' "$AUDIT")" -ge 3 ]
check $? "all three unstampable envelopes are refused, and the audit says WHY rather than inventing an age"

# The subtle half, and the one a naive implementation gets wrong.
# EXACTLY one, not "at most two". The loose form passed while printing growth it
# denied: a mutant that recorded the misaddressed envelope still landed inside
# the bound. An assertion that tolerates the defect it names is worse than none.
# (Independent review, 2026-09-02.)
SEEN_AFTER="$(seen_count)"
[ "$SEEN_AFTER" -eq $((SEEN_BEFORE + 1)) ]
check $? "and the misaddressed one consumed no replay memory -- only the one valid envelope did (seen went $SEEN_BEFORE -> $SEEN_AFTER, expected $((SEEN_BEFORE + 1)))"

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
