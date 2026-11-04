import Foundation

/// Whether iCloud has a message the phone sent: it is `uploading` until the save returns, `saved` after, `failed` if it threw.
public enum ChatUpload: Equatable, Sendable { case uploading, saved, failed }

/// The visible life of a message Nick sent: sending, delivered and waiting for the Mac, thinking, answered; or a way out.
///
/// 2026-11-04 phone audit. A message the Mac never picked up (asleep, offline) stayed "Sent to your Mac…" with typing dots
/// for ever; one the Mac died on mid-answer stayed "Thinking" for ever (a `running` record is never re-fetched); a send
/// that threw showed iCloud's error as if ORION had said it, with no way to resend; and a refusal read "(exit 1)".
/// The Mac drops a command older than ten minutes (`staleAfter`), so a pending one past `waitLimit` will never run.
public enum ChatDelivery: Equatable, Sendable {
    case sending, waiting, thinking, answered, notSent, failed, stalled

    /// Past this, a command still `pending` has been dropped or never seen (the Mac's own limit is 10 minutes).
    public static let waitLimit: TimeInterval = 12 * 60
    /// Past this, a command still `running` died with the Mac (its own timeout is 3 minutes).
    public static let thinkLimit: TimeInterval = 6 * 60

    public static func state(status: LinkCommandStatus, upload: ChatUpload, sentAt: Date, now: Date) -> ChatDelivery {
        if upload == .failed { return .notSent }
        let age = max(0, now.timeIntervalSince(sentAt))
        switch status {
        case .done: return .answered
        case .failed: return .failed
        case .pending:
            if upload == .uploading { return .sending }
            return age > waitLimit ? .stalled : .waiting
        case .running:
            return age > thinkLimit ? .stalled : .thinking
        }
    }

    /// Still on its way: the typing indicator belongs here, and nowhere else.
    public var inFlight: Bool { self == .sending || self == .waiting || self == .thinking }
    public var canRetry: Bool { self == .notSent || self == .failed || self == .stalled }
    /// A send that threw may have reached iCloud: the same id is idempotent. A Mac refusal needs a new id (orion-remote's replay guard).
    public var retriesSameID: Bool { self == .notSent }

    /// The small line under his message, or nil once answered.
    public func caption(macOnline: Bool) -> String? {
        switch self {
        case .sending: return "Sending…"
        case .waiting: return macOnline ? "Delivered" : "Delivered · waiting for your Mac"
        case .thinking, .answered: return nil
        case .notSent: return "Didn’t send — tap to retry"
        case .failed: return "Didn’t go through — tap to retry"
        case .stalled: return "No answer yet — tap to retry"
        }
    }
}
