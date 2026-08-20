#!/bin/zsh
#
# Does an update actually install, and does the app survive it?
#
# Signing a bundle correctly proves nothing about updating. The failures worth
# fearing all happen at install time and all look like something else:
#
#   · the update installs and every permission is gone, because the new bundle's
#     designated requirement differed from the old one
#   · the update is refused for reasons no user can read, because nested code
#     was signed in the wrong order
#   · the app relaunches into a version older than the one it replaced
#   · a tampered download installs anyway
#
# So this runs a REAL update against a REAL local feed: it builds a next
# version, signs it the way a release would, serves it over 127.0.0.1, points
# the installed app at that feed, and then checks what actually happened to the
# app on disk.
#
#   Tests/run-update-test.sh              the happy path, asserted
#   Tests/run-update-test.sh --tamper     corrupt the download; the update MUST be refused
#
# Exit 0 every assertion held · 1 an assertion failed · 2 the test could not run
#
emulate -L zsh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$(cd "$HERE/.." && pwd)"
INSTALLED="/Applications/Orion.app"
WORK="${TMPDIR:-/tmp}/orion-update-test"
PORT=8137
DOMAIN="com.nickmadaio.orion.app"

tamper=0
[[ "${1:-}" == "--tamper" ]] && tamper=1

pass=0; fail=0
ok()   { print -r -- "  ✓ $1"; (( pass++ )) }
bad()  { print -r -- "  ✗ $1"; (( fail++ )) }

cleanup() {
  [[ -n "${server_pid:-}" ]] && kill "$server_pid" 2>/dev/null
  defaults delete "$DOMAIN" orion.update.feedURL 2>/dev/null
  defaults delete "$DOMAIN" SULastCheckTime 2>/dev/null
  defaults delete "$DOMAIN" SUScheduledCheckInterval 2>/dev/null
}
trap cleanup EXIT INT TERM

# --- what we are updating FROM -----------------------------------------------

[[ -d "$INSTALLED" ]] || { print -r -- "no app at $INSTALLED — install one first"; exit 2 }

requirement_of() {
  codesign -d -r- "$1" 2>/dev/null | sed -n -e 's/^# *designated => //p' -e 's/^designated => //p'
}
version_of() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$1/Contents/Info.plist" 2>/dev/null
}
build_of() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$1/Contents/Info.plist" 2>/dev/null
}

before_req="$(requirement_of "$INSTALLED")"
before_version="$(version_of "$INSTALLED")"
before_build="$(build_of "$INSTALLED")"
next_build=$(( before_build + 1 ))
next_version="${before_version%.*}.$(( ${before_version##*.} + 1 ))"

print -r -- "Updating from $before_version (build $before_build) → $next_version (build $next_build)"
print -r -- ""

# --- build the update --------------------------------------------------------

rm -rf "$WORK"; mkdir -p "$WORK"
print -r -- "Building the next version…"
(
  cd "$APP_SRC" || exit 2
  ORION_VERSION="$next_version" \
  ORION_BUILD_NUMBER="$next_build" \
  ORION_BUNDLE_OUT="$WORK/Orion.app" \
  ./make_app_bundle.sh
) >"$WORK/build.log" 2>&1 || { print -r -- "build failed — see $WORK/build.log"; exit 2 }

# The gate a release would run. An update that changes identity is the one
# outcome worse than no update at all.
if [[ "$(requirement_of "$WORK/Orion.app")" == "$before_req" ]]; then
  ok "the update carries the same designated requirement as the installed app"
else
  bad "IDENTITY CHANGED — this update would wipe every permission"
  print -r -- "     was: $before_req"
  print -r -- "     now: $(requirement_of "$WORK/Orion.app")"
  exit 1
fi

# --- package and sign it like a release --------------------------------------

( cd "$WORK" && ditto -c -k --keepParent Orion.app "Orion-$next_version.zip" )
zip="$WORK/Orion-$next_version.zip"

