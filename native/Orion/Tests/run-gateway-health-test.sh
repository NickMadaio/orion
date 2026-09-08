#!/bin/bash
# Actual production probe + real loopback HTTP failures. No live services changed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" xcrun swiftc -O \
  "$ROOT/Sources/Orion/GatewayHealth.swift" "$HERE/GatewayHealthHarness/main.swift" \
  -o "$BUILD/gateway-health-harness"
"$BUILD/gateway-health-harness"
python3 "$HERE/GatewayHealthHarness/transport.py" "$BUILD/gateway-health-harness"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" xcrun swiftc -O \
  "$ROOT/Sources/Orion/GatewayHealth.swift" "$ROOT/Sources/Orion/MenuBarController.swift" \
  "$HERE/GatewayMenuHarness/main.swift" -o "$BUILD/gateway-menu-harness"
"$BUILD/gateway-menu-harness"
