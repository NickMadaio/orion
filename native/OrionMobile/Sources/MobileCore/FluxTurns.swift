import Foundation

public struct FluxConfig: Equatable, Sendable {
    public var eotThreshold: Double
    public var eagerEotThreshold: Double?
    public var eotTimeoutMs: Int
    public init(eotThreshold: Double = 0.7, eagerEotThreshold: Double? = nil, eotTimeoutMs: Int = 5000) {
        self.eotThreshold = eotThreshold; self.eagerEotThreshold = eagerEotThreshold; self.eotTimeoutMs = eotTimeoutMs
    }
    public func url() -> URL {
        func clamp(_ value: Double, _ low: Double, _ high: Double, fallback: Double) -> Double {
            value.isFinite ? min(max(value, low), high) : fallback
        }
        var parts = URLComponents(string: "wss://api.deepgram.com/v2/listen")!
        parts.queryItems = [URLQueryItem(name: "model", value: "flux-general-en"),
            URLQueryItem(name: "encoding", value: "linear16"), URLQueryItem(name: "sample_rate", value: "16000"),
            URLQueryItem(name: "eot_threshold", value: String(clamp(eotThreshold, 0.5, 1, fallback: 0.7))),
            URLQueryItem(name: "eot_timeout_ms", value: String(min(max(eotTimeoutMs, 500), 60000)))]
        if let eagerEotThreshold { parts.queryItems?.append(URLQueryItem(name: "eager_eot_threshold", value: String(clamp(eagerEotThreshold, 0.3, 0.9, fallback: 0.5)))) }
        return parts.url!
    }
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
    public static let closeStream = "{\"type\":\"CloseStream\"}"
    private static func number(_ value: Any?) -> Double? {
        let parsed: Double?
        if let string = value as? String { parsed = Double(string) }
        else if let number = value as? NSNumber, String(cString: number.objCType) != "c" { parsed = number.doubleValue }
        else { parsed = nil }
        return parsed.flatMap { $0.isFinite ? $0 : nil }
    }
    public static func parse(_ text: String) -> FluxMessage? {
        guard let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return nil }
        switch type {
        case "Connected": return .connected(requestID: object["request_id"] as? String ?? "")
        case "Error": return .error(code: object["code"] as? String ?? "", description: object["description"] as? String ?? "")
        case "TurnInfo":
            guard let raw = object["event"] as? String, let event = FluxEvent(rawValue: raw),
                  let index = number(object["turn_index"]), index.rounded() == index, index >= 0, index < Double(Int.max) else { return .unknown(type: type) }
            let words = (object["words"] as? [[String: Any]] ?? []).compactMap { item -> FluxWord? in
                guard let word = item["word"] as? String, let confidence = number(item["confidence"]),
                      let start = number(item["start"]), let end = number(item["end"]) else { return nil }
                return FluxWord(word: word, confidence: confidence, start: start, end: end)
            }
            return .turn(event: event, turnIndex: Int(index), transcript: object["transcript"] as? String ?? "", words: words, endOfTurnConfidence: number(object["end_of_turn_confidence"]))
        default: return .unknown(type: type)
        }
    }
}
public struct FluxTurnTracker: Sendable {
    public private(set) var transcript = ""
    public private(set) var turnIndex: Int?
    public init() {}
    public mutating func absorb(_ message: FluxMessage) -> FluxDecision {
        guard case let .turn(event, index, text, _, _) = message else { return .none }
        if turnIndex != index { transcript = ""; turnIndex = index }
        if !text.isEmpty { transcript = text }
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        switch event {
        case .endOfTurn: return .finish(trimmed)
        case .eagerEndOfTurn: return .prepare(trimmed)
        case .turnResumed: return .resume
        default: return .none
        }
    }
}
public enum FluxDecision: Equatable, Sendable { case none, prepare(String), resume, finish(String) }
