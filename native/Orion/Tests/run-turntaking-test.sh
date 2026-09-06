#!/bin/bash
#
# Turn-taking — adaptive endpointing (Fault 1, "he cuts me off") and the
# barge-in policy (Fault 2, "I can't cut him off"), plus the pure substate
# value type both are built on.
#
# Covers `Sources/Orion/AdaptiveEndpointModel.swift` and
# `Sources/Orion/TurnTakingState.swift`, compiled against the REAL sources —
# not copies — same discipline as run-watchdog-test.sh and run-progress-test.sh.
# Pure Foundation: no audio device, no network, no subprocess, so unlike the
# app itself this is safe to run anywhere, including over ssh.
#
#   ./Tests/run-turntaking-test.sh
#
# WHAT THIS PROVES: the endpointing verdict at 0.5/1.0/1.5/2.5s of silence,
# with and without a continuation cue; that a self-correcting (shrinking)
# transcript resets the clock instead of reading as silence; the continuation
# vocabulary and filler-word distinction; partial-transcript preservation and
# append; "continue what you were saying"; the barge-in policy across every
# phase and route; interruption at the start, middle and end of a reply; and
# 100 randomised simulated turns that all return to idle with a balanced
# open/close count on the (simulated) microphone.
#
# WHAT THIS DOES NOT PROVE: that AppState actually wires these decisions to a
# real microphone, a real Deepgram socket, or a real route change. That is
# audio hardware and needs Nick at a microphone — see the "needs Nick at a
# microphone" section of planning/v2/PHASE_VOICE_TURN_TAKING.md.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the turn-taking harness =="
swiftc -O \
  "$ROOT/Sources/Orion/AdaptiveEndpointModel.swift" \
  "$ROOT/Sources/Orion/TurnTakingState.swift" \
  "$HERE/TurnTakingHarness/main.swift" \
  -o "$BUILD/turntaking-harness" \
  || { echo "turn-taking harness failed to build"; exit 1; }

"$BUILD/turntaking-harness" "$@"
