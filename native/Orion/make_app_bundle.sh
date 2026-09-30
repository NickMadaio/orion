#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

# Orion must run from a real .app bundle, not from .build/release/Orion.
# macOS attaches microphone, speech-recognition and accessibility permissions to
# a bundle identity; a bare executable gets asked for nothing and silently does
# nothing. Same reason OrionCompanion builds a bundle.

# --allow-adhoc is the ONLY way to get an unsigned build, and it has to be typed.
# See the signing block below for why a silent fallback is the dangerous case.
allow_adhoc=0
for arg in "$@"; do
  case "$arg" in
    --allow-adhoc) allow_adhoc=1 ;;
    *) print -r -- "make_app_bundle: unknown argument $arg" >&2; exit 2 ;;
  esac
done

swift build -c release

bundle="${ORION_BUNDLE_OUT:-.build/Orion.app}"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS"
mkdir -p "$bundle/Contents/Resources"

cp .build/release/Orion "$bundle/Contents/MacOS/Orion"
cp Resources/Info.plist "$bundle/Contents/Info.plist"
printf 'APPL????' > "$bundle/Contents/PkgInfo"

# The phone link (CloudKit) rides inside Orion as a login-item helper,
# Contents/Library/LoginItems/ORION Link.app. It is signed by Nick's developer
# team (CloudKit needs that) BEFORE Orion is signed, and Orion's signature seals
# it without re-signing it -- so Orion keeps its own identity and every
# permission it holds. See native/OrionLink/App/OrionLinkApp.swift.
link_dd="${ORION_LINK_DERIVED:-$PWD/.build/orion-link-dd}"
if DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" \
   xcodebuild -project ../OrionLink/OrionLink.xcodeproj -scheme OrionLink -configuration Release \
     -destination 'platform=macOS' -derivedDataPath "$link_dd" -allowProvisioningUpdates -quiet build >/dev/null 2>"$link_dd.log"; then
  mkdir -p "$bundle/Contents/Library/LoginItems"
  ditto "$link_dd/Build/Products/Release/ORION Link.app" "$bundle/Contents/Library/LoginItems/ORION Link.app"
  codesign --verify --strict "$bundle/Contents/Library/LoginItems/ORION Link.app" \
    || { print -r -- "✗ the embedded phone-link helper is not validly signed" >&2; exit 3 }
  link_state="phone link embedded"
else
  print -r -- "⚠︎ the phone-link helper did not build (see $link_dd.log); Orion is built without it" >&2
  link_state="phone link NOT embedded"
fi

# Version, stamped at bundle time rather than committed into Info.plist.
#
# Both numbers had been frozen at 1.0 / 1 since the first build, which does not
# matter at all until something has to answer "is this newer than what is
# installed?" — and then it is the only thing that matters. An updater compares
# CFBundleVersion and nothing else; a build that never moves it can never be
# offered as an update, and worse, cannot be told apart from the one it replaces.
#
#   CFBundleShortVersionString — VERSION, what a human reads. Semantic, by hand.
#   CFBundleVersion            — the commit count, which only ever goes up.
#
# The commit count rather than a hand-maintained integer because a number you
# have to remember to bump is a number that eventually ships twice. It is
# monotonic as long as history is not rewritten, which is worth knowing before
# anybody reaches for a rebase on a released commit.
# Both overridable, for exactly two callers: the release script, which owns the
# real numbers, and the update test, which has to build a plausible "next
# version" without inventing a commit to get one.
short_version="${ORION_VERSION:-$(cat VERSION 2>/dev/null || print -r -- '0.0.0')}"
build_number="${ORION_BUILD_NUMBER:-$(git -C "$(pwd)" rev-list --count HEAD 2>/dev/null || true)}"
if [[ -z "$build_number" ]]; then
  # Not a git checkout — a source tarball, say. Fall back to something that
  # still rises, rather than to a constant that would make every build look
  # identical to every other.
  build_number="$(date +%Y%m%d%H%M)"
  print -r -- "  (no git history — using a timestamp build number: $build_number)"
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $short_version" \
                        "$bundle/Contents/Info.plist" >/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" \
                        "$bundle/Contents/Info.plist" >/dev/null

# Sparkle, embedded by hand.
#
# SwiftPM links the framework but does not assemble an app bundle, so nothing
# copies it in — the app builds perfectly and then dies at launch with "Library
# not loaded: @rpath/Sparkle.framework". The rpath has to be added here too, and
# BEFORE signing: `install_name_tool` rewrites the executable, which invalidates
# any signature already on it.
sparkle_framework="$(find .build/artifacts/sparkle -type d -name 'Sparkle.framework' 2>/dev/null | head -1)"
if [[ -z "$sparkle_framework" ]]; then
  print -r -- "✗ Sparkle.framework not found — run: swift package resolve" >&2
  exit 3
fi

