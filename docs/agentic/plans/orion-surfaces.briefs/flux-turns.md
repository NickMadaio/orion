# Task flux-turns — reading Deepgram Flux turn messages (Swift, MobileCore)

## Why
ORION's Mac ear uses Deepgram nova-3 on `/v1/listen`, which only reports silence, so ORION guesses end-of-turn itself (`AdaptiveEndpointModel.swift`). Deepgram Flux (`/v2/listen`, model `flux-general-en`) decides turns itself. Claude will switch the live socket over; this task is the pure, tested part: the URL and the message reader.

## Files
- `native/OrionMobile/Sources/MobileCore/FluxTurns.swift` (new; Foundation only)
- `native/OrionMobile/Tests/AgentTasksTests/FluxTurnsTests.swift` (new)

## Facts (from Deepgram's Flux reference)
- URL: `wss://api.deepgram.com/v2/listen` with query `model=flux-general-en`, `encoding=linear16`, `sample_rate=16000`, `eot_threshold` (0.5–1.0, default 0.7), optional `eager_eot_threshold` (0.3–0.9; only when set do EagerEndOfTurn/TurnResumed arrive), `eot_timeout_ms` (500–60000, default 5000).
- Server messages (JSON text frames):
  - `{"type":"Connected","request_id":"…","sequence_id":0}`
  - `{"type":"TurnInfo","request_id":"…","sequence_id":3,"event":"StartOfTurn|Update|EagerEndOfTurn|TurnResumed|EndOfTurn","turn_index":0,"audio_window_start":"0.0","audio_window_end":"1.5","transcript":"text said","words":[{"word":"hello","confidence":"0.99","start":0.0,"end":0.5}],"end_of_turn_confidence":"0.85"}`
  - `{"type":"Error","sequence_id":0,"code":"…","description":"…"}`
  - Numbers appear sometimes as JSON numbers and sometimes as strings in Deepgram's own examples: accept BOTH everywhere.
- Client control: `{"type":"CloseStream"}`.

## Interface
```swift
public struct FluxConfig: Equatable, Sendable {
    public var eotThreshold: Double = 0.7
    public var eagerEotThreshold: Double? = nil
    public var eotTimeoutMs: Int = 5000
    public init(eotThreshold: Double = 0.7, eagerEotThreshold: Double? = nil, eotTimeoutMs: Int = 5000)
    /// Values are clamped into Deepgram's ranges.
    public func url() -> URL
}
public enum FluxEvent: String, Sendable { case startOfTurn = "StartOfTurn", update = "Update", eagerEndOfTurn = "EagerEndOfTurn", turnResumed = "TurnResumed", endOfTurn = "EndOfTurn" }
public struct FluxWord: Equatable, Sendable { public let word: String; public let confidence: Double; public let start: Double; public let end: Double }
public enum FluxMessage: Equatable, Sendable {
    case connected(requestID: String)
    case turn(event: FluxEvent, turnIndex: Int, transcript: String, words: [FluxWord], endOfTurnConfidence: Double?)
    case error(code: String, description: String)
    case unknown(type: String)
}
public enum FluxTurns {
    public static func parse(_ text: String) -> FluxMessage?   // nil for non-JSON or no "type"
    public static let closeStream: String                      // exactly {"type":"CloseStream"}
}
/// Folds messages into what ORION needs: when to finish a turn and with what text.
public struct FluxTurnTracker: Sendable {
    public init()
    public private(set) var transcript: String
    public private(set) var turnIndex: Int?
    /// Returns .finish(text) on EndOfTurn, .prepare(text) on EagerEndOfTurn, .resume on TurnResumed, .none otherwise.
    public mutating func absorb(_ message: FluxMessage) -> FluxDecision
}
public enum FluxDecision: Equatable, Sendable { case none, prepare(String), resume, finish(String) }
```
Decisions: the tracker keeps the latest transcript of the current `turn_index`; a new `turn_index` starts fresh; `.finish` returns the EndOfTurn message's transcript (or the last known one if it is empty) trimmed; an unknown event string parses as `.unknown(type: "TurnInfo")`. Use `JSONSerialization` (not Codable) so string-or-number is easy. Foundation only.

## Tests — `FluxTurnsTests.swift` (XCTestCase `FluxTurnsTests`, method names exactly)
- `testURLHasModelEncodingRateAndThresholds`
- `testURLClampsOutOfRangeValuesAndOmitsEagerWhenNil`
- `testParsesConnected`
- `testParsesTurnInfoWithStringNumbers`
- `testParsesTurnInfoWithRealNumbers`
- `testParsesError`
- `testNonJSONIsNil`
- `testTrackerFinishesOnEndOfTurn`
- `testTrackerPreparesThenResumes`
- `testNewTurnIndexStartsFresh`
- `testCloseStreamIsExact`
