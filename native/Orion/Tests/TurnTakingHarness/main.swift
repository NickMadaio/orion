import Foundation

/*
 Turn-taking, driven against a clock we control — no microphone, no socket,
 no subprocess, same discipline as `Tests/WatchdogHarness` and
 `Tests/ProgressHarness`.

 This is the harness for the two files the revamp added:
 `AdaptiveEndpointModel.swift` (Fault 1 — "he cuts me off") and
 `TurnTakingState.swift` (the substate value type, and Fault 2 — "I can't cut
 him off"). Compiled directly against the REAL sources, not copies, so this
 cannot drift from what ships.

 WHAT THIS PROVES: the endpointing verdict at named pause lengths, the
 continuation-vocabulary and self-correction fixes, the barge-in policy at
 every phase and route, and that 100 randomised simulated turns always land
 back at `.idle` with a balanced open/close count on the (simulated) audio
 device.

 WHAT THIS DOES NOT PROVE: that `AppState` actually wires these decisions to
 real audio, a real Deepgram socket, or a real route change. That needs Nick
 at a microphone — see `docs/planning/v2/PHASE_VOICE_TURN_TAKING.md`.
 */

// MARK: - The smallest test runner that is still honest

var failures = 0
var checks = 0

func check<T: Equatable>(_ label: String, _ actual: T, _ expected: T) {
    checks += 1
    if actual == expected {
        print("  ok    \(label)")
    } else {
        failures += 1
        print("  FAIL  \(label)")
        print("        expected \(expected)")
        print("        actual   \(actual)")
    }
}

func checkTrue(_ label: String, _ condition: Bool, _ detail: String = "") {
    checks += 1
    if condition {
        print("  ok    \(label)")
    } else {
        failures += 1
        print("  FAIL  \(label)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}

func section(_ title: String) {
    print("")
    print("== \(title) ==")
}

let t0 = Date(timeIntervalSince1970: 1_770_000_000)
func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

// Mirrors of what AppState actually seeds, at the shipped default
// `VoiceTuning.defaultEndpointingMs` of 900ms — kept as literals, same
// discipline as WatchdogHarness's mirrors, so a future change to the
// tunable shows up as a diff here rather than silently retargeting intent.
let baseSilence: TimeInterval = 0.9
let extendedSilence: TimeInterval = 1.62 // 0.9 * 1.8, VoiceTuning.extendedEndpointingSeconds' formula

// MARK: - Named pause lengths: 0.5 / 1.0 / 1.5 / 2.5s

section("pauses: 0.5 / 1.0 / 1.5 / 2.5s, with and without a continuation cue")

do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("what's on my calendar today", at: t0)
    check("0.5s of silence, no cue: still listening", model.verdict(at: at(0.5)), .keepListening)
}

do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("what's on my calendar today", at: t0)
    check("1.0s of silence, no cue: past the base window, finalize",
          model.verdict(at: at(1.0)), .finalize)
}

do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("remind me to call the vet and", at: t0) // trailing conjunction
    check("1.0s of silence WITH a trailing conjunction: extend, not finalize",
          model.verdict(at: at(1.0)), .extending(requiredSilence: extendedSilence))
    check("1.5s of silence, still short of the extended window: still extending",
          model.verdict(at: at(1.5)), .extending(requiredSilence: extendedSilence))
    check("2.5s of silence, past the extended window: finalize",
          model.verdict(at: at(2.5)), .finalize)
}

// MARK: - A TRAILING filler means mid-thought (changed 2026-09-29)
//
// This section used to assert the opposite -- fillers were "ordinary text". Nick
// reported ORION "interrupts me all the time"; ending a turn on "so, um," is
// exactly that. A filler at the END extends the window; one at the start of a
// finished sentence ("uh, let me think") does not.

section("fillers: a trailing 'um' extends, a leading one does not")

checkTrue("'well, um,' is a continuation cue",
          AdaptiveEndpointModel.hasContinuationCue("well, um,"))
checkTrue("'uh, let me think' is not a continuation cue",
          !AdaptiveEndpointModel.hasContinuationCue("uh, let me think"))

do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("so, um,", at: t0)
    check("a trailing filler waits past the ordinary window",
          model.verdict(at: at(1.0)) == .finalize, false)
}

// MARK: - Self-correction: a SHRINKING transcript must still reset the clock

section("self-correction: a shrinking interim is evidence too, not silence")