mkdir -p "$bundle/Contents/Frameworks"
# ditto rather than cp: a framework is a symlink farm (Versions/Current, and the
# top-level entries pointing into it), and flattening those makes a bundle that
# signs but will not load.
ditto "$sparkle_framework" "$bundle/Contents/Frameworks/Sparkle.framework"

if ! otool -l "$bundle/Contents/MacOS/Orion" | grep -q "@executable_path/../Frameworks"; then
  install_name_tool -add_rpath "@executable_path/../Frameworks" \
                    "$bundle/Contents/MacOS/Orion" 2>/dev/null || true
fi

# Icon. `Orion.iconset` is rendered from the same geometry as the live
# hologram by scripts/orion_make_icon.py; `iconutil` is macOS-only, so the
# iconset is what gets committed and the .icns is assembled here.
if [[ -d Resources/Orion.iconset ]]; then
  iconutil -c icns Resources/Orion.iconset -o Resources/Orion.icns 2>/dev/null || true
fi
if [[ -f Resources/Orion.icns ]]; then
  cp Resources/Orion.icns "$bundle/Contents/Resources/Orion.icns"
else
  echo "  (no icon — run: python3 ../../scripts/orion_make_icon.py)"
fi

# Signing.
#
# Prefer a real signing identity over an ad-hoc signature. This is not
# ceremony: an ad-hoc signature carries no identity, so macOS identifies the app
# by its cdhash, which changes on every rebuild. TCC then treats each build as a
# different application — you get duplicate "Orion" rows in Privacy settings and
# push-to-talk silently stops working after every rebuild, because the grant is
# still attached to the previous binary.
#
# A self-signed certificate fixes it: TCC keys on the certificate, which is
# stable. Create one once with ../../scripts/orion-sign-setup.
identity="Orion Local Signing"

# Resolve to the identity's SHA-1 rather than its name.
#
# Several certificates can share a name — this Mac has six "Orion Local
# Signing" certs, five of them failed scripted imports that were never trusted.
# `codesign -s <name>` against duplicates is ambiguous: it errors, or worse,
# picks an untrusted one and silently produces a signature that TCC will not
# honour.
#
# `find-identity -v -p codesigning` lists only identities VALID for code
# signing, newest last, and its hash is unambiguous. So: take the last valid
# match by name and sign with its hash.
#
# The `|| true` is load-bearing. This file runs under `set -euo pipefail`, and
# `grep` exits 1 when it matches nothing — so with no identity installed the
# script died right here, exit 1, in silence. Every careful message below about
# ad-hoc signing was unreachable: the one situation they exist for was the one
# situation that killed the script before it could print them.
identity_hash="$(security find-identity -v -p codesigning 2>/dev/null \
                 | grep "$identity" | tail -1 | awk '{print $2}' || true)"

# How long that certificate has left.
#
# This is a time bomb with a date on it. Every TCC grant and every Keychain ACL
# is bound to this exact certificate — the designated requirement reads
# `identifier "com.nickmadaio.orion.app" and certificate leaf = H"..."`. The day
# it expires, `find-identity -v` stops listing it, the build falls through to
# ad-hoc, and microphone, accessibility, speech and every stored token break at
# once. Nothing about that failure points at a certificate, so it is worth
# saying out loud months in advance.
days_left=""
# Everything inside the bundle that is itself code, innermost first.
#
# Signing order is not a style choice. Signing the app seals a hash of its
# contents, so anything signed AFTERWARDS invalidates the seal — the app fails
# `codesign --verify --deep --strict`, and Sparkle refuses to install an update
# it cannot validate. Sparkle ships four pieces of nested code and every one of
# them has to be signed before the framework, which has to be signed before the
# app.
sign_nested() {
  local fw="$bundle/Contents/Frameworks/Sparkle.framework"
  [[ -d "$fw" ]] || return 0
  local nested
  for nested in \
    "$fw/Versions/B/XPCServices/Downloader.xpc" \
    "$fw/Versions/B/XPCServices/Installer.xpc" \
    "$fw/Versions/B/Updater.app" \
    "$fw/Versions/B/Autoupdate"
  do
    [[ -e "$nested" ]] || continue
    # No --identifier: each helper keeps its own, which is what Sparkle's XPC
    # lookups expect. No --entitlements either; the microphone and speech
    # entitlements belong to the app, and handing them to an updater would be
    # granting capabilities nothing in it needs.
    codesign --force "${sign_args[@]}" "$nested" || return 1
  done
  codesign --force "${sign_args[@]}" "$fw/Versions/B" || return 1
  codesign --force "${sign_args[@]}" "$fw" || return 1
}

if [[ -n "$identity_hash" ]]; then
  # Same reason as above: the helper exits 1 when it cannot find the
  # certificate, and an unknown expiry must not be a failed build.
  days_left="$(security find-certificate -a -Z -p 2>/dev/null \
               | python3 "$(dirname "$0")/../../scripts/lib/cert_days_left.py" "$identity_hash" 2>/dev/null || true)"
