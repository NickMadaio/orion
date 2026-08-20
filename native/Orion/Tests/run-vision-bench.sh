#!/bin/bash
#
# How fast is Apple's Vision framework on this machine?
#
# Runs every request that could plausibly answer "is he resting or is he on his
# phone" against synthetic frames, and prints the latency. No camera is opened.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

swiftc -O "$HERE/VisionBench/main.swift" -o "$BUILD/vision-bench" \
  || { echo "vision bench failed to build"; exit 1; }

"$BUILD/vision-bench"
