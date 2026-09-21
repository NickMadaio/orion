#!/bin/bash
#
# Project agent panel: does it lay out, and does the live reasoning channel keep
# a viewport inside the dashboard's own ScrollView?
#
# The second one is the question with history. Nested same-axis scroll views
# leave the inner one unbounded, so it sizes to its whole content and cannot
# scroll — the defect behind "the task day-calendar view does not scroll
# correctly". The reasoning trace is capped at 6000 characters; unbounded, that
# is thousands of points of panel while a model thinks, with the controls pushed
# off the bottom.
#
# Measures rather than looks. Needs a GUI login session; shows no window, takes
# no screenshot, needs no screen-recording rights.
#
#   ./Tests/run-project-agent-ui.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

# The REAL app sources, minus main.swift whose @main would fight the harness's
# own top-level code. A harness with its own copy of the panel measures the copy.
sources=()
for file in "$ROOT"/Sources/Orion/*.swift; do
  [ "$(basename "$file")" = "main.swift" ] || sources+=("$file")
done

source "$HERE/build-modules.sh"

echo "== building the project agent UI harness (${#sources[@]} sources) =="
swiftc -O $MODULE_FLAGS "${sources[@]}" "$HERE/ProjectAgentHarness/main.swift" -o "$BUILD/project-agent-ui" \
  || { echo "project agent UI harness failed to build"; exit 1; }

"$BUILD/project-agent-ui"