signature="$("$APP_SRC/.build/artifacts/sparkle/Sparkle/bin/sign_update" "$zip" 2>/dev/null)"
[[ -n "$signature" ]] || { print -r -- "sign_update produced nothing"; exit 2 }

# sign_update prints: sparkle:edSignature="…" length="…"
ed_signature="${${signature#*edSignature=\"}%%\"*}"
length="${${signature#*length=\"}%%\"*}"

if (( tamper )); then
  # Corrupt the payload AFTER signing, and publish the signature of the
  # ORIGINAL. That is the real attack: a valid, correctly-formed signature for a
  # file somebody swapped underneath it. Corrupting before signing would only
  # prove Sparkle rejects malformed base64, which is not the interesting claim.
  #
  # The length stays the original too, since dd writes in place.
  printf 'MALICIOUS' | dd of="$zip" bs=1 seek=4096 conv=notrunc 2>/dev/null
  print -r -- "  (payload modified after signing — the signature no longer matches it)"
fi

cat > "$WORK/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Orion</title>
    <item>
      <title>Version $next_version</title>
      <pubDate>$(date -R)</pubDate>
      <sparkle:version>$next_build</sparkle:version>
      <sparkle:shortVersionString>$next_version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <description><![CDATA[<p>Update test build.</p>]]></description>
      <enclosure url="http://127.0.0.1:$PORT/Orion-$next_version.zip"
                 length="$length"
                 type="application/octet-stream"
                 sparkle:edSignature="$ed_signature" />
    </item>
  </channel>
</rss>
XML

# --- serve it ----------------------------------------------------------------

( cd "$WORK" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 ) >"$WORK/server.log" 2>&1 &
server_pid=$!
sleep 1
curl -sf "http://127.0.0.1:$PORT/appcast.xml" >/dev/null || { print -r -- "local feed did not come up"; exit 2 }

# --- point the app at it and let it check ------------------------------------

osascript -e 'tell application "Orion" to quit' 2>/dev/null; sleep 2; pkill -x Orion 2>/dev/null; sleep 1

defaults write "$DOMAIN" orion.update.feedURL -string "http://127.0.0.1:$PORT/appcast.xml"
# Due for a check the moment the updater starts.
defaults write "$DOMAIN" SUScheduledCheckInterval -int 60
defaults write "$DOMAIN" SULastCheckTime -date "2020-01-01 00:00:00 +0000"
defaults write "$DOMAIN" SUEnableAutomaticChecks -bool true
defaults write "$DOMAIN" SUAutomaticallyUpdate -bool true

marker="$(date +%s)"
open "$INSTALLED"

print -r -- "Waiting for the update to install (up to 3 minutes)…"
installed=0
for _ in {1..90}; do
  sleep 2
  if [[ "$(build_of "$INSTALLED")" == "$next_build" ]]; then installed=1; break; fi
done

# --- assertions --------------------------------------------------------------

print -r -- ""
if (( tamper )); then
  if (( installed )); then
    bad "A CORRUPTED UPDATE INSTALLED — signature checking is not working"
  else
    ok "the corrupted update was refused"
  fi
else
  if (( installed )); then
    ok "the update installed ($(version_of "$INSTALLED"), build $(build_of "$INSTALLED"))"
  else
    bad "the update never installed — see $WORK/server.log and the app log"
  fi

  if [[ "$(requirement_of "$INSTALLED")" == "$before_req" ]]; then
    ok "the installed app's identity is unchanged — permissions and secrets survive"
  else
    bad "the installed app's identity CHANGED"
  fi

  prompts="$(log show --start "@$marker" --predicate 'process == "SecurityAgent"' 2>/dev/null | grep -ci orion || true)"
  if [[ "${prompts:-0}" == "0" ]]; then
    ok "no Keychain or permission prompts appeared during the update"
  else
    bad "$prompts permission prompt(s) appeared"
  fi
fi

if pgrep -x Orion >/dev/null; then
  ok "the app is running afterwards"
else
  bad "the app is not running afterwards"
fi

print -r -- ""
print -r -- "$pass passed, $fail failed"
(( fail == 0 )) || exit 1
