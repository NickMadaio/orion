#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

# Orion must run from a real .app bundle, not from .build/release/Orion.
# macOS attaches microphone, speech-recognition and accessibility permissions to
# a bundle identity; a bare executable gets asked for nothing and silently does
# nothing. Same reason OrionCompanion builds a bundle.

swift build -c release

bundle=".build/Orion.app"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS"
mkdir -p "$bundle/Contents/Resources"

cp .build/release/Orion "$bundle/Contents/MacOS/Orion"
cp Resources/Info.plist "$bundle/Contents/Info.plist"
printf 'APPL????' > "$bundle/Contents/PkgInfo"

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
identity_hash="$(security find-identity -v -p codesigning 2>/dev/null \
                 | grep "$identity" | tail -1 | awk '{print $2}')"

if [[ -n "$identity_hash" ]]; then
  # `--options runtime` (hardened runtime) requires entitlements for device
  # access. Without com.apple.security.device.audio-input the microphone is
  # denied outright — no prompt, no row in System Settings, and
  # authorizationStatus reports .denied for something the user was never asked.
  # Turning the hardened runtime on without the entitlements is what broke
  # push-to-talk after the signing change.
  codesign --force --sign "$identity_hash" --identifier com.nickmadaio.orion.app \
           --options runtime \
           --entitlements Resources/Orion.entitlements \
           "$bundle"
  signed="stable identity ($identity, ${identity_hash:0:8}…) + entitlements"
else
  codesign --force --sign - --identifier com.nickmadaio.orion.app "$bundle"
  signed="AD-HOC — macOS will treat the next rebuild as a different app"
fi

echo "Built $bundle"
echo "Signed:  $signed"
echo
echo "Run it:            open $(pwd)/$bundle"
echo "Install it:        cp -R $(pwd)/$bundle /Applications/"
echo

if [[ "$signed" == AD-HOC* ]]; then
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
