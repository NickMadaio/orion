#!/bin/bash
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

echo "== building the focus UI render harness (${#sources[@]} sources) =="
swiftc -O $MODULE_FLAGS "${sources[@]}" "$HERE/FocusSessionHarness/main.swift" \
  -o "$BUILD/focus-ui-test" || exit 1

"$BUILD/focus-ui-test"