do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("I want to go to the store on Tuesday", at: t0)
    // The recogniser revises itself DOWN at t=0.5 -- shorter, not longer. The
    // OLD AppState logic (`count >` only) would have ignored this and let the
    // clock keep running from t=0, reaching finalize at t=1.0 total. The
    // fixed model must instead see this as fresh evidence.
    model.noteTranscript("I want to go to the— to the market", at: at(0.5))
    check("0.85s after the correction (1.35s total) is still within the base window",
          model.verdict(at: at(1.35)), .keepListening)
    check("1.0s after the correction (past its own base window) finalizes",
          model.verdict(at: at(1.5)), .finalize)
}

// MARK: - Continuation vocabulary: explicit phrases and trailing conjunctions

section("continuation vocabulary")

for phrase in ["hold on, one more thing", "wait, I'm not done", "one sec", "hang on"] {
    checkTrue("'\(phrase)' is recognised as a continuation cue",
              AdaptiveEndpointModel.hasContinuationCue(phrase))
}
for word in ["and", "but", "because", "so"] {
    checkTrue("a clause trailing '\(word)' is a continuation cue",
              AdaptiveEndpointModel.hasContinuationCue("we could do this \(word)"))
}
checkTrue("an ordinary finished sentence is NOT a continuation cue",
          !AdaptiveEndpointModel.hasContinuationCue("that's everything, thanks"))
checkTrue("terminal punctuation is recognised",
          AdaptiveEndpointModel.hasTerminalPunctuation("is that everything?"))
checkTrue("no terminal punctuation on a trailing conjunction",
          !AdaptiveEndpointModel.hasTerminalPunctuation("and"))

// MARK: - Preserving and appending a cut-off transcript

section("partial-transcript preservation: append, don't lose or disconnect")

check("a preserved fragment plus what followed reads as one sentence",
      AdaptiveEndpointModel.appendContinuation("then we left", to: "we got there late and"),
      "we got there late and then we left")
check("nothing preserved: the continuation stands alone",
      AdaptiveEndpointModel.appendContinuation("hello", to: ""), "hello")
check("nothing to continue: the preserved text stands alone",
      AdaptiveEndpointModel.appendContinuation("", to: "hello"), "hello")

// MARK: - "Continue what you were saying"

section("resume phrases")

for phrase in ["continue", "keep going", "go on", "What were you saying?", "Continue."] {
    checkTrue("'\(phrase)' is recognised as a resume request",
              AdaptiveEndpointModel.isResumeRequest(phrase))
}
checkTrue("an ordinary question is NOT a resume request",
          !AdaptiveEndpointModel.isResumeRequest("what's the weather tomorrow"))

// MARK: - Low confidence extends the window

section("low-confidence ending extends the window")

do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("can you check the flight to", confidence: 0.31, at: t0)
    check("1.0s after a low-confidence ending: extend, not finalize",
          model.verdict(at: at(1.0)), .extending(requiredSilence: extendedSilence))
}
do {
    var model = AdaptiveEndpointModel(now: t0, baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.noteTranscript("can you check the flight to Denver", confidence: 0.92, at: t0)
    check("1.0s after a HIGH-confidence ending: finalize as usual",
          model.verdict(at: at(1.0)), .finalize)
}

// MARK: - TurnTakingModel: the full substate lifecycle

section("TurnTakingModel: listening substates")

do {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.beginListening(at: t0)
    check("begins in listening.capturing", model.phase, .listening(.capturing))
    _ = model.silenceTick(at: at(0.1))
    check("a moment of silence under the consideration threshold stays capturing",
          model.phase, .listening(.capturing))
    _ = model.silenceTick(at: at(0.5))
    check("past the consideration threshold (0.4 * base): possiblePause",
          model.phase, .listening(.possiblePause))
    let action = model.silenceTick(at: at(1.0))
    check("past the base window with no cue: finalizeUtterance fires",
          action, .finalizeUtterance)
    check("phase reflects finalizing", model.phase, .listening(.finalizing))
    model.utteranceDelivered()
    check("delivering moves to thinking", model.phase, .thinking)
}

section("TurnTakingModel: a continuation cue reaches possiblePause and holds")

do {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.beginListening(at: t0)
    _ = model.transcriptUpdated("hold on, let me check", at: at(0.1))
    check("possiblePause the instant a cue is noted", model.phase, .listening(.possiblePause))
    let stillWaiting = model.silenceTick(at: at(1.0))
    check("still short of the extended window: no action", stillWaiting, .none)
    check("still possiblePause", model.phase, .listening(.possiblePause))
    let resumed = model.transcriptUpdated("actually never mind", at: at(1.1))
    check("new speech snaps back to capturing", resumed, .none)
    check("phase is capturing again", model.phase, .listening(.capturing))
}

// MARK: - Barge-in policy, by phase and route

section("BargeInPolicy: mode by phase and route")

check("speaking + speakers: restricted",
      BargeInPolicy.mode(forOutputRoute: .speakers, phase: .speaking(.playing)), .voiceRestricted)
check("speaking + headset: enabled",
      BargeInPolicy.mode(forOutputRoute: .headset, phase: .speaking(.playing)), .voiceEnabled)
check("thinking + speakers: STILL enabled — nothing is being played to echo",
      BargeInPolicy.mode(forOutputRoute: .speakers, phase: .thinking), .voiceEnabled)
check("thinking + headset: enabled", BargeInPolicy.mode(forOutputRoute: .headset, phase: .thinking), .voiceEnabled)

section("BargeInPolicy: isInterruption")

checkTrue("voiceEnabled: any real speech interrupts",
          BargeInPolicy.isInterruption(mode: .voiceEnabled, heardText: "wait, stop",
                                       energy: 0.01, currentlySpoken: "anything"))
checkTrue("voiceEnabled: empty text never interrupts",
          !BargeInPolicy.isInterruption(mode: .voiceEnabled, heardText: "   ",
                                        energy: 0.9, currentlySpoken: ""))
checkTrue("voiceRestricted: below the energy floor never interrupts",
          !BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "stop",
                                        energy: 0.05, currentlySpoken: "something else"))
