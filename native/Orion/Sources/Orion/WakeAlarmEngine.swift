import Foundation

/// What the alarm did, for the sound, the surface and the log.
enum WakeAlarmEvent: Equatable {
    case fired(WakeAlarmEntry)
    case ring(WakeAlarmEntry)
    case snoozed(WakeAlarmEntry, until: Date, count: Int)
    case dismissed(WakeAlarmEntry, snoozes: Int)
    case gaveUp(WakeAlarmEntry)

    var name: String {
        switch self {
        case .fired: return "fired"
        case .ring: return "ring"
        case .snoozed: return "snoozed"
        case .dismissed: return "dismissed"
        case .gaveUp: return "gave_up"
        }
    }
    var entry: WakeAlarmEntry {
        switch self {
        case .fired(let e), .ring(let e), .snoozed(let e, _, _), .dismissed(let e, _), .gaveUp(let e): return e
        }
    }
}

/// The alarm's rules, with no sound, window or file: `tick()` is called by a timer and the clock is injected.
/// Rings from the alarm time, again every minute until he dismisses it, snoozes 9 minutes at most twice,
/// and gives up 20 minutes after it first fired.
final class WakeAlarmEngine {
    static let repeatInterval: TimeInterval = 60
    static let snoozeInterval: TimeInterval = 9 * 60
    static let maxSnoozes = 2
    static let giveUpAfter: TimeInterval = 20 * 60

    private struct Active { let entry: WakeAlarmEntry; var lastRing: Date; var snoozes = 0; var snoozedUntil: Date? }

    private let clock: () -> Date
    private let isSandbox: () -> Bool
    private(set) var entries: [WakeAlarmEntry] = []
    private var handled: Set<String>
    private var active: Active?

    init(clock: @escaping () -> Date = Date.init, isSandbox: @escaping () -> Bool = { false }, handled: Set<String> = []) {
        self.clock = clock
        self.isSandbox = isSandbox
        self.handled = handled
    }

    var ringing: WakeAlarmEntry? { active.flatMap { $0.snoozedUntil == nil ? $0.entry : nil } }
    var isActive: Bool { active != nil }
    var snoozesUsed: Int { active?.snoozes ?? 0 }
    var canSnooze: Bool { (active?.snoozes ?? Self.maxSnoozes) < Self.maxSnoozes && active?.snoozedUntil == nil }

    func load(_ entries: [WakeAlarmEntry]) { self.entries = entries }

    func tick() -> [WakeAlarmEvent] {
        let now = clock()
        // An evaluation run never rings for its sandbox data.
        if isSandbox() { active = nil; return [] }
        if var current = active {
            if now.timeIntervalSince(current.entry.fireAt) >= Self.giveUpAfter {
                active = nil; handled.insert(current.entry.key)
                return [.gaveUp(current.entry)]
            }
            if let until = current.snoozedUntil {
                guard now >= until else { return [] }
                current.snoozedUntil = nil; current.lastRing = now; active = current
                return [.ring(current.entry)]
            }
            guard now.timeIntervalSince(current.lastRing) >= Self.repeatInterval else { return [] }
            current.lastRing = now; active = current
            return [.ring(current.entry)]
        }
        guard let due = entries.first(where: { entry in
            !handled.contains(entry.key) && now >= entry.fireAt && now.timeIntervalSince(entry.fireAt) < Self.giveUpAfter
        }) else { return [] }
        active = Active(entry: due, lastRing: now)
        return [.fired(due)]
    }

    /// "Snooze": nil when none is left (or nothing is ringing).
    @discardableResult
    func snooze() -> WakeAlarmEvent? {
        guard var current = active, canSnooze else { return nil }
        let until = clock().addingTimeInterval(Self.snoozeInterval)
        current.snoozes += 1; current.snoozedUntil = until; active = current
        return .snoozed(current.entry, until: until, count: current.snoozes)
    }

    /// "I'm up", once whatever AlarmDismissal is in charge has cleared him.
    @discardableResult
    func dismiss() -> WakeAlarmEvent? {
        guard let current = active else { return nil }
        active = nil; handled.insert(current.entry.key)
        return .dismissed(current.entry, snoozes: current.snoozes)
    }
}
