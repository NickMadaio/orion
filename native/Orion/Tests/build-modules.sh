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

build_module SessionDomain || exit 1
build_module SessionService -lSessionDomain || exit 1

MODULE_FLAGS="-I $MODULE_BUILD -L $MODULE_BUILD -lSessionDomain -lSessionService"
export MODULE_BUILD MODULE_FLAGS
