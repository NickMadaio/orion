#!/bin/bash
#
# Build the library modules the app sources import, for harnesses that compile
# those sources directly with swiftc.
#
# The harnesses in this directory deliberately compile the REAL app sources
# rather than a copy — a harness with its own DayTimeline measures the copy, and
# a race harness with its own HealthLog proves nothing about the code that
# ships. That works fine for a flat pile of files, but the app now imports two
# library targets, and `import SessionDomain` is a hard error unless a module of
# that name exists on the search path.
#
# So: build them here, once, and let each harness add "$MODULE_BUILD" to its
# include and library paths.
#
# Source this rather than running it — it exports MODULE_BUILD and MODULE_FLAGS.
#
#   source "$HERE/build-modules.sh"
#   swiftc $MODULE_FLAGS "${sources[@]}" -o out
#
# Order matters: SessionService imports SessionDomain, so the domain is built
# first and the service is compiled against it.

MODULE_BUILD="${MODULE_BUILD:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.build/modules}"
mkdir -p "$MODULE_BUILD"

_modules_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

build_module() {
  local name="$1"; shift
  local sources=("$_modules_root/Sources/$name"/*.swift)

  # Skip the rebuild when nothing changed — these harnesses get run in a loop
  # while something is being debugged and a needless recompile each time is felt.
  local newest
  newest="$(ls -t "${sources[@]}" 2>/dev/null | head -1)"
  if [ -f "$MODULE_BUILD/$name.swiftmodule" ] \
     && [ "$MODULE_BUILD/$name.swiftmodule" -nt "$newest" ]; then
    return 0
  fi

  swiftc -emit-module -emit-library \
    -module-name "$name" \
    -I "$MODULE_BUILD" -L "$MODULE_BUILD" "$@" \
    -emit-module-path "$MODULE_BUILD/$name.swiftmodule" \
    -o "$MODULE_BUILD/lib$name.dylib" \
    "${sources[@]}" \
    || { echo "failed to build module $name"; return 1; }
}

# MobileCore lives in the SIBLING package, OrionMobile, and SessionService began
# importing it. Same failure as the Sparkle one described below, same fix: every
# GUI harness in this directory stopped building with "no such module
# 'MobileCore'" pointing at TodayPlanStore.swift, a file none of them care
# about. Built first because SessionService compiles against it.
_mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../OrionMobile" && pwd)"
build_external_module() {
  local name="$1" root="$2"; shift 2
  local sources=("$root/Sources/$name"/*.swift)
  local newest
  newest="$(ls -t "${sources[@]}" 2>/dev/null | head -1)"
  if [ -f "$MODULE_BUILD/$name.swiftmodule" ] \
     && [ "$MODULE_BUILD/$name.swiftmodule" -nt "$newest" ]; then
    return 0
  fi
  swiftc -emit-module -emit-library \
    -module-name "$name" \
    -I "$MODULE_BUILD" -L "$MODULE_BUILD" "$@" \
    -emit-module-path "$MODULE_BUILD/$name.swiftmodule" \
    -o "$MODULE_BUILD/lib$name.dylib" \
    "${sources[@]}" \
    || { echo "failed to build module $name"; return 1; }
}

build_external_module MobileCore "$_mobile_root" || exit 1
build_module SessionDomain || exit 1
build_module SessionService -lSessionDomain -lMobileCore || exit 1

# Sparkle, for the harnesses.
#
# These harnesses compile the app's real sources with swiftc rather than through
# SwiftPM, so they see none of the package's dependencies. The moment the app
# gained `import Sparkle`, every GUI harness in this directory stopped building
# — layout, focus-ui, tasks-layout, audio-matrix, all of them — with a "no such
# module" error pointing at a file none of them care about.
#
# Pointing at the artifact SwiftPM already resolved keeps one copy of the
# framework and no second download. If it is missing the harnesses still build
# everything else and say what to run, rather than failing with a module error
# that reads like the harness itself is broken.
SPARKLE_FRAMEWORK_DIR="$(dirname "$(find "$_modules_root/.build/artifacts" -type d -name 'Sparkle.framework' 2>/dev/null | head -1)")"

if [ -n "$SPARKLE_FRAMEWORK_DIR" ] && [ -d "$SPARKLE_FRAMEWORK_DIR" ]; then
  SPARKLE_FLAGS="-F $SPARKLE_FRAMEWORK_DIR -framework Sparkle -Xlinker -rpath -Xlinker $SPARKLE_FRAMEWORK_DIR"
else
  SPARKLE_FLAGS=""
  echo "  (no Sparkle artifact found — run: swift package resolve)" >&2
fi

# -lMobileCore too: the app links it transitively through SessionService, and
# without it every harness compiles and then fails at the linker on
# "type metadata accessor for MobileCore.TodayPlan".
MODULE_FLAGS="-I $MODULE_BUILD -L $MODULE_BUILD -lSessionDomain -lSessionService -lMobileCore $SPARKLE_FLAGS"
export MODULE_BUILD MODULE_FLAGS
