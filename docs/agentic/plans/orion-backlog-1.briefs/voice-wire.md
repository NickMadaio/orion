# Task voice-wire — the phone voice loop obeys `VoiceSessionGuard` and really stops

## Why
`native/OrionMobile/App/PhoneVoice.swift` re-listens forever: after a reply is spoken (`speechSynthesizer(_:didFinish:)` → `listen()`), after an empty turn (`finishTurn` → `listen()`), after recognition errors (retry). Nothing times out, so background audio became chat messages for hours. This task is the P0 fix. Depends on task voice-guard (`import MobileCore` is already available in App files — check the existing imports at the top of PhoneVoice.swift and add `import MobileCore` if missing).

## Files
- `native/OrionMobile/App/PhoneVoice.swift` (edit).
- `native/OrionMobile/App/ConversationView.swift` (edit).

## Behaviour
1. PhoneVoice gets `private var sessionGuard: VoiceSessionGuard?`, `private var guardTimer: Timer?` and `@Published private(set) var endedBecause: String?`.
2. `start(send:)`: after permission is granted, set `sessionGuard = VoiceSessionGuard(startedAt: Date())`, `endedBecause = nil`, start `guardTimer` (repeats every 2 seconds, main actor) that calls `enforceLimits()`.
3. `enforceLimits()`: if `sessionGuard?.check(now: Date())` returns a reason → `end(reason)`. While phase is `.sending`, `.waiting` or `.speaking`, first mark activity at now (waiting for ORION is not idleness), then check (so only lifetime can fire then).
4. New `func end(_ reason: VoiceStopReason)`: calls `stop()`, then sets `endedBecause = VoiceSessionGuard.message(for: reason)` (keep it for `.user` too).
5. `stop()` additionally: invalidates and nils `guardTimer`, sets `sessionGuard = nil`, sets `send = nil` (so a late callback can never post), and still does everything it does today. `stop()` must be idempotent.
6. `recognized(_:_:)`: whenever a result has non-empty text, `sessionGuard = sessionGuard?.markingActivity(at: Date())`.
7. `finishTurn()`: replace the empty check and the hard-coded stop-word list with `sessionGuard.judging(text, at: Date())`: `.send(t)` → store the new guard, `phase = .sending`, `send?(t)`; `.discard` → store the new guard and `listen()`; `.stop(r)` → `end(r)`. If `sessionGuard` is nil (stopped), call nothing and return.
8. `speechSynthesizer(_:didFinish:)`: only if phase is `.speaking` AND `sessionGuard != nil`: mark activity, then `listen()`. Never re-listen after stop.
9. The recognition-error retry path: before re-listening, run `enforceLimits()` and only retry if still active (`sessionGuard != nil`).
10. `ConversationView.swift`: add `@Environment(\.scenePhase) private var scenePhase` and `.onChange(of: scenePhase) { _, phase in if phase != .active { voice.end(.background) } }` on the same view that has the existing `.onDisappear { … voice.stop() … }`. Where the voice strip / talk screen shows status, show `voice.endedBecause` (small secondary text) when phase is `.off` and it is non-nil.

## Checks
`phone-build` and `mobile-swift-tests` must pass. Do not change anything else in these files (no restyling).
