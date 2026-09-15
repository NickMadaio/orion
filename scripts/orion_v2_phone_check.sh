#!/bin/bash
# Build and exercise the real phone shell. Simulator only; no account or grants.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [available-iPhone-simulator-UDID]" >&2
  exit 2
fi
simulator="${1:-}"
if [[ -z "$simulator" ]]; then
  simulator=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
phones=[d for devices in json.load(sys.stdin)["devices"].values() for d in devices if d.get("isAvailable") and d["name"].startswith("iPhone")]
phones.sort(key=lambda d: d["state"] != "Booted")
if not phones: sys.exit("No available iPhone Simulator; choose/install a runtime in Xcode.")
print(phones[0]["udid"])
')
fi
xcodebuild -project native/OrionMobile/OrionMobile.xcodeproj -scheme OrionPhone \
  -destination "platform=iOS Simulator,id=$simulator" \
  -derivedDataPath .builds/phone-shell-check \
  -skip-testing:OrionPhoneUITests/PhoneShellTests/testLocalReadRecoveryAndRevocation \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
