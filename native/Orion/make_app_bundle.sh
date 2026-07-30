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

# Ad-hoc signature with a fixed identifier. The identifier is what keeps the
# bundle recognisable across rebuilds; the signature itself still changes every
# time the binary does, so macOS may re-ask for permissions after a rebuild.
codesign --force --sign - --identifier com.nickmadaio.orion.app "$bundle"

echo "Built $bundle"
echo
echo "Run it:            open $(pwd)/$bundle"
echo "Install it:        cp -R $(pwd)/$bundle /Applications/"
echo
echo "First launch needs three permissions — see README.md:"
echo "  Accessibility        (Right Option push-to-talk, granted by hand)"
echo "  Microphone           (prompted on first press)"
echo "  Speech Recognition   (prompted on first press)"
