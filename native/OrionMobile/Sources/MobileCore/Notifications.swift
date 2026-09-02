import Foundation

// PHASE 41 — the notification engine.
//
// The manifest asks for three levels — immediate, brief, ambient — names what
// belongs in each, and then adds the two lines that are actually the phase:
//
//   · "Do not notify for every ORION observation."
//   · "Do not rely on push notifications as state synchronization."
//
// Both are prohibitions, so both are expressed in the TYPES rather than in a
// rule somebody has to remember at a call site.
//
// ## What already existed, and what this adds
//
// `NotificationCategory` and `NotificationSettings` were built earlier and are
// kept, raw values untouched — they are persistence-facing. What they did not
// have was a level: urgency was a single `mayBreakThrough` boolean, which can
// say "interrupt / do not interrupt" and cannot say "hold this until the
// morning". Everything non-urgent therefore had exactly one fate, and that is
// the gap `brief` fills.
//
// `mayBreakThrough` is now DERIVED from the level rather than being its own
// switch. Two independent switches over the same cases is a drift waiting to
// happen: the day someone adds a category and updates one of them, the two
// disagree and nothing complains. Now there is one decision.
//
// ## Why the routing is a total switch
//
// `NotificationCategory.level` has no `default:` case. Adding a category
// without deciding when it is allowed to interrupt somebody does not compile.
// That is the whole enforcement — there is no lint rule and no reviewer step.
//
// ## "Do not notify for every ORION observation"
//
// Three mechanisms, none of them a filter on text:
//
//  1. There is no `observation` category, and there must never be one. Every
//     member below names something that has already passed a judgement. A
//     category meaning "something happened" would let any call site notify.
//  2. An ambient item is NEVER pushed. `plan` can only ever put it in
//     `collected` — it is visible when Nick looks, and that is all. There is no
//     code path from ambient to interrupt, so no observation stream can
//     escalate itself by volume.
//  3. Ambient items COLLAPSE by subject. Fifty readings about the same subject
//     are one item about that subject, not fifty. Time-based rate limiting is
//     deliberately not duplicated here — `scripts/orion-notify` already owns
//     quiet hours and the hourly cap, and a second limiter with its own numbers
//     would be two answers to one question.
//
// ## "Do not rely on push notifications as state synchronization"
//
// A push may be lost, delayed, duplicated, or delivered out of order, and the
// system has to be correct in all four cases. That is a property of the type,
// so:
//
//  · A `NotificationItem` carries NO state. It has a `subject`, which is the id
//    of a durable record, and a `summary`, which is display text. There is no
//    payload field and no `apply()`. The only way to learn what happened is to
//    go and read the subject. A test pins the stored property set by reflection
//    so that adding a `state:` field fails by name.
//  · `init?` REFUSES an empty subject. A notification that points at nothing
//    would be one whose content exists only inside the push — precisely the
//    thing this requirement forbids.
//  · `plan` is a pure function of the whole item list, and is ORDER-INDEPENDENT
//    and IDEMPOTENT. Shuffle the arrivals and the plan is identical; deliver
//    the same item twice and it appears once. If push order mattered, a
//    reordered delivery would corrupt state — which is the failure mode the
//    requirement is naming.

// MARK: - Levels

/// How much of somebody's attention a notification is allowed to take.
///
/// Ordered by rising urgency, and `Comparable` on that order so "at least this
/// urgent" is expressible without anyone re-deriving the ranking. The order is
/// the type's meaning, so a test pins `allCases` rather than its count — a
/// reordering would silently invert every comparison in the app.
public enum NotificationLevel: String, CaseIterable, Sendable, Comparable {
    /// Visible when he looks. Never pushed.
    case ambient
    /// Held for the next morning or evening summary.
    case brief
    /// Interrupts, including through a focus session.
    case immediate

    private var urgency: Int {
        switch self {
        case .ambient: return 0
        case .brief: return 1
        case .immediate: return 2
        }
    }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.urgency < rhs.urgency }
}

// MARK: - Categories

/// Notifications: which kinds exist, and what the phone is allowed to send.
///
/// Categories are closed rather than free-form because every category is a
/// decision about when it is acceptable to interrupt somebody, and a string
/// parameter would make that decision at a call site instead of here.
///
/// Raw values are persistence-facing — `NotificationSettings` stores them — so
/// the four that predate Phase 41 keep the spellings they had.
public enum NotificationCategory: String, CaseIterable, Sendable {
    // -- immediate --
    /// Something needs a yes or no before it can proceed.
    case approvalRequired = "approval_required"
    /// A security event: a new device, a revocation, a lock.
    case security = "security"
    /// Two required commitments in the same slot. Reported, never resolved —
    /// rearranging Nick's commitments is Phase 38's prohibition by the back door.
    case scheduleConflict = "schedule_conflict"
    /// A remote task stopped and cannot continue without an answer. A remote
    /// task that merely FINISHED is `completion`; the manifest is specific that
    /// what earns an interruption is needing input.
    case remoteTaskFailure = "remote_task_failure"