fi

if [[ -n "$days_left" ]] && (( days_left < 0 )); then
  cat >&2 <<EXPIRED

✗  The "$identity" certificate EXPIRED $(( -days_left )) day(s) ago.

   Building now would sign ad-hoc, and macOS would treat this as a different
   application: microphone, accessibility and speech grants all reset, and every
   stored token becomes unreadable.

   Make a new certificate:   scripts/orion-sign-setup
   Then expect to grant the three permissions once more — a new certificate is
   a new identity, and that reset is unavoidable rather than a bug.

EXPIRED
  exit 3
fi

if [[ -n "$identity_hash" ]]; then
  # `--options runtime` (hardened runtime) requires entitlements for device
  # access. Without com.apple.security.device.audio-input the microphone is
  # denied outright — no prompt, no row in System Settings, and
  # authorizationStatus reports .denied for something the user was never asked.
  # Turning the hardened runtime on without the entitlements is what broke
  # push-to-talk after the signing change.
  sign_args=(--sign "$identity_hash" --options runtime --timestamp=none)
  sign_nested || { print -r -- "✗ could not sign Sparkle's nested code" >&2; exit 3 }
  codesign --force --sign "$identity_hash" --identifier com.nickmadaio.orion.app \
           --options runtime \
           --entitlements Resources/Orion.entitlements \
           "$bundle"
  signed="stable identity ($identity, ${identity_hash:0:8}…) + entitlements"
elif (( allow_adhoc )); then
  sign_args=(--sign -)
  sign_nested || { print -r -- "✗ could not sign Sparkle's nested code" >&2; exit 3 }
  codesign --force --sign - --identifier com.nickmadaio.orion.app "$bundle"
  signed="AD-HOC (you asked for it) — macOS will treat the next rebuild as a different app"
else
  # This used to warn and carry on, and that was the wrong call.
  #
  # A warning at the end of a successful build is read as a successful build.
  # The damage is not visible until the next launch, when push-to-talk silently
  # does nothing and a second "Orion" appears in Privacy & Security — by which
  # point the cause is several steps back. An unsigned build is not a slightly
  # worse build; it is a different application wearing the same name.
  cat >&2 <<'UNSIGNED'

✗  No valid "Orion Local Signing" identity — refusing to build ad-hoc.

   Ad-hoc signing has no stable identity, so macOS identifies the app by a hash
   that changes on every build. Every permission and every stored secret is
   attached to the identity, so an ad-hoc build silently loses all of them.

   Fix it once:            scripts/orion-sign-setup
   Check what is there:    security find-identity -v -p codesigning

   If you genuinely want a throwaway unsigned build:

     ./make_app_bundle.sh --allow-adhoc

UNSIGNED
  exit 3
fi

if [[ -n "$days_left" ]] && (( days_left < 90 )); then
  print -r -- "" >&2
  print -r -- "⚠  The signing certificate expires in $days_left day(s)." >&2
  print -r -- "   When it does, builds stop and every permission resets. Renew before then:" >&2
  print -r -- "   scripts/orion-sign-setup" >&2
  print -r -- "" >&2
fi

# The seal, checked rather than assumed.
#
# `--deep --strict` walks every nested piece of code. This is the check that
# catches a signing-order mistake at build time instead of at install time, when
# the symptom is Sparkle refusing an update for reasons nobody can read.
if ! codesign --verify --deep --strict --verbose=1 "$bundle" 2>/dev/null; then
  print -r -- "" >&2
  print -r -- "✗ The bundle does not verify. Its nested code is signed in the wrong" >&2
  print -r -- "  order or not at all, and updates would be refused. Details:" >&2
  codesign --verify --deep --strict --verbose=2 "$bundle" >&2 || true
  exit 3
fi

echo "Built $bundle  ($short_version, build $build_number)"
echo "Signed:  $signed"
echo "Phone:   ${link_state:-phone link NOT embedded}"
echo
echo "Run it:            open $(pwd)/$bundle"
echo "Install it:        cp -R $(pwd)/$bundle /Applications/"
echo

if [[ "$signed" == AD-HOC* ]] && (( allow_adhoc )); then
  cat <<'WARN'
⚠  Ad-hoc signed. If push-to-talk works now but stops after your next build,
   or you see more than one "Orion" in Privacy & Security → Accessibility,
   that is this. Fix it once:

     ../../scripts/orion-sign-setup

   Then remove every existing "Orion" row in Accessibility and rebuild.

WARN
fi

echo "First launch needs three permissions — see README.md:"
echo "  Accessibility        (Right Option push-to-talk, granted by hand)"
echo "  Microphone           (prompted on first press)"
echo "  Speech Recognition   (prompted on first press)"
echo
echo "Check everything:    ../../scripts/orion-doctor"
