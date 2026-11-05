import Foundation
import MobileCore

/// What to do with a command that waited (the Mac asleep, the phone underground): run it, or ask first (w20).
///
/// The old rule refused anything past ten minutes with "Not run: this was sent more than ten minutes ago" (the 13-minute-late
/// "unblock snap" while he was on a call). A chat message is a conversation: it always runs, whenever it arrives. A button
/// command is time-bound: a late "lock" or "unlock" may no longer be wanted, so the Mac asks, and a bare yes runs it.
public enum StaleCommand {
    public static let limit: TimeInterval = 10 * 60

    public enum Decision: Equatable, Sendable {
        case run
        case ask(String)
    }

    public static func decide(kind: LinkCommandKind, age: TimeInterval) -> Decision {
        guard kind != .chat, age > limit else { return .run }
        return .ask("This was from \(ago(age)): still want it? Say yes and I'll run it.")
    }

    static func ago(_ age: TimeInterval) -> String {
        let minutes = Int(age / 60)
        return minutes >= 60 ? "\(minutes / 60) h ago" : "\(minutes) min ago"
    }
}

/// The one command waiting on a "yes". Immutable: each change returns a new hold.
public struct StaleHold: Sendable, Equatable {
    public static let lifetime: TimeInterval = 15 * 60

    public struct Held: Equatable, Sendable {
        public let id: String
        public let text: String
        public let at: Date
    }

    public let held: Held?

    public init(held: Held? = nil) { self.held = held }

    public func holding(id: String, text: String, at: Date) -> StaleHold { StaleHold(held: Held(id: id, text: text, at: at)) }

    /// A bare yes ("yes", "yeah do it"), not a sentence that starts with one.
    public static func isYes(_ text: String) -> Bool {
        let words = text.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init)
        guard (1...4).contains(words.count), let first = words.first else { return false }
        return ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "do"].contains(first)
            && (first != "do" || words == ["do", "it"])
    }

    /// The held command if `text` is a yes while it is fresh, and the hold after (empty once taken or expired).
    public func confirming(_ text: String, now: Date) -> (Held?, StaleHold) {
        guard let held else { return (nil, self) }
        if now.timeIntervalSince(held.at) > Self.lifetime { return (nil, StaleHold()) }
        return Self.isYes(text) ? (held, StaleHold()) : (nil, self)
    }
}