    // -- brief --
    /// The morning plan.
    case morningSummary = "morning_summary"
    /// The evening review.
    case eveningSummary = "evening_summary"
    /// Something the user asked to be told about.
    case requested = "requested"
    /// ORION finished something that was running.
    case completion = "completion"

    // -- ambient --
    /// A suggestion he can take or ignore.
    case recommendation = "recommendation"
    /// A pattern over time.
    case trend = "trend"
    /// Something ORION noticed that is worth knowing and worth nobody's evening.
    case discovery = "discovery"

    /// The level this category is delivered at.
    ///
    /// Deliberately a total switch with no `default:`. A new category that has
    /// not been assigned a level fails to compile, which is the only reliable
    /// way to make sure that decision is taken by somebody rather than
    /// defaulted into by nobody.
    public var level: NotificationLevel {
        switch self {
        case .approvalRequired, .security, .scheduleConflict, .remoteTaskFailure:
            return .immediate
        case .morningSummary, .eveningSummary, .requested, .completion:
            return .brief
        case .recommendation, .trend, .discovery:
            return .ambient
        }
    }

    /// Whether this may interrupt a focus session or Do Not Disturb.
    ///
    /// Derived, not decided again. An assistant that considers all of its own
    /// output important is one people turn off entirely, so this is true for
    /// exactly the immediate categories and nothing else.
    public var mayBreakThrough: Bool { level == .immediate }
}

// MARK: - Permission and settings

public enum NotificationPermission: String, Sendable {
    case notAsked
    case granted
    case denied
    case provisional
}

public struct NotificationSettings: Sendable, Equatable {
    public private(set) var permission: NotificationPermission = .notAsked
    public private(set) var enabled: Set<String>

    public init(enabled: Set<NotificationCategory> = Set(NotificationCategory.allCases)) {
        self.enabled = Set(enabled.map(\.rawValue))
    }

    public mutating func record(permission: NotificationPermission) {
        self.permission = permission
    }

    public mutating func setEnabled(_ category: NotificationCategory, _ on: Bool) {
        if on { enabled.insert(category.rawValue) } else { enabled.remove(category.rawValue) }
    }

    /// Security notifications cannot be switched off.
    ///
    /// A person can silence them at the OS level, which is their business. What
    /// the app must not offer is a setting that makes "a new device was paired
    /// to your account" quietly stop arriving.
    ///
    /// This gates whether a category may be DELIVERED at all. It is a separate
    /// question from `level`, which decides how — and they are kept separate on
    /// purpose, so that switching a category off cannot quietly demote an
    /// immediate item into a summary. Off means absent, not softened.
    public func mayDeliver(_ category: NotificationCategory) -> Bool {
        guard permission == .granted || permission == .provisional else { return false }
        if category == .security { return true }
        return enabled.contains(category.rawValue)
    }
}

// MARK: - An item

/// One thing worth telling somebody, and a pointer to where the truth lives.
///
/// The absence of a payload field is the design. See the note at the top of
/// this file: a push is a nudge to go and read `subject`, never the record
/// itself, because a push can be lost and a record cannot.
public struct NotificationItem: Sendable, Equatable, Identifiable {
    /// Stable across re-sends of the same event, so a duplicated push collapses.
    public let id: String
    public let category: NotificationCategory
    /// The durable record this points AT. Never empty — see `init?`.
    public let subject: String
    /// Display text. Not authoritative, and not parsed by anything.
    public let summary: String
    public let at: Date

    public var level: NotificationLevel { category.level }

    public init?(id: String, category: NotificationCategory, subject: String, summary: String, at: Date) {
        guard let id = NotificationItem.clean(id, limit: 120),
              let subject = NotificationItem.clean(subject, limit: 200),
              let summary = NotificationItem.clean(summary, limit: 1200)
        else { return nil }
        self.id = id
        self.category = category
        self.subject = subject
        self.summary = summary
        self.at = at
    }

    /// Same discipline as `scripts/orion-notify`'s `cleanText`: collapse
    /// whitespace, refuse empties, refuse anything over the limit, and refuse
    /// control characters outright — they are never meaningful in a status line
    /// and are the classic way to smuggle terminal escapes into one.
    private static func clean(_ raw: String, limit: Int) -> String? {
        let text = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if text.isEmpty { return nil }
        if text.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) { return nil }
        if text.utf8.count > limit { return nil }
        return text
    }
}

// MARK: - The plan

