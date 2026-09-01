import Foundation

/// Capture: everything arrives here, and nothing ambiguous leaves it durable.
///
/// "Do not permanently save ambiguous captures without resolving their type" is
/// a rule about PERSISTENCE, so it does not live in the classifier -- a
/// classifier that refuses to guess is one somebody replaces with a classifier
/// that guesses. It lives at the boundary where saving happens: an unresolved
/// capture has no durable payload, so the calling code cannot save it by
/// accident. Phase 18's memory store refuses the same thing again in the cloud.
public enum CaptureSource: String, CaseIterable, Sendable {
    case text
    case voice
    case shareSheet = "share_sheet"
    case screenshot
    case photo
    case selectedContent = "selected_content"

    /// Named in the manifest as "later". Present as a value so the list is
    /// complete, and excluded from what the app accepts today.
    public static let later: [String] = ["widget", "app_intent"]
}

public enum CaptureKind: String, CaseIterable, Sendable {
    case task
    case event
    case reminder
    case note
    case memoryCandidate = "memory_candidate"
    case reference
    case healthJournalEntry = "health_journal_entry"
    case shoppingItem = "shopping_item"
    /// Not a failure. A classifier that always produces an answer produces a
    /// wrong one for anything unusual, and ambiguity has to be representable
    /// before it can be resolved.
    case unknown
}

public enum ResolvedBy: String, Sendable {
    case classifier
    case user
    case unresolved
}

/// How sure the classifier has to be before its guess counts as resolved.
/// Below this, the capture waits for a person, whatever kind it guessed.
public let captureConfidenceFloor = 0.75

/// A classifier's verdict. Only `CaptureClassifier` can make one.
///
/// `Capture.classify(as:confidence:)` used to be a public setter for the two
/// fields `isResolved` reads, and it stamped `resolvedBy = .classifier` whoever
/// called it. So any caller could force a screenshot to `.task` at confidence
/// 1.0, make it durable, and have the provenance field say a classifier decided.
/// A verdict with a fileprivate initialiser makes that unsayable.
public struct CaptureVerdict: Sendable, Equatable {
    public let kind: CaptureKind
    public let confidence: Double

    fileprivate init(kind: CaptureKind, confidence: Double) {
        self.kind = kind
        // NaN survives min(max(x, 0), 1): every comparison against NaN is false,
        // so both calls pass it straight through. It fails safe for durability,
        // but it breaks Equatable reflexivity -- two identical captures compare
        // unequal, which breaks SwiftUI diffing -- and any downstream
        // Int(confidence * 100) is a fatal error, not a catchable one.
        self.confidence = confidence.isFinite ? min(max(confidence, 0), 1) : 0
    }
}

public struct Capture: Sendable, Equatable, Identifiable {
    public let id: String
    public let source: CaptureSource
    public let text: String
    public private(set) var kind: CaptureKind
    public private(set) var confidence: Double
    public private(set) var resolvedBy: ResolvedBy
    public let capturedAt: Date

    /// The longest capture worth keeping. A Share Sheet can hand over a whole
    /// article; nothing downstream is served by an unbounded string.
    public static let maxTextLength = 20_000

    public init?(id: String, source: CaptureSource, text: String, capturedAt: Date) {
        // Validate at the boundary rather than trusting it. Without this a
        // whitespace-only capture became a durable payload with "text": "   "
        // the moment a user tapped a kind -- a permanently saved empty task.
        let trimmedID = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedID.isEmpty, !trimmedText.isEmpty else { return nil }
        guard trimmedText.count <= Capture.maxTextLength else { return nil }
        self.id = trimmedID
        self.source = source
        self.text = trimmedText
        self.kind = .unknown
        self.confidence = 0
        self.resolvedBy = .unresolved
        self.capturedAt = capturedAt
    }

    public var isResolved: Bool {
        kind != .unknown && confidence >= captureConfidenceFloor && resolvedBy != .unresolved
    }

    /// What may be written to durable storage. `nil` for anything unresolved.
    ///
    /// A function returning nothing, rather than a boolean somebody checks: the
    /// caller cannot save what it was not given.
    public func durablePayload() -> [String: String]? {
        guard isResolved else { return nil }
        return [
            "capture_id": id,
            "kind": kind.rawValue,
            "source": source.rawValue,
            "text": text,
            "resolved_by": resolvedBy.rawValue,
        ]
    }

    public mutating func classify(_ verdict: CaptureVerdict) {
        self.kind = verdict.kind
        self.confidence = verdict.confidence
        self.resolvedBy = (verdict.kind != .unknown && verdict.confidence >= captureConfidenceFloor)
            ? .classifier : .unresolved
    }

