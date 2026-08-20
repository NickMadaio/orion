import Foundation

/*
 A phase that cannot end on its own is deafness with a nice animation.

 `.speaking` learned this first. It had exactly one exit, that exit ran through
 a completion handler on a scheduled audio buffer, and when one of those never
 arrived the phase never ended. Every input path is gated on the phase, so Orion
 sat there looking mid-sentence with the microphone dead until the app was
 relaunched. The fix was not to chase each TTS failure path — the next unhandled
 one reopens the hole — but to give the state machine a floor.

 `.thinking` has the same shape, and nobody noticed because its hole only opens
 when the agent subprocess wedges. On 2026-08-12 it did. The log is unambiguous:

   13:35:19  [audio] restored 69                 ← phase left .listening
   13:35:20  [audio] … ear=deepgram sent=4156540B
   13:47:xx  [audio] … ear=deepgram sent=4156540B   ← same byte count, 12 min later

 Twelve straight minutes of live microphone — levels to 0.9, Nick talking — with
 no wake word, no press, and no reply, ending only when he relaunched the app.
 `GatewayClient.ask` blocks on `readDataToEndOfFile()`, `agentQueue` is serial,
 and a grandchild of the agent holding that pipe open means the read never
 returns. So the completion that leaves `.thinking` never runs, every later turn
 queues behind the wedged one, and `wakeWord.setSuspended(phase != .idle)` keeps
 Orion deaf for the rest of the process's life.

 The rule is therefore general rather than per-phase, and it lives here: pure,
 clock-injected, and testable without an audio device, a network or a
 subprocess. `Tests/WatchdogHarness` drives it.

 Two independent limits, because they catch different failures:

   • STALL — nothing has happened for `stallAfter`. Measured from the last sign
     of life rather than from the start, so a genuinely long reply or a slow
     agent is never cut off; only a silent one is.
   • CEILING — the phase has run too long whatever it claims about itself.
     Catches the wedged component that keeps reporting progress forever, which a
     stall check alone cannot see.

 The verdict carries numbers, not prose. Callers format their own log lines
 because `orion-doctor` greps for the existing wording and a shared type is no
 reason to change what it matches.
 */
struct StallWatchdog {

    enum Verdict: Equatable {
        /// Still alive.
        case healthy
        /// Nothing has happened for too long.
        case stalled(seconds: Int)
        /// Alive, arguably, but it has had long enough.
        case overCeiling(seconds: Int)
    }

    /// Seconds without a sign of life before the phase is presumed wedged.
    let stallAfter: TimeInterval
    /// Seconds of total runtime that means wedged whatever the progress says.
    let ceiling: TimeInterval

    private(set) var startedAt: Date
    private(set) var lastProgressAt: Date

    /// A phase with no progress signal at all — `.thinking` watches a black-box
    /// subprocess — passes `.infinity` for `stallAfter` and is judged purely on
    /// the ceiling.
    init(stallAfter: TimeInterval, ceiling: TimeInterval, now: Date = Date()) {
        self.stallAfter = stallAfter
        self.ceiling = ceiling
        self.startedAt = now
        self.lastProgressAt = now
    }

    /// Evidence the phase is genuinely still working. Pushes the stall deadline
    /// out without touching the ceiling.
    mutating func noteProgress(at now: Date = Date()) {
        lastProgressAt = now
    }

    /// Stall is checked before the ceiling: when a phase is both silent and
    /// old, "it went quiet" is the more useful thing to have in the log.
    func verdict(at now: Date = Date()) -> Verdict {
        let stalled = now.timeIntervalSince(lastProgressAt)
        if stalled >= stallAfter {
            return .stalled(seconds: Int(stalled))
        }
        let total = now.timeIntervalSince(startedAt)
        if total >= ceiling {
            return .overCeiling(seconds: Int(total))
        }
        return .healthy
    }
}