/// What goes out now, what waits for the next summary, and what merely sits
/// there until he looks.
public struct NotificationPlan: Sendable, Equatable {
    /// Immediate items, oldest first. Never collapsed by subject: two approvals
    /// about the same thing are two decisions, and merging them would lose one.
    public let interrupting: [NotificationItem]
    /// Brief items, oldest first, for the next morning or evening summary.
    public let nextBrief: [NotificationItem]
    /// Ambient items, collapsed to the newest per category and subject.
    public let collected: [NotificationItem]

    public var isEmpty: Bool { interrupting.isEmpty && nextBrief.isEmpty && collected.isEmpty }
}

public enum NotificationEngine {
    /// Route a set of items.
    ///
    /// Pure, total, and a function of the WHOLE list rather than of an arrival
    /// sequence. That is what makes it safe for a push to be lost, duplicated
    /// or reordered: the plan is recomputed from the records, so the transport
    /// never carries state that only exists in transit.
    ///
    /// Two collapses, and the difference between them matters:
    ///
    ///  · Every level de-duplicates by `id`, because a transport that delivers
    ///    twice must not produce two of anything.
    ///  · Only AMBIENT additionally collapses by category and subject, keeping
    ///    the newest. That is the "do not notify for every observation" rule:
    ///    an observation stream about one subject is one item.
    public static func plan(_ items: [NotificationItem]) -> NotificationPlan {
        var byID: [String: NotificationItem] = [:]
        for item in items {
            // A duplicate id is the same event arriving twice. Keep the newer
            // one so a corrected re-send wins, and break an exact tie by id so
            // the result cannot depend on arrival order.
            if let existing = byID[item.id], !isNewer(item, than: existing) { continue }
            byID[item.id] = item
        }
        let unique = byID.values.sorted(by: ordered)

        var newestBySubject: [String: NotificationItem] = [:]
        for item in unique where item.level == .ambient {
            let key = "\(item.category.rawValue)\u{1}\(item.subject)"
            if let existing = newestBySubject[key], !isNewer(item, than: existing) { continue }
            newestBySubject[key] = item
        }

        return NotificationPlan(
            interrupting: unique.filter { $0.level == .immediate },
            nextBrief: unique.filter { $0.level == .brief },
            collected: newestBySubject.values.sorted(by: ordered)
        )
    }

    /// Total order on items, so every list this file returns is deterministic
    /// no matter what order the items arrived in. `at` alone is not enough —
    /// two items in the same millisecond would tie, and a tie is where order
    /// dependence gets back in.
    private static func ordered(_ lhs: NotificationItem, _ rhs: NotificationItem) -> Bool {
        lhs.at == rhs.at ? lhs.id < rhs.id : lhs.at < rhs.at
    }

    private static func isNewer(_ lhs: NotificationItem, than rhs: NotificationItem) -> Bool {
        lhs.at == rhs.at ? lhs.id > rhs.id : lhs.at > rhs.at
    }
}

// MARK: - When the next brief goes out

/// The two moments a `brief` item can be delivered.
///
/// The hours MIRROR `scripts/orion-standing`, which is the thing that actually
/// runs the morning and evening checks. They are two copies of one number and
/// nothing mechanically proves they agree — recorded as a gate limitation
/// rather than left to be discovered.
public enum BriefSlot: String, Sendable, Equatable, CaseIterable {
    case morning
    case evening

    public var hour: Int {
        switch self {
        case .morning: return 8
        case .evening: return 21
        }
    }
}

extension NotificationEngine {
    /// When the next summary is due, in a given zone.
    ///
    /// Computed as a CIVIL time — "08:00 tomorrow where he is standing" — and
    /// never as an instant plus 24 hours. On the night the clocks go forward
    /// those two answers differ by an hour, and the wrong one puts the morning
    /// brief at 07:00 or 09:00 on exactly the day a person is most confused
    /// about what time it is. Same lesson as Phase 40, one layer up.
    ///
    /// The zone is injected and never read from the device, so this is
    /// answerable for somewhere he is about to be as well as somewhere he is.
    public static func nextBrief(after instant: Date, in zone: TimeZone) -> (slot: BriefSlot, at: Date)? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone

        for slot in [BriefSlot.morning, BriefSlot.evening] {
            guard let today = calendar.date(bySettingHour: slot.hour, minute: 0, second: 0,
                                            of: instant, matchingPolicy: .nextTime)
            else { return nil }
            if today > instant { return (slot, today) }
        }

        // Past the evening slot: the next one is tomorrow morning. Add a DAY,
        // then set the hour — adding 86,400 seconds and reading the clock is
        // the bug this comment exists to prevent.
        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: instant),
              let morning = calendar.date(bySettingHour: BriefSlot.morning.hour, minute: 0, second: 0,
                                          of: tomorrow, matchingPolicy: .nextTime)
        else { return nil }
        return (.morning, morning)
    }
}
