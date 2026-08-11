#!/bin/bash
#
# Day-timeline layout test: does the timeline have a scroll viewport, and does
# it open where you are rather than at midnight?
#
# Nick reported "the task day-calendar view does not scroll correctly". The cause
# is nested same-axis ScrollViews — DashboardView wraps every tab in one, and
# DayTimeline has its own inside it — which leaves the inner view proposed an
# unbounded height. It grows to its full 24-hour content, its frame equals its
# content, and a scroll view with no spare content does not scroll: the wheel
# goes to the dashboard page behind it instead.
#
# That is a measurable defect, so this measures it rather than looking at it. It
# lays the real DayTimeline out in a real NSHostingView, bounded and unbounded,
# and compares the heights. It needs a GUI login session but never shows a
# window, takes no screenshot, and needs no screen-recording rights — which is
# what makes it usable here at all, since Orion is an LSUIElement agent that
# neither the screenshot API nor the automation allowlist can see.
#
#   ./Tests/run-layout-test.sh
#
# Exits non-zero if the timeline has no viewport or opens in the wrong place.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

# Every app source except main.swift, whose @main would fight the harness's own
# top-level code. Compiling the real sources is the point: a harness with its own
# copy of DayTimeline would measure the copy.
sources=()
for file in "$ROOT"/Sources/Orion/*.swift; do
  [ "$(basename "$file")" = "main.swift" ] || sources+=("$file")
done

echo "== building the layout harness (${#sources[@]} sources) =="
swiftc -O "${sources[@]}" "$HERE/LayoutHarness/main.swift" -o "$BUILD/layout-test" \
  || { echo "layout harness failed to build"; exit 1; }

"$BUILD/layout-test"
