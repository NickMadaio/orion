#!/bin/bash
#
# Show the break sanctuary, full screen, without waiting out a focus block.
#
# Compiles the real view — not a copy of it — the same way the other GUI
# harnesses in this directory do, so what you are looking at is what ships.
#
#   Tests/run-break-preview.sh              ten minutes, guided breathing
#   Tests/run-break-preview.sh --short      the three-minute option
#   Tests/run-break-preview.sh --unguided   no breathing circle
#   Tests/run-break-preview.sh --window     windowed, for looking at it beside code
#   Tests/run-break-preview.sh --waves      waves instead of rain (also --wind, --silent)
#
# Escape quits. The real screen has no such key, which is the point of it.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

sources=()
for file in "$ROOT"/Sources/Orion/*.swift; do
  [ "$(basename "$file")" = "main.swift" ] || sources+=("$file")
done

source "$HERE/build-modules.sh"

echo "== building the break preview (${#sources[@]} sources) =="
swiftc -O $MODULE_FLAGS "${sources[@]}" "$HERE/BreakHarness/main.swift" -o "$BUILD/break-preview" \
  || { echo "break preview failed to build"; exit 1; }

"$BUILD/break-preview" "$@"