    /// The user picking. Always resolves, at full confidence, and records that a
    /// person chose -- so a later reader can tell an answer from a guess.
    public mutating func resolve(as kind: CaptureKind) {
        guard kind != .unknown else { return }
        self.kind = kind
        self.confidence = 1.0
        self.resolvedBy = .user
    }
}

/// A small, explainable classifier.
///
/// Deliberately rules rather than a model: on-device classification of a
/// screenshot is Phase 20's future, and a stub that pretended to be intelligent
/// would be harder to replace than one that obviously is not. What matters now
/// is that it can say `unknown`.
public struct CaptureClassifier: Sendable {
    public init() {}

    /// The most a keyword heuristic may claim.
    ///
    /// Deliberately BELOW `captureConfidenceFloor`. A substring match is a hint,
    /// not a decision, and everything at or above the floor is auto-saved with
    /// nobody asked. `contains("my ")` returned 0.76 against a floor of 0.75 --
    /// one hundredth over -- so "Jim*my *called about the roof", "acade*my *sent
    /// the invoice" and "ene*my *contact report" all became permanently savable
    /// memory candidates, tagged as resolved by the classifier. The comment on
    /// that line said a memory candidate needs grounds the classifier cannot
    /// give; the number said otherwise, and the number is what ran.
    public static let heuristicCeiling = 0.6

    public func classify(_ capture: Capture) -> CaptureVerdict {
        let text = capture.text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return CaptureVerdict(kind: .unknown, confidence: 0) }
        if capture.source == .screenshot || capture.source == .photo {
            // An image needs looking at, which nothing here can do.
            return CaptureVerdict(kind: .unknown, confidence: 0)
        }
        // Precise patterns -- a URL scheme, an explicit phrase -- may resolve.
        if text.hasPrefix("http://") || text.hasPrefix("https://") {
            return CaptureVerdict(kind: .reference, confidence: 0.9)
        }
        if text.contains("remind me") {
            return CaptureVerdict(kind: .reminder, confidence: 0.9)
        }
        if text.hasPrefix("todo") || text.hasPrefix("to do") || text.contains("i need to") {
            return CaptureVerdict(kind: .task, confidence: 0.85)
        }
        // Everything below is a keyword guess. It waits for a person.
        if Self.hasWord(text, "buy") || text.hasPrefix("get ") {
            return CaptureVerdict(kind: .shoppingItem, confidence: Self.heuristicCeiling)
        }
        if text.contains(" at ") && (text.contains("meeting") || text.contains("call")) {
            return CaptureVerdict(kind: .event, confidence: Self.heuristicCeiling)
        }
        if Self.hasWord(text, "slept") || Self.hasWord(text, "migraine") || Self.hasWord(text, "felt") {
            return CaptureVerdict(kind: .healthJournalEntry, confidence: Self.heuristicCeiling)
        }
        if text.hasPrefix("my ") || text.contains(" my ")
            || text.contains("i am ") || text.contains("i prefer ") {
            return CaptureVerdict(kind: .memoryCandidate, confidence: Self.heuristicCeiling)
        }
        return CaptureVerdict(kind: .unknown, confidence: 0.4)
    }

    /// Whole-word containment. `contains("buy ")` also matches inside a longer
    /// word; this is why the person-claim rule fired on "Jimmy" and "academy".
    static func hasWord(_ text: String, _ word: String) -> Bool {
        text.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .contains { $0 == Substring(word) }
    }
}

/// The inbox: captures waiting to be understood.
public struct CaptureInbox: Sendable, Equatable {
    public private(set) var captures: [Capture] = []

    public init() {}

    @discardableResult
    public mutating func accept(_ capture: Capture, using classifier: CaptureClassifier = CaptureClassifier())
        -> Capture
    {
        var incoming = capture
        incoming.classify(classifier.classify(capture))
        // An id arrives once. Two captures sharing one id broke `resolve(id:)`
        // -- it only ever reached the first -- and Capture is Identifiable, so
        // colliding ids also break list diffing in any view built on it.
        if let existing = captures.firstIndex(where: { $0.id == incoming.id }) {
            captures[existing] = incoming
            return incoming
        }
        captures.append(incoming)
        return incoming
    }

    public var needingResolution: [Capture] { captures.filter { !$0.isResolved } }

    public var resolved: [Capture] { captures.filter(\.isResolved) }

    @discardableResult
    public mutating func resolve(_ id: String, as kind: CaptureKind) -> Capture? {
        guard let index = captures.firstIndex(where: { $0.id == id }) else { return nil }
        captures[index].resolve(as: kind)
        return captures[index]
    }

    /// Everything that may be persisted. Unresolved captures are simply absent.
    public func durablePayloads() -> [[String: String]] {
        captures.compactMap { $0.durablePayload() }
    }
}
