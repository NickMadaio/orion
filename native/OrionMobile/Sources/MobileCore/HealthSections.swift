import Foundation

// PHASE 34 — the health UI, as a model rather than as a screen.
//
// The manifest names seven sections and then three questions each one has to
// answer: what happened, what does it likely mean, what should I consider
// doing. It also names two prohibitions — no medical advice, and do not
// overload the user with raw charts — and one requirement: source and
// confidence must be inspectable.
//
// Every one of those is a property of the CONTENT, not of the layout, which is
// why this file exists at all instead of the rules living in SwiftUI. A rule
// spelled out in a view is a rule that holds on the screens somebody remembered
// to apply it to. Here:
//
//   · `happened` is required and `likelyMeans` / `consider` are Optional, and
//     the initialiser REFUSES an interpretation the data cannot support. That
//     is the honest shape: at low confidence you may report an observation, and
//     you may not tell someone what it means or what to do about it.
//   · Every string goes through `ClinicalVocabulary`, which already exists and
//     already guards `HealthStateReading`. A section that cannot spell a
//     diagnosis cannot deliver one.
//   · `sources` and `confidence` are non-optional stored properties. "Make
//     source and confidence inspectable" implemented as two fields somebody can
//     leave nil is a promise that lapses the first time anyone is in a hurry —
//     the same reasoning `HealthStateReading` already applies to its four.
//   · "Do not overload with raw charts" becomes `figureBudget`: a hard cap on
//     how many NUMBERS a section's prose may contain, counted the way
//     run-health-firewall-test.sh counts them. Rewording around the cap is
//     still a failure, because the cap is on digits and not on phrasing.
//
// What this file deliberately does NOT do is decide colours, spacing or order
// on screen. That is the app's job, and the app may show fewer sections than
// exist. It may not invent one, because `HealthSection` is a closed enum.

// MARK: - The sections

/// The seven the manifest names, in the order it names them.
///
/// A closed enum rather than strings, so the set is checkable. `allCases.count`
/// is deliberately never the assertion anywhere — a count passed once in this
/// codebase after two members were swapped for two others.
public enum HealthSection: String, CaseIterable, Sendable {
    case today
    case sleep
    case recovery
    case activity
    case energy
    case trends
    case journal

    /// What a person sees at the top of the section.
    public var title: String {
        switch self {
        case .today: return "Today"
        case .sleep: return "Sleep"
        case .recovery: return "Recovery"
        case .activity: return "Activity"
        case .energy: return "Energy"
        case .trends: return "Trends"
        case .journal: return "Journal"
        }
    }
}

// MARK: - Where a number came from

/// The origin of the measurements behind a section.
///
/// Named sources rather than a free string, because "inspectable" means a
/// person can ask where a claim came from and get the same answer every time.
/// A free-text provenance field drifts into prose and stops being comparable.
public enum HealthSource: String, CaseIterable, Sendable {
    /// The Whoop strap, through `WhoopClient`.
    case whoop
    /// Typed in by Nick — water, supplements, journal entries.
    case manual
    /// Apple Health. Not connected yet; the case exists so the vocabulary does
    /// not have to change when it is, and `RefusingHealthStore` is why.
    case appleHealth = "apple_health"
    /// Computed from other sources rather than measured. A baseline is derived;
    /// a heart rate is not.
    case derived

    public var label: String {
        switch self {
        case .whoop: return "Whoop"
        case .manual: return "entered by you"
        case .appleHealth: return "Apple Health"
        case .derived: return "computed from your history"
        }
    }
}

// MARK: - The three questions

/// One section's content: the manifest's three questions, with the second and
/// third allowed to be absent.
///
/// The asymmetry is the point. "What happened" is an observation and is almost
/// always available. "What does it likely mean" is an inference and "what
/// should I consider doing" is a suggestion, and both of those require enough
/// data to be worth making. `SectionNarrative` refuses to hold an inference
/// when the confidence behind it is `.low`, so the UI cannot render one by
/// accident and no reviewer has to remember the rule.
public struct SectionNarrative: Sendable, Equatable {

    /// What happened. Observations only.
    public let happened: String

    /// What it likely means. Nil when the data cannot support an inference.
    public let likelyMeans: String?

    /// What to consider doing. Nil when there is nothing honest to suggest.
    ///
    /// Never an instruction, and never about medication, treatment or therapy —
    /// `ClinicalVocabulary` refuses all three words, so "do not create medical
    /// advice features" is enforced on the text rather than asserted in a
    /// comment.
    public let consider: String?

    /// Every source behind the claims above. Never empty: a section with no
    /// source is a section making things up.
    public let sources: [HealthSource]