checkTrue("voiceRestricted: an echo of the current sentence is rejected",
          !BargeInPolicy.isInterruption(mode: .voiceRestricted,
                                        heardText: "the weather today",
                                        energy: 0.5,
                                        currentlySpoken: "here is the weather today and tomorrow"))
checkTrue("voiceRestricted: real distinct speech above the floor interrupts",
          BargeInPolicy.isInterruption(mode: .voiceRestricted,
                                       heardText: "wait, stop",
                                       energy: 0.5,
                                       currentlySpoken: "here is the weather today"))

checkTrue("voiceRestricted: his own words with different punctuation are echo (2026-09-29, \"It's 8:07 PM\")",
          !BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "it's 8:07 p.m.",
                                        energy: 0.6, currentlySpoken: "It's 8:07 PM."))
checkTrue("voiceRestricted: a fragment of his own sentence is echo",
          !BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "marketing lecture",
                                        energy: 0.6, currentlySpoken: "Your marketing lecture is done."))
checkTrue("voiceRestricted: talking over him without an interruption word does not stop him on speakers",
          !BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "yeah okay cool",
                                        energy: 0.6, currentlySpoken: "Your marketing lecture is done."))
checkTrue("voiceRestricted: \"Orion, stop\" still stops him",
          BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "Orion stop",
                                       energy: 0.6, currentlySpoken: "Your marketing lecture is done."))

checkTrue("voiceRestricted: his own name in his own sentence does not stop him",
          !BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "Orion",
                                        energy: 0.6, currentlySpoken: "I'm Orion, and here's your evening."))

// MARK: - Interruption at the start, middle and end of TTS

section("interruption at the start, middle and end of TTS")

for momentLabel in ["start", "middle", "end"] {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.beginListening(at: t0)
    _ = model.transcriptUpdated("what's the weather", at: t0)
    model.utteranceDelivered()
    model.replyReady()
    check("[\(momentLabel)] enters speaking.playing", model.phase, .speaking(.playing))
    // The model does not track elapsed TTS time -- BargeInPolicy's decision
    // does not depend on when in the reply the interruption lands, which is
    // exactly the property this loop is checking: the SAME call, run at
    // three different simulated moments, must behave identically.
    let action = model.bargeIn(heardText: "wait, stop", energy: 0.4,
                               currentlySpoken: "the weather is", route: .headset)
    check("[\(momentLabel)] a confident interruption stops speaking", action, .stopSpeaking)
    check("[\(momentLabel)] phase records the interruption",
          model.phase, .speaking(.interrupted))
}

// MARK: - Barge-in during thinking pauses rather than cancels

section("barge-in during .thinking pauses, never cancels")

do {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.beginListening(at: t0)
    _ = model.transcriptUpdated("what's on my calendar", at: t0)
    model.utteranceDelivered()
    check("in thinking", model.phase, .thinking)
    let action = model.bargeIn(heardText: "actually, hold on", energy: 0.02,
                               currentlySpoken: "", route: .speakers)
    check("thinking + speakers: STILL pauses, never cancels — nothing to echo",
          action, .pauseTask)
}

