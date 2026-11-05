import Foundation

/// An identical chat message from the same device within about two minutes is the first one again, not a new ask (w20).
///
/// Tube audit 2026-11-04: the phone showed no progress, so Nick sent the same sentence again (4 pairs, new ids, 8-70 s apart).
/// The second copy ran right after the first and either re-failed or hit the repeat guard's "...". The ledger is a value:
/// every change returns a new one. Time is the phone's `sentAt`, so a copy that arrived late still lands in the window.
public struct CommandDedupe: Sendable, Equatable {
    public static let window: TimeInterval = 120
    public static let capacity = 50

    public enum Outcome: Equatable, Sendable {
        case inFlight
        case finished(ok: Bool, reply: String, thinking: String?)
    }

    public struct Entry: Equatable, Sendable {
        public let id: String
        public let key: String
        public let sentAt: Date
        public let outcome: Outcome
    }

    public enum Verdict: Equatable, Sendable {
        case run
        case collapse(Entry)
    }

    public private(set) var entries: [Entry]

    public init(entries: [Entry] = []) { self.entries = entries }

    /// Lowercased, runs of whitespace as one space, trimmed; the conversation keeps two threads apart.
    public static func key(text: String, conversation: String?) -> String {
        let words = text.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return (conversation ?? "") + "\u{1F}" + words
    }

    /// Run it, or collapse it into an earlier run. A first run that was refused is a retry, never collapsed.
    public func verdict(id: String, text: String, conversation: String?, sentAt: Date) -> Verdict {
        let key = Self.key(text: text, conversation: conversation)
        let match = entries.last { entry in
            guard entry.key == key, entry.id != id, abs(sentAt.timeIntervalSince(entry.sentAt)) <= Self.window else { return false }
            if case .finished(let ok, _, _) = entry.outcome { return ok }
            return true
        }
        return match.map(Verdict.collapse) ?? .run
    }

    public func starting(id: String, text: String, conversation: String?, sentAt: Date) -> CommandDedupe {
        let entry = Entry(id: id, key: Self.key(text: text, conversation: conversation), sentAt: sentAt, outcome: .inFlight)
        return CommandDedupe(entries: Array((entries.filter { $0.id != id } + [entry]).suffix(Self.capacity)))
    }

    public func finishing(id: String, ok: Bool, reply: String, thinking: String?) -> CommandDedupe {
        CommandDedupe(entries: entries.map {
            $0.id == id ? Entry(id: $0.id, key: $0.key, sentAt: $0.sentAt, outcome: .finished(ok: ok, reply: reply, thinking: thinking)) : $0
        })
    }
}