    /// The weakest confidence among the inputs. Never an average — averaging
    /// lets a solid input hide a provisional one, which is the reasoning
    /// `HealthState.dataConfidence` already applies.
    public let confidence: BaselineConfidence

    /// How many figures the prose of one section may contain.
    ///
    /// Three, because a section is allowed to say "you slept 6h20, about an
    /// hour below your usual 7h15" and is not allowed to become a table. The
    /// prohibition in the manifest is "do not overload users with raw charts";
    /// a wall of numbers in prose is the same overload with the chart removed,
    /// so the budget is on digits and cannot be reworded around.
    public static let figureBudget = 3

    public init?(
        happened: String,
        likelyMeans: String? = nil,
        consider: String? = nil,
        sources: [HealthSource],
        confidence: BaselineConfidence
    ) {
        let observation = happened.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !observation.isEmpty else { return nil }
        guard !sources.isEmpty else { return nil }

        let inference = likelyMeans?.trimmingCharacters(in: .whitespacesAndNewlines)
        let suggestion = consider?.trimmingCharacters(in: .whitespacesAndNewlines)

        // An empty string is not an absent one. Distinguishing them matters:
        // "" would render as a heading with nothing under it, which reads as a
        // failure rather than as "I do not know".
        let cleanedInference = (inference?.isEmpty ?? true) ? nil : inference
        let cleanedSuggestion = (suggestion?.isEmpty ?? true) ? nil : suggestion

        // Low confidence may observe. It may not interpret, and it may not
        // advise. This is the whole difference between a health UI that is
        // useful and one that is confidently wrong at somebody.
        if confidence == .low && (cleanedInference != nil || cleanedSuggestion != nil) {
            return nil
        }

        for text in [observation, cleanedInference, cleanedSuggestion].compactMap({ $0 }) {
            guard !ClinicalVocabulary.contaminates(text) else { return nil }
            guard SectionNarrative.figureCount(in: text) <= SectionNarrative.figureBudget else {
                return nil
            }
        }

        self.happened = observation
        self.likelyMeans = cleanedInference
        self.consider = cleanedSuggestion
        self.sources = sources
        self.confidence = confidence
    }

    /// Distinct figures in a string, counted the way the health firewall counts
    /// them: pull every run of digits out and look at how many there are.
    ///
    /// A decimal point and a colon are part of the same figure — "6.5" and
    /// "6:20" are each one number a person reads, not two — because otherwise
    /// the budget punishes writing a time correctly.
    public static func figureCount(in text: String) -> Int {
        var count = 0
        var insideFigure = false
        var previous: Character?
        for character in text {
            if character.isNumber {
                if !insideFigure { count += 1 }
                insideFigure = true
            } else if (character == "." || character == ":" || character == ","),
                      insideFigure, previous?.isNumber == true {
                // Stay inside the figure; the next digit continues it.
            } else {
                insideFigure = false
            }
            previous = character
        }
        return count
    }
}

// MARK: - A section, assembled

/// One section as the UI receives it.
public struct HealthSectionContent: Sendable, Equatable {
    public let section: HealthSection
    public let narrative: SectionNarrative

    public init(section: HealthSection, narrative: SectionNarrative) {
        self.section = section
        self.narrative = narrative
    }

    public var title: String { section.title }
}

// MARK: - Trends

/// A summarised series, which is what the Trends section shows instead of a
/// chart of everything.
///
/// `points` is capped and the cap is enforced in the initialiser rather than by
/// the caller slicing. The direction is carried separately so the UI can say
/// "steadier than last month" without the reader having to infer it from a
/// shape — which is the actual failure "do not overload users with raw charts"
/// names. A chart is not forbidden; making the person do the reading is.
public struct HealthTrend: Sendable, Equatable {

    public enum Direction: String, Sendable, CaseIterable {
        case improving, steady, declining, unclear
    }

    /// Deliberately small. Fourteen points is a fortnight at one per day, which
    /// a person can take in at a glance; ninety is a chart they will not read.
    public static let maximumPoints = 14

    public let kind: BaselineKind
    public let direction: Direction
    public let points: [Double]
    public let span: Int
    public let confidence: BaselineConfidence

    public init?(
        kind: BaselineKind,
        direction: Direction,
        points: [Double],
        span: Int,
        confidence: BaselineConfidence
    ) {
        guard span > 0 else { return nil }
        guard points.count <= HealthTrend.maximumPoints else { return nil }
        guard points.allSatisfy({ $0.isFinite }) else { return nil }
        // A direction is a claim. At low confidence the only honest one is that
        // there is not enough here to say.
        if confidence == .low && direction != .unclear { return nil }
        self.kind = kind
        self.direction = direction
        self.points = points
        self.span = span
        self.confidence = confidence
    }
}
