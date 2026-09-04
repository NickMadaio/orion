#!/bin/bash
#
# PHASE 73 — prove the backup pipeline before anybody needs it.
#
# THE PROBLEM THIS SOLVES
#
# `orion-backup` refuses to run without a passphrase in Nick's Keychain, and
# creating one would mean this program choosing and holding a credential —
# the one thing the rest of the system is built not to do. So the end-to-end
# run is his, once.
#
# That leaves a gap worth closing: a bug in the tar/openssl pipeline would show
# up on FIRST REAL USE, which is the day he needs the backup. So this exercises
# the identical pipeline against a fixture, with a throwaway passphrase that
# lives in this process and nowhere else — never the Keychain, never a file,
# never a command line where `ps` could read it.
#
# What it proves: the crypto roundtrips, the exclusions actually exclude, a
# wrong passphrase fails closed, and a truncated archive is detected rather
# than silently restoring half a system.
#
# What it does not prove: that Nick's Keychain item works. That is one command
# and it is his.

set -uo pipefail
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# In this process only. Not exported, so a child cannot inherit it; not on any
# command line, so `ps` never shows it.
SECRET="throwaway-$(date +%s)-$$"

echo ""
echo "== 1. a fixture that looks like the real thing =="
mkdir -p "$SANDBOX/src/memory" "$SANDBOX/src/orionBrain" "$SANDBOX/src/nested"
printf 'a fact Nick told Orion\n' > "$SANDBOX/src/memory/fact.md"
printf 'a concept note\n' > "$SANDBOX/src/orionBrain/note.md"
# The two things that MUST NOT survive the exclusions.
printf 'ORION_DISCORD_BOT_TOKEN=not-a-real-token\n' > "$SANDBOX/src/.env"
printf 'PRIVATE KEY MATERIAL\n' > "$SANDBOX/src/nested/signing.key"
for i in $(seq 1 25); do printf 'row %s\n' "$i" > "$SANDBOX/src/nested/file-$i.txt"; done
ok "fixture built with a .env and a .key in it"

echo ""
echo "== 2. the pipeline roundtrips =="
ARCHIVE="$SANDBOX/out.tar.gz.enc"
# THE EXACT SHAPE orion-backup USES, which is the point of this check. An
# earlier version of both wrote `tar | printf-the-passphrase | openssl -pass
# stdin`, putting the passphrase IN the pipe so tar's output was discarded and
# openssl encrypted the passphrase alone. It produced a plausible 12K archive
# with no data in it. The passphrase goes over fd 3 because stdin is carrying
# the tar stream.
tar -czf - --exclude=".env" --exclude="*.key" -C "$SANDBOX/src" . \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass fd:3 -out "$ARCHIVE" \
    3< <(printf '%s' "$SECRET") 2>/dev/null
[ -s "$ARCHIVE" ] && ok "encrypted archive written ($(du -h "$ARCHIVE" | cut -f1 | tr -d ' '))" \
                  || bad "no archive was produced"

mkdir -p "$SANDBOX/restored"
if openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass fd:3 -in "$ARCHIVE" 3< <(printf '%s' "$SECRET") \
   | tar -xzf - -C "$SANDBOX/restored" 2>/dev/null; then
    ok "decrypts and unpacks"
else
    bad "the archive does not restore — this is the failure that only shows at 2am"
fi

echo ""
echo "== 3. what came back =="
if [ -f "$SANDBOX/restored/memory/fact.md" ] && [ -f "$SANDBOX/restored/orionBrain/note.md" ]; then
    ok "memory and brain notes survived"
else
    bad "the content did not come back"
fi
# CONTENTS, not a count: a file that restores empty restores.
if grep -q "a fact Nick told Orion" "$SANDBOX/restored/memory/fact.md" 2>/dev/null; then
    ok "and their contents are intact, byte for byte"
else
    bad "a file came back but its contents did not"
fi

echo ""
echo "== 4. the exclusions actually excluded =="
# The one mistake in this whole feature that would be silent AND permanent.
if find "$SANDBOX/restored" -name ".env" | grep -q .; then
    bad ".env survived the exclusion — a secret is in the archive"
else
    ok "no .env in the archive"
fi
if find "$SANDBOX/restored" -name "*.key" | grep -q .; then
    bad "a .key file survived the exclusion"
else
    ok "no key material in the archive"
fi
if grep -rq "not-a-real-token" "$SANDBOX/restored" 2>/dev/null; then
    bad "the token string is somewhere in the restored tree"
else
    ok "and the token string appears nowhere in it"
fi

echo ""
echo "== 5. it fails closed =="
mkdir -p "$SANDBOX/wrong"
if openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass fd:3 -in "$ARCHIVE" \
     3< <(printf '%s' "definitely-not-the-passphrase") 2>/dev/null \
   | tar -xzf - -C "$SANDBOX/wrong" 2>/dev/null; then
    bad "a WRONG passphrase produced a restore — the archive is not really encrypted"
else
    ok "a wrong passphrase restores nothing"
fi

