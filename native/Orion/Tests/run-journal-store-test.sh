#!/bin/bash
#
# Phase 35 -- the journal store, against a real file.
#
#   ./Tests/run-journal-store-test.sh
#
# WHAT THIS PROVES: that a journal entry survives a round trip to disk with all
# five manifest fields intact; that a correction REPLACES rather than
# accumulates and keeps the original text; that an unreadable file reports an
# error rather than reporting zero entries. That last one matters more than it
# looks: Phase 36 reads this file, and "nothing to correlate" and "I could not
# look" must not collapse into the same answer.
#
# The extraction rules themselves are proven in MobileCoreCheck, which is where
# they live. This is only the part that can fail on disk.
#
# It writes to a temp directory via ORION_HEALTH_JOURNAL and never touches the
# real journal.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

MOBILE_ROOT="$ROOT/../OrionMobile"
(cd "$MOBILE_ROOT" && swift build --product MobileCore >/dev/null 2>&1) \
  || { echo "MobileCore failed to build"; exit 1; }

MODULES="$(find "$MOBILE_ROOT/.build" -type d -name Modules -path '*debug*' | head -1)"
OBJECTS="$(find "$MOBILE_ROOT/.build" -type f -name '*.swift.o' -path '*/debug/*' -path '*MobileCore.build*')"
[[ -n "$MODULES" && -n "$OBJECTS" ]] || { echo "could not locate MobileCore build products"; exit 1; }

# JournalStore imports SessionService for FileLock, so the real module has to be
# on the search path -- compiling FileLock.swift in alongside it would give two
# definitions of the same lock, which is precisely the drift the file's own
# header warns about.
(cd "$ROOT" && swift build >/dev/null 2>&1) || { echo "the Orion package failed to build"; exit 1; }
# Selected by CONTENT, not by name-and-head. Sparkle ships its own `Modules`
# directory under the same debug path, and `find ... -name Modules | head -1`
# picked that one -- which has no SessionService in it, so the harness failed
# with "no such module" while the module sat right next door.
APP_MODULES="$(dirname "$(find "$ROOT/.build" -name 'SessionService.swiftmodule' -path '*debug*' | head -1)")"
# Scoped to `debug/`. Without it this picks up the release objects too, and the
# link fails with 2,226 duplicate symbols -- the same module compiled twice.
SERVICE_OBJECTS="$(find "$ROOT/.build" -type f -name '*.swift.o' -path '*/debug/*' \
  \( -path '*SessionService.build*' -o -path '*SessionDomain.build*' \) )"
[[ -n "$APP_MODULES" ]] || { echo "could not locate the app's build products"; exit 1; }

echo "== building the journal store harness =="
# shellcheck disable=SC2086
swiftc -O \
  -I "$MODULES" -I "$APP_MODULES" $OBJECTS $SERVICE_OBJECTS \
  "$ROOT/Sources/Orion/JournalStore.swift" \
  "$HERE/JournalStoreHarness/main.swift" \
  -o "$BUILD/journal-store" \
  || { echo "journal store harness failed to build"; exit 1; }

"$BUILD/journal-store" "$@"
