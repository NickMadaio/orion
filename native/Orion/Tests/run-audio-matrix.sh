#!/bin/bash
#
# Gate 1 — the audio observation matrix.
#
# Answers one question with measurements instead of reasoning: does a running
# AVAudioEngine actually pin the shared output device to 24 kHz mono, as
# SpeechOutput.swift:50-64 asserts and as its 1.5 s releaseDevice timer is built
# to work around?
#
# A passing baseline is a valid result. If candidate A — the graph that ships
# today — holds the device steady with stereo playing and the microphone live,
# then the hypothesis is refuted, and the correct change is no change.
#
#   ./Tests/run-audio-matrix.sh                      all three candidates
#   ./Tests/run-audio-matrix.sh --candidate A        just the current graph
#   ./Tests/run-audio-matrix.sh --seconds 8          longer playback window
#   ./Tests/run-audio-matrix.sh --no-capture         skip the microphone
#   ./Tests/run-audio-matrix.sh --input-route builtin
#                                                     force capture onto the
#                                                     built-in mic instead of
#                                                     the system default,
#                                                     mirroring the fix in
#                                                     AudioInputRouteLease.
#                                                     Compare its OUTPUT
#                                                     column against a
#                                                     --input-route default
#                                                     run on the same Mac.
#
# IT MAKES NOISE, deliberately: a 440/880 Hz stereo pair and a voice-shaped tone.
# Run it with the speakers audible — the device numbers are the evidence, but
# "does this sound normal" is Nick's actual pass criterion and only he can
# answer it.
#
# Two limitations, stated rather than hidden:
#
#   1. Microphone access is attributed to the RESPONSIBLE process, which here is
#      the terminal, not Orion.app. If capture is not authorised the run says so
#      and does not test the wake-word half at all.
#   2. Without a loopback device this cannot record what actually reaches the
#      speakers, so "stereo stayed stereo" is measured as the device keeping two
#      output channels and its nominal rate, not by capturing the output.
#
# Exits non-zero if any candidate leaves the device degraded after it finishes.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/.build"
mkdir -p "$BUILD"

echo "== building the audio matrix =="
swiftc -O "$HERE/AudioMatrix/HALDevice.swift" "$HERE/AudioMatrix/main.swift" \
  -framework AVFoundation -framework CoreAudio \
  -o "$BUILD/audio-matrix" \
  || { echo "audio matrix failed to build"; exit 1; }

"$BUILD/audio-matrix" "$@"