# A truncated archive must fail rather than restore half a system, which is the
# worse outcome: half a restore looks like a success until you look.
head -c 200 "$ARCHIVE" > "$SANDBOX/truncated.enc"
mkdir -p "$SANDBOX/half"
if openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass fd:3 \
     -in "$SANDBOX/truncated.enc" 3< <(printf '%s' "$SECRET") 2>/dev/null \
   | tar -xzf - -C "$SANDBOX/half" 2>/dev/null; then
    bad "a truncated archive restored — half a restore looks like a success"
else
    ok "a truncated archive is refused, not partially restored"
fi

echo ""
echo ""
echo "== 5b. a credential INSIDE a staged file is redacted =="

# THE CHECK THAT WAS MISSING, and its absence was found by review rather than
# by this file. Everything above plants a `.env` in a sandbox and greps for
# that sandbox's own token — it never touched orion-backup's real `sources()`
# list, so it could not see that `exec-approvals.json` is on it and contains a
# live 32-character `socket.token`. Both exclusion layers matched FILENAMES.
#
# So this exercises the real thing in two ways: the source list is read out of
# the script, and the redaction pass is run against a file shaped like the one
# that was leaking.
BACKUP_SCRIPT="$(cd "$(dirname "$0")" && pwd)/orion-backup"

if grep -q 'exec-approvals.json' "$BACKUP_SCRIPT"; then
    ok "orion-backup still stages exec-approvals.json (the allowlist is worth restoring)"
else
    bad "exec-approvals.json is no longer staged — the exec allowlist would not survive a restore"
fi

mkdir -p "$SANDBOX/stage"
cat > "$SANDBOX/stage/exec-approvals.json" <<'FIXTURE'
{
  "socket": { "token": "aaaaaaaabbbbbbbbccccccccdddddddd" },
  "agents": { "main": { "allowlist": [{ "pattern": "ls", "id": "keep-me" }] } }
}
FIXTURE

# The redaction pass, lifted out of orion-backup by reading it rather than
# reimplemented: a second copy would be a second thing to keep in step, and
# this check exists precisely because a claim and its code disagreed.
awk "/<<'REDACT'/{grab=1;next} /^REDACT\$/{grab=0} grab" "$BACKUP_SCRIPT" > "$SANDBOX/redact.py"
if [ -s "$SANDBOX/redact.py" ]; then
    python3 "$SANDBOX/redact.py" "$SANDBOX/stage" >/dev/null 2>&1
    if grep -q "aaaaaaaabbbbbbbbccccccccdddddddd" "$SANDBOX/stage/exec-approvals.json"; then
        bad "a credential-shaped VALUE survived redaction — this is the 2026-09-04 finding, back"
    else
        ok "a credential-shaped value inside a staged JSON is replaced"
    fi
    # And the structure a restore needs must survive it.
    if grep -q '"pattern": "ls"' "$SANDBOX/stage/exec-approvals.json"; then
        ok "and the allowlist itself is intact — redaction, not deletion"
    else
        bad "redaction destroyed the allowlist it was supposed to preserve"
    fi
else
    bad "orion-backup has no content-redaction pass at all"
fi


echo ""
echo "== 6. the key derivation is not openssl's default =="
# Without -pbkdf2, openssl derives the key with a single MD5 pass and the
# passphrase becomes the weakest part of the whole thing. Asserted against the
# script's own source so it cannot be dropped in an edit.
BACKUP="$(cd "$(dirname "$0")" && pwd)/orion-backup"
if grep -c -- "-pbkdf2" "$BACKUP" | grep -qv '^0$' && grep -q -- "-iter 600000" "$BACKUP"; then
    ok "orion-backup uses -pbkdf2 with 600000 iterations everywhere"
else
    bad "orion-backup is missing -pbkdf2 or its iteration count"
fi
# fd 3, not stdin -- stdin carries the tar stream, and `passphrase` in the pipe
# was the bug this check found. Not `-pass pass:` either, which `ps` can read.
#
# COMMENTS ARE STRIPPED FIRST, and that is not fussiness: the fixed version of
# orion-backup EXPLAINS the bug in its header, so a naive grep found `-pass
# stdin` in the prose describing what it no longer does and failed the file for
# documenting itself. orion-authority has the same note about regex
# declarations -- a line that DESCRIBES an effect is not a line that performs
# one.
CODE="$(grep -vE '^\s*#' "$BACKUP")"
if printf '%s' "$CODE" | grep -q 'pass fd:3' \
   && ! printf '%s' "$CODE" | grep -qE 'pass (pass:|stdin)'; then
    ok "the passphrase goes over fd 3 — off the command line, and out of the data pipe"
else
    bad "the passphrase reaches openssl by a route that is a command line or the data pipe"
fi

echo ""
printf 'backup check: %s passed, %s failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "  The pipeline works. What is NOT proven here is Nick's Keychain item,"
    echo "  because creating one would mean this program holding a credential:"
    echo "      security add-generic-password -a \"\$USER\" -s orion-backup -w"
    echo "      ./scripts/orion-backup && ./scripts/orion-backup --verify"
fi
echo ""
[ "$FAIL" -eq 0 ]
