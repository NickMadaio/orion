import Foundation

/*
 The phone's Home (wave 16, 2026-11-02). Nick: "I want a home page for mobile that's like the one on mac, includes a
 small 'what's next', or if orion has a message/question or if there's something I need to approve. also has the
 done early button on that home page for easy use."

 This file is the pure part, data in and cards out, like the Mac's HomeCardBuilder: the phone's glance (Calendar and
 ORION's plan, merged), the Mac's snapshot (approvals, the done-early context, health and tracking) and the thread.
 Nothing is invented. No data means no card, and the view says so calmly. The view is OrionViews/PhoneHomeView.
*/

/// One line of the chat thread, as Home needs it. `askID` is set on a message ORION started.
public struct PhoneHomeMessage: Equatable, Sendable {
    public let id: String
    public let askID: String?
    /// What Nick typed (empty on a message ORION started).
    public let mine: String
    /// ORION's words: the reply, or the message itself when ORION started it.
    public let orion: String?
    public let sentAt: Date
    public init(id: String, askID: String?, mine: String, orion: String?, sentAt: Date) {
        self.id = id; self.askID = askID; self.mine = mine; self.orion = orion; self.sentAt = sentAt
    }
}

public struct PhoneHome: Equatable, Sendable {
    /// What's next: the next block, and what is happening now.
    public struct Next: Equatable, Sendable {
        public let kicker: [String]
        public let title: String
        public let now: String?
        public let after: String?
    }

    /// The latest unanswered ORION question: the one a typed reply would answer.
    public struct Ask: Equatable, Sendable {
        public let id: String
        public let kicker: [String]
        public let text: String
        /// Quick answers, when the question itself offers them ("gym or library?", a yes/no).
        public let options: [String]
    }

    public struct Approval: Equatable, Sendable, Identifiable {
        public let id: String
        public let kicker: [String]
        public let title: String
        public let detail: String?
    }

    public struct DoneEarlyCard: Equatable, Sendable {
        public let kicker: [String]
        public let title: String
        public let hint: String
        /// "Next up: CS Lab at 6:10 PM, Lab 2." from the same block What's next shows; nil when there is none.
        public let nextLine: String?
    }

    public struct GlanceItem: Equatable, Sendable, Identifiable {
        public enum Kind: String, Sendable { case water, sleep, focus }
        public let kind: Kind
        public let label: String
        public let value: String
        public var id: String { kind.rawValue }
    }

    public let greeting: String
    public let subline: String
    public let next: Next?
    public let ask: Ask?
    public let approvals: [Approval]
    public let doneEarly: DoneEarlyCard
    public let glance: [GlanceItem]

    public init(greeting: String, subline: String, next: Next?, ask: Ask?, approvals: [Approval], doneEarly: DoneEarlyCard,
                glance: [GlanceItem]) {
        self.greeting = greeting; self.subline = subline; self.next = next; self.ask = ask; self.approvals = approvals
        self.doneEarly = doneEarly; self.glance = glance
    }

    /// The letter-spaced mono line, as the Mac card shows it.
    public static func kickerText(_ parts: [String]) -> String { parts.joined(separator: " · ").uppercased() }
}

/// Quick answers a question offers on its face. Conservative: a list of short choices ("gym, library or nothing?")
/// or a yes/no question; anything open ("what are you planning…?") gets none, and Reply is always there.
public enum AskOptions {
    private static let openers: Set<String> = ["what", "whats", "what's", "when", "where", "who", "why", "how", "which"]

    public static func from(_ text: String) -> [String] {
        guard let question = lastQuestion(in: text) else { return [] }
        let choices = choicesIn(question)
        if !choices.isEmpty { return choices }
        let first = question.split(separator: " ").first.map { String($0).lowercased() } ?? ""
        return openers.contains(first) ? [] : ["Yes", "No"]
    }

    /// The last sentence that ends in "?", without the mark.
    private static func lastQuestion(in text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasSuffix("?") else { return nil }
        var body = String(trimmed.dropLast())
        for mark in [". ", "! ", "? ", "\n"] {
            if let range = body.range(of: mark, options: .backwards) { body = String(body[range.upperBound...]) }
        }
        let sentence = body.trimmingCharacters(in: .whitespaces)
        return sentence.isEmpty ? nil : sentence
    }

    /// "gym, library or nothing" → Gym, Library, Nothing; only when every choice is one to three words.
    private static func choicesIn(_ question: String) -> [String] {
        let lower = question.lowercased()
        guard lower.contains(" or ") else { return [] }
        let parts = lower.components(separatedBy: ",").flatMap { $0.components(separatedBy: " or ") }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .map { $0.hasPrefix("or ") ? String($0.dropFirst(3)) : $0 }
            .filter { !$0.isEmpty }
        guard (2...4).contains(parts.count), parts.allSatisfy({ (1...3).contains($0.split(separator: " ").count) }) else { return [] }
        return parts.map { $0.prefix(1).uppercased() + $0.dropFirst() }
    }
}
