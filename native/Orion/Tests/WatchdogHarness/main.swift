import Foundation

/*
 The phase watchdogs, driven against a clock we control.

 This exists because the bug it covers takes twelve minutes to reproduce by
 hand, needs a wedged agent subprocess to reproduce at all, and ends with the
 app deaf until it is relaunched. None of that belongs in a loop you run while
 changing the code. `StallWatchdog` was split out of `AppState` precisely so the
 decision — "has this phase stopped being alive?" — could be asked ten thousand
 times a second with no audio device, no network and no subprocess.

 What is NOT covered here, stated rather than hidden: this proves the watchdog
 reaches the right verdict, not that `AppState` wires it to the right recovery.
 The wiring is a five-line `switch` in `checkPhaseWatchdog`, and it is verified
 in the running app by the log lines quoted in `run-watchdog-test.sh`.

 Compiled against the real `Sources/Orion/StallWatchdog.swift` — not a copy —
 so it cannot drift from what ships.
 */

// MARK: - The smallest test runner that is still honest

var failures = 0
var checks = 0

func check(_ label: String, _ actual: StallWatchdog.Verdict, _ expected: StallWatchdog.Verdict) {
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

func section(_ title: String) {
    print("")
    print("== \(title) ==")
}

/// The zero of every scenario below. A fixed instant rather than `Date()` so a
/// failure reads the same on the tenth run as on the first.
let t0 = Date(timeIntervalSince1970: 1_770_000_000)
func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

// Mirrors of the values AppState passes in. Kept as literals rather than
// imported, so that changing a tunable in the app makes this file's intent
// visible in the diff instead of silently retargeting the test.
//
// thinkingCeiling was 210 here until 2026-09-05, matching the OLD
// `VoiceTuning.absoluteThinkingCeiling` literal — which was also, not
// coincidentally, the client's old hard read deadline: a tie, not an
// ordering, so whichever timer's runloop got there first decided what Nick
// saw. `VoiceTuning.absoluteThinkingCeiling` now reads `RunTimeouts.
// watchdogCeiling` (420) instead of a literal of its own, and this mirror is
// updated by hand to match — which is the point of keeping it a literal
// rather than an import: the diff shows the change instead of hiding it.
let speakingStall: TimeInterval = 12
let speakingCeiling: TimeInterval = 300
let thinkingCeiling: TimeInterval = 420

// MARK: - Speaking

section("speaking: a healthy reply is never cut off")

do {
    var watchdog = StallWatchdog(stallAfter: speakingStall, ceiling: speakingCeiling, now: t0)
    // Audio arriving every 200ms for four minutes — a long but real answer.
    var elapsed: TimeInterval = 0
    var verdict = StallWatchdog.Verdict.healthy
    while elapsed < 240 {
        elapsed += 0.2
        watchdog.noteProgress(at: at(elapsed))
        verdict = watchdog.verdict(at: at(elapsed))
        if verdict != .healthy { break }
    }
    check("240s of flowing audio stays healthy", verdict, .healthy)
}

do {
    var watchdog = StallWatchdog(stallAfter: speakingStall, ceiling: speakingCeiling, now: t0)
    watchdog.noteProgress(at: at(30))
    check("11s after the last buffer is still healthy", watchdog.verdict(at: at(41)), .healthy)
    check("12s after the last buffer is a stall", watchdog.verdict(at: at(42)), .stalled(seconds: 12))
}

do {
    // The engine that keeps emitting level events forever. A stall check alone
    // cannot see this one, which is why the ceiling exists.
    var watchdog = StallWatchdog(stallAfter: speakingStall, ceiling: speakingCeiling, now: t0)
    var elapsed: TimeInterval = 0
    var verdict = StallWatchdog.Verdict.healthy
    while elapsed < 400 {
        elapsed += 0.2
        watchdog.noteProgress(at: at(elapsed))
        verdict = watchdog.verdict(at: at(elapsed))
        if verdict != .healthy { break }
    }
    check("a reply that never ends trips the ceiling", verdict, .overCeiling(seconds: 300))
}

// MARK: - Thinking

section("thinking: the 2026-08-12 stall")

do {
    /*
     The incident, to scale.

     13:35:19  the phase enters `.thinking`
     13:35:20  the last byte reaches Deepgram; the meter freezes at 4156540B
     13:47:xx  still `.thinking`; twelve minutes of live microphone, no wake
               word, no press, no reply
     13:48:12  Nick relaunches the app, which is the only thing that ever
               ended it

     `.thinking` gets no progress signal — the agent is a subprocess that says
     nothing at all until it is finished — so `stallAfter` is `.infinity` and
     the ceiling is the whole defence.
    */
    let watchdog = StallWatchdog(stallAfter: .infinity, ceiling: thinkingCeiling, now: t0)
    check("a 30s answer is healthy", watchdog.verdict(at: at(30)), .healthy)
    check("a 180s answer is healthy (comfortably under the agent's own 300s timeout)",
          watchdog.verdict(at: at(180)), .healthy)
    check("320s — the client's terminate backstop — is still healthy",
          watchdog.verdict(at: at(320)), .healthy)
    check("420s trips the ceiling", watchdog.verdict(at: at(420)), .overCeiling(seconds: 420))
    // The point of the whole exercise: at the moment Nick gave up and
    // relaunched, the old code had done nothing and this one has recovered
    // about five minutes earlier.
    check("the twelve-minute mark is long since recovered",
          watchdog.verdict(at: at(12 * 60)), .overCeiling(seconds: 720))
}

do {
    // `.infinity` must not be reachable as a stall, however long it runs.
    let watchdog = StallWatchdog(stallAfter: .infinity, ceiling: thinkingCeiling, now: t0)
    let verdict = watchdog.verdict(at: at(86_400))
    check("a day later it is a ceiling, never a stall", verdict, .overCeiling(seconds: 86_400))
}

// MARK: - Ordering

section("ordering: silent and old reports the more useful fault")

do {
    var watchdog = StallWatchdog(stallAfter: speakingStall, ceiling: speakingCeiling, now: t0)
    watchdog.noteProgress(at: at(1))
    // Both limits are blown. "It went quiet" is what a person can act on.
    check("stall wins over ceiling", watchdog.verdict(at: at(500)), .stalled(seconds: 499))
}

// MARK: - Boundaries

section("boundaries: the exact second")

do {
    let watchdog = StallWatchdog(stallAfter: 5, ceiling: 100, now: t0)
    check("4.999s is healthy", watchdog.verdict(at: at(4.999)), .healthy)
    check("5.0s stalls", watchdog.verdict(at: at(5.0)), .stalled(seconds: 5))
}

do {
    var watchdog = StallWatchdog(stallAfter: .infinity, ceiling: 100, now: t0)
    watchdog.noteProgress(at: at(99))
    check("99.999s is healthy", watchdog.verdict(at: at(99.999)), .healthy)
    check("100.0s hits the ceiling", watchdog.verdict(at: at(100.0)), .overCeiling(seconds: 100))
}

// MARK: - Verdict

print("")
if failures == 0 {
    print("watchdog: \(checks) checks, all passed")
    exit(0)
} else {
    print("watchdog: \(checks) checks, \(failures) FAILED")
    exit(1)
}