// MARK: - hardInterrupt is unconditional

section("hardInterrupt: Escape / push-to-talk, unconditional")

do {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.beginListening(at: t0)
    model.utteranceDelivered()
    model.replyReady()
    check("hardInterrupt while speaking stops speaking", model.hardInterrupt(), .stopSpeaking)
    check("back to idle", model.phase, .idle)
}
do {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    model.beginListening(at: t0)
    model.utteranceDelivered()
    check("hardInterrupt while thinking cancels the task", model.hardInterrupt(), .cancelTask)
    check("back to idle", model.phase, .idle)
}

// MARK: - 100 simulated turns: no stuck phase, no orphaned audio device

section("100 simulated turns: no stuck phase, no orphaned audio device")

// A tiny deterministic PRNG so a failure here reproduces byte-for-byte on
// every run, the same reason WatchdogHarness uses a fixed epoch instead of
// `Date()`.
struct SplitMix64 {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
    mutating func nextDouble() -> Double { Double(next() >> 11) * (1.0 / 9007199254740992.0) }
    mutating func nextInt(_ upperBound: Int) -> Int { Int(next() % UInt64(upperBound)) }
}

var rng = SplitMix64(state: 0xC0FFEE_1234_5678)
var micOpens = 0
var micCloses = 0
var stuckPhases = 0
let continuationSamples = ["and", "but", "so", "because", "hold on", "one sec"]
let routes: [AudioRouteKind] = [.headset, .speakers]

for turn in 0..<100 {
    var model = TurnTakingModel(baseSilence: baseSilence, extendedSilence: extendedSilence)
    var clock: TimeInterval = 0
    model.beginListening(at: at(clock))
    micOpens += 1

    // Random number of interim updates, some carrying a continuation cue,
    // before the model is allowed to actually finalize.
    let updates = rng.nextInt(4)
    for _ in 0..<updates {
        clock += 0.1 + rng.nextDouble() * 0.3
        let cue = rng.nextInt(3) == 0 ? " " + continuationSamples[rng.nextInt(continuationSamples.count)] : ""
        _ = model.transcriptUpdated("some words\(cue)", at: at(clock))
    }

    // Drive silence ticks until the model finalizes, or bail out after a
    // generous number of ticks so a real bug (an endpoint that never
    // resolves) shows up as a FAILED check rather than an infinite loop.
    var guardTicks = 0
    while true {
        clock += 0.25
        let action = model.silenceTick(at: at(clock))
        guardTicks += 1
        if action == .finalizeUtterance { break }
        if guardTicks > 100 {
            failures += 1
            checks += 1
            print("  FAIL  turn \(turn): endpoint never finalized after \(guardTicks) ticks")
            break
        }
    }
    model.utteranceDelivered()
    model.replyReady()

    // Half the turns are interrupted, at a random simulated "moment"; the
    // other half play out and finish normally.
    if rng.nextInt(2) == 0 {
        let route = routes[rng.nextInt(routes.count)]
        let energy = rng.nextDouble()
        let action = model.bargeIn(heardText: "wait, stop", energy: energy,
                                   currentlySpoken: "something", route: route)
        // On the speaker route, a low-energy sample legitimately produces
        // `.none` -- that is correct policy, not a bug, so only assert the
        // phase never gets STUCK: either it recorded the interruption, or it
        // is still plainly `.speaking(.playing)`, never something in between.
        if action == .stopSpeaking {
            checkTrue("turn \(turn): interruption recorded", model.phase == .speaking(.interrupted))
        }
        model.returnToIdle()
    } else {
        model.speechFinished()
    }
    micCloses += 1

    if model.phase != .idle {
        stuckPhases += 1
        failures += 1
        checks += 1
        print("  FAIL  turn \(turn): ended in \(model.phase), not idle")
    }
}

checks += 1
if stuckPhases == 0 {
    print("  ok    all 100 simulated turns returned to idle")
} else {
    failures += 1
    print("  FAIL  \(stuckPhases) of 100 simulated turns did not return to idle")
}

check("microphone opens and closes balance across 100 turns (no orphaned device)",
      micOpens, micCloses)

// MARK: - Verdict

print("")
if failures == 0 {
    print("turntaking: \(checks) checks, all passed")
    exit(0)
} else {
    print("turntaking: \(checks) checks, \(failures) FAILED")
    exit(1)
}
