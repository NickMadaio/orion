# Task voice-guard — `VoiceSessionGuard`, the hard limits on a phone voice conversation

## Files
- `native/OrionMobile/Sources/MobileCore/VoiceSessionGuard.swift` (new, Foundation only).
- `native/OrionMobile/Tests/AgentTasksTests/VoiceSessionGuardTests.swift` (new).

## Interface (exactly)
```
public struct VoiceSessionLimits: Equatable, Sendable {
    public var idleSeconds: TimeInterval          // default 45
    public var maxSessionSeconds: TimeInterval    // default 900 (15 min)
    public var maxTurns: Int                      // default 30 messages sent per conversation
    public var maxConsecutiveDiscards: Int        // default 3
    public init(idleSeconds: TimeInterval = 45, maxSessionSeconds: TimeInterval = 900, maxTurns: Int = 30, maxConsecutiveDiscards: Int = 3)
}
public enum VoiceStopReason: String, Equatable, Sendable { case user, idle, lifetime, turnLimit, strayAudio, background }
public enum VoiceTurnVerdict: Equatable, Sendable { case send(String), discard, stop(VoiceStopReason) }
public struct VoiceSessionGuard: Equatable, Sendable {
    public let limits: VoiceSessionLimits
    public let startedAt: Date
    public private(set) var lastActivityAt: Date
    public private(set) var turnsSent: Int
    public private(set) var consecutiveDiscards: Int
    public init(startedAt: Date, limits: VoiceSessionLimits = VoiceSessionLimits())
    public func markingActivity(at: Date) -> VoiceSessionGuard
    public func check(now: Date) -> VoiceStopReason?
    public func judging(_ transcript: String, at: Date) -> (VoiceSessionGuard, VoiceTurnVerdict)
    public static func message(for reason: VoiceStopReason) -> String
}
```

## Decisions, in order
1. `markingActivity(at:)` returns a copy with `lastActivityAt = max(lastActivityAt, at)`. Callers mark activity when speech is heard and when ORION finishes speaking.
2. `check(now:)`: `.lifetime` if `now - startedAt >= maxSessionSeconds`; else `.idle` if `now - lastActivityAt >= idleSeconds`; else nil. Lifetime wins when both hold.
3. `judging(_:at:)`, after `check(now: at)` (return `(self, .stop(r))` if it reports one):
   - Normalise: trim, lowercase, strip `.,!?…` and collapse spaces.
   - Empty, or every word is filler (`um uh uhh hmm mm mhm ah oh er erm like okay ok yeah so`), or fewer than 2 words that are not filler → discard: `consecutiveDiscards + 1`; if that reaches `maxConsecutiveDiscards` → `.stop(.strayAudio)`, else `.discard`.
   - Exactly one of these (normalised, whole transcript) → `.stop(.user)`: `stop`, `stop listening`, `that's all`, `thats all`, `goodbye`, `bye orion`, `end conversation`, `end voice`. Checked BEFORE the word-count rule, so "stop" alone stops.
   - Otherwise: if `turnsSent >= maxTurns` → `.stop(.turnLimit)`; else `.send(trimmedOriginal)` with `turnsSent + 1`, `consecutiveDiscards = 0`, `lastActivityAt = at`.
4. `message(for:)`: user → "Voice ended."; idle → "Voice ended — nothing heard for a while."; lifetime → "Voice ended after 15 minutes. Tap the mic to keep going."; turnLimit → "Voice ended after 30 messages. Tap the mic to keep going."; strayAudio → "Voice ended — it was only hearing background noise."; background → "Voice ended when ORION left the screen.". (Use the limit values in the lifetime/turnLimit strings: minutes = Int(maxSessionSeconds/60).)

## Tests (titles exactly, as XCTest methods `test_<words_with_underscores>`)
- "idle after the idle window with no activity"
- "activity resets the idle clock"
- "lifetime wins over idle"
- "filler only is discarded and the third discard stops as stray audio"
- "a real sentence is sent and clears the discard count"
- "stop alone ends the conversation"
- "the turn limit stops instead of sending"
- "a stopped session never sends"  (judging after the lifetime returns .stop(.lifetime) even for a real sentence)
