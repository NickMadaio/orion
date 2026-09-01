#!/bin/bash
# Build and self-check the mobile core, for macOS and -- when Xcode is present --
# for iOS.
#
# The iOS build is the point. MobileCore imports no platform framework, and that
# discipline is enforced by the compiler rather than by intention; building for
# the simulator on every run is what keeps it true. Phase 16 recorded exactly
# this as the thing to check first if Xcode ever arrived, and on 2026-08-25 it
# did: MobileCore compiled for iOS with NO source change, only a platforms line.
#
# XCODE IS INSTALLED BUT `xcode-select` POINTS AT CommandLineTools, so plain
# `xcodebuild` and `xcrun` fail. DEVELOPER_DIR overrides that per-command without
# sudo, which is why every Xcode invocation here sets it.
#
# MobileCoreCheck stays an executable rather than a test target BY CHOICE, not
# because testing is unavailable: XCTest works through the same DEVELOPER_DIR
# override (native/Orion/Tests/run-domain-test.sh runs 318 cases that way), and
# so does swift-testing. An executable additionally runs with Command Line Tools
# alone, and it is proven to exit non-zero. Converting it to a `swift test`
# target would be more consistent with native/Orion; it is optional.
#
# Read-only outside native/OrionMobile/.build.
set -uo pipefail

cd "$(dirname "$0")/../native/OrionMobile" || exit 2

XCODE_DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
DERIVED="${TMPDIR:-/tmp}/orion-mobile-ios-build"

echo "mobile check: building MobileCore for macOS"
if ! swift build 2>&1 | tail -2; then
    echo "mobile check: FAIL -- MobileCore does not compile for macOS"
    exit 1
fi

output=$(swift run MobileCoreCheck 2>&1)
status=$?
echo "$output" | tail -2
if [ $status -ne 0 ]; then
    echo "mobile check: FAIL -- the assertions did not pass"
    exit 1
fi

if [ -d "$XCODE_DEVELOPER_DIR" ]; then
    echo "mobile check: building MobileCore for the iOS simulator"
    if DEVELOPER_DIR="$XCODE_DEVELOPER_DIR" xcodebuild \
        -scheme MobileCore \
        -destination 'generic/platform=iOS Simulator' \
        -derivedDataPath "$DERIVED" \
        -quiet build 2>&1 | tail -3; then
        echo "mobile check: iOS build OK -- no platform framework crept in"
    else
        echo "mobile check: FAIL -- MobileCore no longer compiles for iOS."
        echo "  Something platform-specific was added; the compiler is the only guard."
        exit 1
    fi
else
    echo "mobile check: Xcode not found; skipped the iOS build (macOS only)"
fi

echo "mobile check: OK"
