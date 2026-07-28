#!/bin/zsh
set -euo pipefail
swift build -c release
pushd ../OrionMacBridge >/dev/null
swift build -c release
popd >/dev/null
bundle=".build/Orion.app"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS"
cp .build/release/OrionCompanion "$bundle/Contents/MacOS/OrionCompanion"
# LoginItems is the conventional macOS location for a bundled helper app.
# Unlike a nested app in Resources, it remains intact when the outer app is
# copied into Applications.
helper="$bundle/Contents/Library/LoginItems/OrionMacBridge.app"
mkdir -p "$helper/Contents/MacOS"
cp ../OrionMacBridge/.build/release/orion-mac-bridge "$helper/Contents/MacOS/orion-mac-bridge"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>OrionCompanion</string>
  <key>CFBundleIdentifier</key><string>com.nickmadaio.orion.companion</string>
  <key>CFBundleName</key><string>Orion</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>NSCalendarsFullAccessUsageDescription</key><string>Orion uses your calendar only when you ask it to read your schedule or create an approved event.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>Orion uses your reminders only when you ask it to read or create an approved reminder.</string>
  <key>NSUserNotificationUsageDescription</key><string>Orion uses notifications for timers, reminders, and task updates you request.</string>
</dict></plist>
PLIST
cat > "$helper/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>orion-mac-bridge</string>
  <key>CFBundleIdentifier</key><string>com.nickmadaio.orion.nativebridge</string>
  <key>CFBundleName</key><string>Orion Native Bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$bundle"
echo "Built $bundle"
