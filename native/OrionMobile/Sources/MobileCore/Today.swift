import Foundation

/// The Today screen's content, shaped so it cannot become a metrics wall.
///
/// "Do not turn it into a giant metrics dashboard" and "prioritise state,
/// meaning, action over raw numbers" are the same instruction from two
/// directions, and both are easy to agree with and hard to keep -- a dashboard
/// becomes a metrics wall one defensible number at a time.
///
/// So it is enforced by the type: an item that is only a number cannot be
/// constructed, because `meaning` is not optional and a number is only ever
/// supporting detail.
public enum TodaySection: String, CaseIterable, Sendable {
    case summary = "ORION"
    case nextEvents = "Next"
    case priorities = "Priorities"
    case tasks = "Tasks"
    case actionInbox = "Needs you"
    case health = "Health"
    case notifications = "Worth knowing"
    case recommendations = "ORION suggests"
}

public enum TodayEmphasis: String, Sendable, CaseIterable {
    /// How things are. "You have a clear morning."
    case state
    /// What it means. "That is the only long block this week."
    case meaning
    /// What to do. "Move the review into it?"
    case action

    /// The order the manifest asks for, top to bottom.
    public var rank: Int {
        switch self {
        case .state: return 0
        case .meaning: return 1
        case .action: return 2
        }
    }
}

public struct TodayItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let emphasis: TodayEmphasis
    /// A sentence. Never empty, and never a number on its own.
    public let meaning: String
    /// Supporting detail, if a number genuinely helps. "3 events" belongs here,
    /// under a sentence, and never instead of one.
    public let detail: String?
    public let actionLabel: String?

    public init?(id: String, emphasis: TodayEmphasis, meaning: String,
                 detail: String? = nil, actionLabel: String? = nil) {
        let trimmed = meaning.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // A bare number is not meaning. This is the check that keeps the screen
        // from filling up with them.
        guard !TodayItem.isJustANumber(trimmed) else { return nil }
        self.id = id
        self.emphasis = emphasis
        self.meaning = trimmed
        self.detail = detail
        self.actionLabel = actionLabel
    }

    /// Whether this is a measurement wearing a sentence's clothes.
    ///
    /// The old version stripped "%" and "," and asked `Double(_:)`. That caught
    /// "7", "82%" and "3,000" and nothing else, so "$1,240 spent", "7:30 wake",
    /// "72 bpm" and "12/20" all constructed -- a whole section could be built out
    /// of legal TodayItems and be exactly the metrics dashboard the manifest
    /// forbids. A number becomes meaning when it sits in a clause, so the test is
    /// whether anything here is a WORD rather than whether it parses.
    static func isJustANumber(_ text: String) -> Bool {
        let symbols = CharacterSet(charactersIn: "%,$£€:/-+°")
        let cleaned = text.components(separatedBy: symbols).joined()
        let pieces = cleaned.split(whereSeparator: { $0 == " " })
        guard !pieces.isEmpty else { return true }
        // Every piece is a number or a short unit ("kg", "bpm", "am") -- so there
        // is no word carrying a meaning.
        return pieces.allSatisfy { piece in
            Double(piece) != nil || (piece.count <= 3 && piece.allSatisfy(\.isLetter))
        }
    }
}

/// Whether a section has been loaded, and if not, why not.
///
/// `TodayModel` could not express absence: a model that had never been
/// populated, one whose source was offline, and a genuinely quiet day were the
/// same value, so a view reading it rendered a confident "nothing to do" for a
/// failed load. This codebase already has the rule -- `DayScore` excludes absent
/// inputs rather than scoring them zero, and every `HealthState` dimension
/// carries an `unknown` case with a reason. Today had nowhere to put one.
public enum TodaySectionState: Sendable, Equatable {
    case notYetLoaded
    case loaded
    case unavailable(reason: String)
}

public struct TodayModel: Sendable, Equatable {
    /// A screen, not a report. Three per section and twelve overall is the point
    /// at which somebody stops reading and starts scrolling.
    public static let maxItemsPerSection = 3
    public static let maxItemsOverall = 12

    public private(set) var sections: [(section: TodaySection, items: [TodayItem])] = []
    private var states: [TodaySection: TodaySectionState] = [:]

    /// What is known about this section. Absent data stays unknown.
    public func state(of section: TodaySection) -> TodaySectionState {
        states[section] ?? .notYetLoaded
    }

    /// Record that a section could not be loaded, with a reason a person can read.
    public mutating func markUnavailable(_ section: TodaySection, reason: String) {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        states[section] = .unavailable(reason: trimmed.isEmpty ? "unknown" : trimmed)
        sections.removeAll { $0.section == section }
    }

    /// Health appears "once available". Phase 16 defers the health integration
    /// to Phase 30, so this is off, and the check asserts the section stays out
    /// while it is.
    ///
    /// (The framework's name is deliberately not written here: MobileCoreCheck
    /// greps every source for it, and the check being blunt enough to catch a
    /// comment is what makes it worth having.)
    public let healthAvailable: Bool

    public init(healthAvailable: Bool = false) {
        self.healthAvailable = healthAvailable
    }

    public static func == (left: TodayModel, right: TodayModel) -> Bool {
        left.healthAvailable == right.healthAvailable
            && left.sections.map(\.section) == right.sections.map(\.section)
            && left.sections.map(\.items) == right.sections.map(\.items)
    }

    @discardableResult
    public mutating func put(_ section: TodaySection, _ items: [TodayItem]) -> Bool {
        guard section != .health || healthAvailable else { return false }
        let kept = Array(
            items.sorted { $0.emphasis.rank < $1.emphasis.rank }.prefix(TodayModel.maxItemsPerSection)
        )
        // A section with nothing to say is omitted rather than rendered empty:
        // an empty card is a promise the screen did not keep.
        // Count what this section ALREADY holds out of the total before testing
        // the cap. Reading `total` first meant replacing a section charged its
        // old items against the ceiling, so a full twelve-item screen could
        // never be refreshed or cleared -- and sections 5-8 (Needs you, Health,
        // Worth knowing, ORION suggests) could never appear at all, because the
        // cap was first-come-first-served with no notion of which section
        // matters. The action-bearing sections were the ones starved.
        let existing = self.items(in: section).count
        guard total - existing + kept.count <= TodayModel.maxItemsOverall else { return false }
        sections.removeAll { $0.section == section }
        // An empty put CLEARS the section rather than being refused: without it
        // there was no way to remove anything, so a cancelled event stayed on
        // screen forever. It still reports false when there was nothing to clear,
        // which is what "an empty section is omitted" means.
        guard !kept.isEmpty else {
            states[section] = .loaded
            return existing > 0
        }
        sections.append((section, kept))
        states[section] = .loaded
        sections.sort { left, right in
            let order = TodaySection.allCases
            return order.firstIndex(of: left.section)! < order.firstIndex(of: right.section)!
        }
        return true
    }

    public var total: Int { sections.reduce(0) { $0 + $1.items.count } }

    public var isEmpty: Bool { sections.isEmpty }

    public func items(in section: TodaySection) -> [TodayItem] {
        sections.first { $0.section == section }?.items ?? []
    }

    /// Everything, in reading order: sections in their declared order, and
    /// within each, state before meaning before action.
    public var reading: [TodayItem] {
        sections.flatMap(\.items)
    }
}
