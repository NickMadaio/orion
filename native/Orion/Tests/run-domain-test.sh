#!/bin/bash
#
# The pure session domain's tests — the suite that runs constantly.
#
# Why this wrapper exists rather than just typing `swift test`:
#
# `xcode-select -p` on this Mac points at /Library/Developer/CommandLineTools,
# which has a Swift compiler but NO XCTest. So `swift test` fails with
# "no such module 'XCTest'" even though Xcode is installed at /Applications.
# DEVELOPER_DIR overrides the active developer directory for one invocation,
# which gets the test frameworks without `sudo xcode-select -s` and without
# changing anything about how the rest of the machine builds.
#
# If Xcode is ever moved or removed, this fails with a clear message rather
# than the confusing missing-module error.
#
#   ./Tests/run-domain-test.sh              all domain tests
#   ./Tests/run-domain-test.sh --filter Clocks
#
# Note the OTHER harnesses in this directory — LayoutHarness, RaceHarness,
# AudioMatrix — are NOT part of this. They compile the real app sources with
# swiftc directly and have their own run-*.sh, because they need a GUI session,
# real audio hardware, or two live processes, none of which belong in a unit
# test. This script is only the pure domain.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

XCODE="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [ ! -d "$XCODE" ]; then
  echo "run-domain-test: no Xcode developer directory at $XCODE"
  echo ""
  echo "  The Command Line Tools alone do not ship XCTest, so the domain tests"
  echo "  cannot run without it. Install Xcode, or set DEVELOPER_DIR to a"
  echo "  developer directory that has the test frameworks."
  exit 2
fi

cd "$ROOT" || exit 2
DEVELOPER_DIR="$XCODE" swift test "$@"
