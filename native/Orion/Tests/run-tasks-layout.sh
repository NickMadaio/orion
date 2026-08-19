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

echo "== building the Tasks layout render harness (${#sources[@]} sources) =="
swiftc $MODULE_FLAGS "${sources[@]}" "$HERE/TasksLayoutHarness/main.swift" \
  -o "$BUILD/tasks-layout-test" || exit 1

"$BUILD/tasks-layout-test"
