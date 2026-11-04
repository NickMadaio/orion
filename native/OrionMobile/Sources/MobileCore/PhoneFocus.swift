import Foundation

/*
 ORION's focus session as the phone sees it (wave 19).

 The Mac's session engine owns the clock. Link publishes a small `FocusSession` in the snapshot, and the phone only ever
 derives from it: what Home should show (`face`), which of Nick's app groups to shield (`shield`), and what the lock screen
 says (`liveActivity`). All pure, so the state machine is tested without a screen or Screen Time.

 Every key but the identity is optional and unknown keys are ignored: an old phone keeps decoding a newer Mac's session,
 and a new phone decodes a snapshot from before this existed (focusSession is simply nil).
*/
extension LinkSnapshot {
    public struct FocusSession: Codable, Equatable, Sendable {
        public var sessionId: String
        public var task: String
        /// "focus" or "break".
        public var phase: String
        /// "running" or "paused". A finished session is not published at all.
        public var status: String
        /// When this phase ends. nil while paused.
        public var endsAt: Date?
        /// The whole phase length, for the ring.
        public var phaseSeconds: Double?
        /// What is left while paused.
        public var remainingSeconds: Double?
        public var block: Int?
        public var blocks: Int?
        /// App groups (messaging, feeds, video, games, browsers) this session allows, which the phone leaves alone.
        public var allowed: [String]?
        public init(sessionId: String, task: String, phase: String, status: String = "running", endsAt: Date? = nil,
                    phaseSeconds: Double? = nil, remainingSeconds: Double? = nil, block: Int? = nil, blocks: Int? = nil,
                    allowed: [String]? = nil) {
            self.sessionId = sessionId; self.task = task; self.phase = phase; self.status = status; self.endsAt = endsAt
            self.phaseSeconds = phaseSeconds; self.remainingSeconds = remainingSeconds; self.block = block; self.blocks = blocks
            self.allowed = allowed
        }
    }
}

public enum PhoneFocus {
    public static let groups = ["messaging", "feeds", "video", "games", "browsers"]
    /// How long past its end a phase is still shown ("wrapping up") while the Mac moves to the next one.
    public static let overrun: TimeInterval = 90

    public enum Mode: String, Equatable, Sendable { case idle, focus, breakTime, paused }

    public struct Face: Equatable, Sendable {
        public var mode: Mode
        public var kicker: String
        public var title: String
        public var countdown: String
        /// 0...1 through the phase.
        public var progress: Double
        public var remaining: TimeInterval
        public var blockLine: String?
        public var sessionId: String?
        public static let idle = Face(mode: .idle, kicker: "", title: "", countdown: "", progress: 0, remaining: 0, blockLine: nil, sessionId: nil)
    }

    public static func face(_ session: LinkSnapshot.FocusSession?, now: Date) -> Face {
        guard let session, session.status == "running" || session.status == "paused",
              session.phase == "focus" || session.phase == "break" else { return .idle }
        let isBreak = session.phase == "break"
        let word = isBreak ? "BREAK" : "FOCUS"
        let block = session.block.flatMap { b in session.blocks.map { "Block \(b) of \($0)" } }
        func face(_ mode: Mode, _ kicker: String, _ remaining: TimeInterval) -> Face {
            let total = session.phaseSeconds ?? 0
            let progress = total > 0 ? min(1, max(0, 1 - remaining / total)) : 0
            return Face(mode: mode, kicker: kicker, title: session.task, countdown: clock(remaining), progress: progress,
                        remaining: remaining, blockLine: block, sessionId: session.sessionId)
        }
        if session.status == "paused" {
            let remaining = max(0, session.remainingSeconds ?? 0)
            return face(.paused, remaining > 0 ? "PAUSED · \(left(remaining))" : "PAUSED", remaining)
        }
        let mode: Mode = isBreak ? .breakTime : .focus
        guard let end = session.endsAt else { return face(mode, word, 0) }
        let remaining = end.timeIntervalSince(now)
        if remaining < -overrun { return .idle }
        if remaining <= 0 { return face(mode, "\(word) · WRAPPING UP", 0) }
        return face(mode, "\(word) · \(left(remaining))", remaining)
    }

    /// "32 MIN LEFT", or seconds in the last minute.
    private static func left(_ seconds: TimeInterval) -> String {
        seconds < 60 ? "\(Int(seconds.rounded(.up))) SEC LEFT" : "\(Int((seconds / 60).rounded(.up))) MIN LEFT"
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(max(0, seconds).rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: Shields

    public enum ShieldPlan: Equatable, Sendable {
        /// Shield these groups. `missing` are wanted but have no apps picked.
        case shield(lists: [String], missing: [String])
        /// Focus wants shields but he has picked no apps for any group: ask, never a silent no-op.
        case needPicks(lists: [String])
        case lift
    }

    /// Only a running focus phase with a known end holds a shield: a break, a pause, an end or an open-ended session
    /// lifts it, so a lost update can never leave the phone locked.
    public static func shield(_ session: LinkSnapshot.FocusSession?, picked: Set<String>, now: Date) -> ShieldPlan {
        guard let session, session.phase == "focus", session.status == "running",
              let end = session.endsAt, end > now else { return .lift }
        let allowed = Set(session.allowed ?? [])
        let wanted = groups.filter { !allowed.contains($0) }
        let have = wanted.filter { picked.contains($0) }
        let missing = wanted.filter { !picked.contains($0) }
        if picked.intersection(groups).isEmpty { return .needPicks(lists: wanted) }
        return .shield(lists: have, missing: missing)
    }

    // MARK: Wording

    /// What ORION says when Nick is drawn off the task. nil outside a focus block.
    public static func nudge(_ face: Face) -> String? {
        guard face.mode == .focus else { return nil }
        let left = face.remaining >= 60 ? "\(Int((face.remaining / 60).rounded(.up))) min left" : "\(Int(face.remaining.rounded(.up))) sec left"
        return "Back to \(face.title) — \(left)."
    }

    // MARK: Live Activity

    public struct LiveFields: Equatable, Sendable {
        public var mode: String
        public var title: String
        public var detail: String
        public var start: Date
        public var end: Date
    }

    /// The lock-screen card for a running phase. A pause or an open-ended session has no countdown, so none is shown.
    public static func liveActivity(_ session: LinkSnapshot.FocusSession?, now: Date) -> LiveFields? {
        let face = face(session, now: now)
        guard let session, face.mode == .focus || face.mode == .breakTime, let end = session.endsAt else { return nil }
        let start = end.addingTimeInterval(-(session.phaseSeconds ?? 0))
        let detail = face.mode == .breakTime ? "Break · back to \(session.task) next" : (face.blockLine ?? "Phone shielded")
        return LiveFields(mode: face.mode == .breakTime ? "break" : "focus", title: session.task, detail: detail, start: start, end: end)
    }
}
