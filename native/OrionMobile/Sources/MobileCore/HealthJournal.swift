import Foundation

// PHASE 35 — the natural-language health journal.
//
// "Had caffeine around 5." "Worked out late." "Feeling sick." "Really stressed
// today." Four sentences a person types, out of which come structured events
// carrying event_type, time, source, confidence and notes.
//
// ## Why this does not ask a model
//
// It could. It deliberately does not, and the reasoning is already in this
// codebase: `orion-standing` keeps an explicit vocabulary rather than asking a
// model because "this runs on a timer, and a rule that can be read is a rule
// that can be corrected when it nags about the wrong thing." A journal is worse
// than a timer — it is the input to Phase 36's correlations, so a silent
// misreading does not merely annoy, it fabricates a finding. Deterministic
// extraction can be shown to a person, argued with, and corrected. A model's
// guess about whether "I was wrecked" means exhaustion or intoxication cannot.
//
// The escape hatch is `.note`: anything unrecognised is kept verbatim as a note
// rather than being forced into a category. An extractor that must classify
// everything classifies things wrongly.
//
// ## The vocabulary rule, which cuts the opposite way here
//
// `ClinicalVocabulary` is checked against ORION's OWN words — its enum cases and
// the sentences it writes. It is emphatically NOT a filter on what Nick types.
// If he writes "my anxiety was bad today" that is his sentence about his own
// life and it is stored exactly as written; refusing it would be a journal that
// argues with its author.
//
// So the rule is asymmetric and the asymmetry is the point:
//
//   · `JournalEventType` case names may not be clinical. "Feeling sick" becomes
//     `.unwell`, not `.illness` — and that is not a stylistic preference, it is
//     enforced: `illness` is in the forbidden list and a case named that would
//     fail the check below.
//   · `notes` is never filtered, never rewritten, never truncated.
//
// ## Time, and when to ask
//
// "around 5" has no meridiem. The rule is that people journal about things that
// already happened, so a bare hour resolves to its most recent past occurrence.
// If that lands more than `staleAfterHours` ago the entry is ambiguous enough to
// be worth one question — and only then. "Ask for clarification only when
// necessary" implemented as "ask whenever unsure" is a form that interrogates.

// MARK: - What kind of thing happened

/// The categories the extractor can assign.
///
/// Every case name is checked against `ClinicalVocabulary` by
/// `JournalExtractor.vocabularyIsClean`, so this enum cannot grow a diagnosis.
public enum JournalEventType: String, CaseIterable, Sendable {
    case caffeine
    case alcohol
    case exercise
    case meal
    case stress
    /// "Feeling sick", "under the weather". Named `unwell` because `illness` is
    /// a forbidden clinical term — the guard is real, not decorative.
    case unwell
    case travel
    case screen
    case social
    /// Recognised as a journal entry, not as a category. The escape hatch.
    case note
}

/// Where a stored event came from.
public enum JournalSource: String, CaseIterable, Sendable {
    /// Extracted from something Nick typed.
    case extracted
    /// Nick corrected an extraction. Outranks `extracted` — see `correcting`.
    case correction
    /// Derived from another subsystem rather than typed.
    case inferred
}

/// How sure the extractor is about the CATEGORY, which is separate from how
/// sure it is about the time.
public enum JournalConfidence: String, CaseIterable, Sendable, Comparable {
    case low, medium, high

    private var rank: Int {
        switch self {
        case .low: return 0
        case .medium: return 1
        case .high: return 2
        }
    }

    public static func < (a: JournalConfidence, b: JournalConfidence) -> Bool {
        a.rank < b.rank
    }
}

// MARK: - The stored event

/// One journal event — the five fields the manifest names, and nothing else.
public struct JournalEvent: Sendable, Equatable, Identifiable {

    public let id: String
    public let eventType: JournalEventType
    /// When the thing happened, not when it was typed.
    public let time: Date
    public let source: JournalSource
    public let confidence: JournalConfidence
    /// Nick's words. Stored verbatim.
    public let notes: String
    /// What was typed, kept even after a correction so the correction is
    /// reviewable. Without it a corrected event looks like one that was always
    /// right, and Phase 36 cannot tell a confirmed observation from a guess.
    public let originalText: String

    public init?(
        id: String,
        eventType: JournalEventType,
        time: Date,
        source: JournalSource,
        confidence: JournalConfidence,
        notes: String,
        originalText: String? = nil
    ) {
        let trimmedID = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedID.isEmpty else { return nil }
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedNotes.isEmpty else { return nil }
        self.id = trimmedID
        self.eventType = eventType
        self.time = time
        self.source = source
        self.confidence = confidence
        self.notes = trimmedNotes
        self.originalText = originalText ?? trimmedNotes
    }

    /// A corrected copy.
    ///
    /// A correction is always `.high` confidence and always `source:
    /// .correction`, because the person who was there has said what happened.
    /// `originalText` survives, so "Orion guessed exercise, Nick said travel"
    /// stays visible rather than being flattened into "travel".
    ///
    /// This is a method rather than a free-standing initialiser call on purpose:
    /// "a second constructor is a second door, and it is usually the unlocked
    /// one" is recorded four times in AGENTS.md. Correcting through the memberwise
    /// init would let a caller produce a `.correction` at `.low` confidence.
    public func correcting(
        eventType newType: JournalEventType? = nil,
        time newTime: Date? = nil,
        notes newNotes: String? = nil
    ) -> JournalEvent? {
        JournalEvent(
            id: id,
            eventType: newType ?? eventType,
            time: newTime ?? time,
            source: .correction,
            confidence: .high,
            notes: newNotes ?? notes,
            originalText: originalText)
    }
}

// MARK: - What the extractor produces

/// The result of reading one line.
///
/// A separate type from `JournalEvent` because an extraction can legitimately
/// produce an event AND a question about it. Collapsing the two would force the
/// caller either to discard ambiguous entries or to store them as though they
/// were certain.
public struct JournalExtraction: Sendable, Equatable {
    public let event: JournalEvent
    /// One question, asked only when the entry cannot be resolved sensibly.
    /// Nil is the normal case and the one to optimise for.
    public let clarification: String?

    public var needsClarification: Bool { clarification != nil }
}

// MARK: - Extraction

public enum JournalExtractor {

    /// Words that assert the entry is about TODAY.
    ///
    /// These are what make a clarification necessary, and working that out took
    /// a failed test. The first design asked a question whenever a bare hour
    /// resolved more than eighteen hours back — which can never happen, because
    /// `mostRecent` considers both meridiems and one of the two candidates is
    /// always within twelve hours of now. The branch was unreachable, and a
    /// clarification path that cannot fire is worse than none: it reads like
    /// the ambiguity is handled.
    ///
    /// The real signal is a CONTRADICTION. "Coffee around 5 today", typed at
    /// 4am, resolves to 5pm yesterday — the resolution and the sentence
    /// disagree about which day it was, and that is worth exactly one question.
    /// Everything else the most-recent rule gets right on its own.
    static let todayMarkers = ["today", "tonight", "this morning", "this afternoon",
                               "this evening", "just now", "earlier"]

    /// The category vocabulary, as readable data.
    ///
    /// Deliberately a table rather than a chain of `if text.contains`: the whole
    /// argument for not using a model is that the rule can be read and
    /// corrected, and a rule buried in control flow is neither.
    ///
    /// Order matters — the first matching row wins — so more specific phrases
    /// come first. "worked out" must beat "out".
    static let vocabulary: [(phrases: [String], type: JournalEventType, confidence: JournalConfidence)] = [
        (["decaf"], .note, .low),
        (["caffeine", "coffee", "espresso", "red bull", "energy drink", "matcha", "cold brew"],
         .caffeine, .high),
        (["tea"], .caffeine, .medium),
        (["alcohol", "beer", "wine", "drinks", "drinking", "hungover", "hangover"],
         .alcohol, .high),
        // "ran" and "run" no longer need a trailing space to avoid matching
        // "errand" and "runny": containsPhrase requires a word boundary.
        (["worked out", "workout", "gym", "lifted", "lifting", "ran", "running", "run",
          "cycled", "cycling", "swim", "trained", "training session", "climbed"],
         .exercise, .high),
        (["breakfast", "lunch", "dinner", "ate", "eating", "meal", "snack"], .meal, .high),
        (["stressed", "stress", "overwhelmed", "under pressure", "deadline", "wound up"],
         .stress, .high),
        (["feeling sick", "feel sick", "sick", "unwell", "under the weather", "rough",
          "nauseous", "run down", "sore throat", "fever"],
         .unwell, .high),
        (["flight", "flew", "travel", "travelling", "traveling", "jet lag", "jetlag",
          "airport", "train to", "drove to"],
         .travel, .high),
        (["screen", "doomscroll", "phone before bed", "laptop in bed", "tv late"],
         .screen, .medium),
        (["party", "friends", "dinner with", "drinks with", "went out", "saw"],
         .social, .medium),
    ]

    /// Whether `phrase` appears in `text` as a WHOLE WORD.
    ///
    /// This used to be a bare `text.contains(phrase)`, and that was a real
    /// defect rather than a tidiness problem. "ate" is a meal marker and
    /// "late" contains it, so "Really stressed and worked late" was classified
    /// as a MEAL at high category confidence -- and the meal row is checked
    /// before stress, unwell, travel, screen and social, so it won.
    /// "chocolate" and "translate" contain the "late" time marker for the same
    /// reason. The vocabulary already carried two ad-hoc patches for this same
    /// bug -- "ran " and "run " and "saw " with trailing spaces -- which is
    /// what a systemic problem looks like when it is fixed one word at a time.
    ///
    /// This file's own header says the reason for not using a model here is
    /// that "a silent misreading does not merely annoy, it fabricates a
    /// finding". Phase 36 consumes these categories directly, so a misread
    /// entry becomes a correlation about the wrong behaviour.
    public static func containsPhrase(_ text: String, _ phrase: String) -> Bool {
        let needle = phrase.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return false }
        var from = text.startIndex
        while let found = text.range(of: needle, range: from..<text.endIndex) {
            let openBefore = found.lowerBound == text.startIndex
                || !isWordCharacter(text[text.index(before: found.lowerBound)])
            if openBefore && endsCleanly(text, after: found.upperBound) { return true }
            guard found.lowerBound < text.endIndex else { break }
            from = text.index(after: found.lowerBound)
        }
        return false
    }

    /// A match may end at a word boundary, or carry one ordinary inflection.
    ///
    /// Both halves are load-bearing and pull in opposite directions. Requiring
    /// a hard boundary at the end broke "Had 2 coffees" -- "coffee" no longer
    /// matched -- and allowing anything at the end brings back a milder version
    /// of the original bug, where "ran" matches "ranch" and "run" matches
    /// "runny". That is exactly why the vocabulary used to carry `"ran "` and
    /// `"run "` with trailing spaces. A short closed list of suffixes keeps the
    /// plurals and refuses the accidents.
    private static let inflections = ["s", "es", "ed", "ing", "'s"]

    private static func endsCleanly(_ text: String, after end: String.Index) -> Bool {
        if end == text.endIndex || !isWordCharacter(text[end]) { return true }
        let tail = text[end...]
        return inflections.contains { suffix in
            tail.hasPrefix(suffix)
                && (tail.count == suffix.count
                    || !isWordCharacter(tail[tail.index(tail.startIndex, offsetBy: suffix.count)]))
        }
    }

    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }

    /// Words that move an event earlier or later when no clock time is given.
    static let lateMarkers = ["late", "before bed", "midnight", "after midnight", "tonight"]
    static let morningMarkers = ["this morning", "at breakfast", "first thing", "when i woke"]

    /// Whether ORION's own category names are free of clinical terms.
    ///
    /// Checked as a function so the assertion is over the LIVE enum rather than
    /// over a list somebody remembered to update. `allCases` makes adding a case
    /// named `.insomnia` fail rather than ship.
    public static func vocabularyIsClean() -> Bool {
        JournalEventType.allCases.allSatisfy { !ClinicalVocabulary.contaminates($0.rawValue) }
    }

    /// Read one line.
    ///
    /// `now` is injected. An extractor that reads the clock cannot be tested
    /// against "around 5" typed at four different hours, which is the entire
    /// interesting part.
    public static func extract(
        _ text: String,
        now: Date,
        calendar: Calendar = Calendar(identifier: .gregorian),
        id: String
    ) -> JournalExtraction? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let lowered = trimmed.lowercased()

        let match = vocabulary.first { row in
            row.phrases.contains { containsPhrase(lowered, $0) }
        }
        let type = match?.type ?? .note
        // An unrecognised line is a real entry at low confidence, not a
        // discarded one. Nick wrote it; it goes in.
        let categoryConfidence = match?.confidence ?? .low

        let resolved = resolveTime(lowered, now: now, calendar: calendar)

        guard let event = JournalEvent(
            id: id, eventType: type, time: resolved.time,
            source: .extracted,
            // The stored confidence is the WEAKEST of the two, never an
            // average: a confident category at a guessed time is a guess.
            // `HealthState.dataConfidence` already applies this reasoning.
            confidence: min(categoryConfidence, resolved.confidence),
            notes: trimmed, originalText: trimmed)
        else { return nil }

        return JournalExtraction(event: event, clarification: resolved.question)
    }

    // MARK: Time

    struct ResolvedTime {
        let time: Date
        let confidence: JournalConfidence
        let question: String?
    }

    /// Work out when the thing happened.
    ///
    /// Three cases, in order of how much the text actually said:
    ///   · an explicit hour ("around 5", "at 21:30") -> resolve backwards
    ///   · a part-of-day marker ("late", "this morning") -> a sensible hour
    ///   · nothing -> now, at reduced confidence, with no question. "Really
    ///     stressed today" does not need an interrogation about the minute.
    static func resolveTime(
        _ lowered: String, now: Date, calendar: Calendar
    ) -> ResolvedTime {
        if let hour = explicitHour(lowered) {
            let resolved = mostRecent(hour: hour.value, minute: hour.minute,
                                      before: now, calendar: calendar,
                                      tryBothMeridiems: !hour.unambiguous)
            // The sentence claims today; the clock says it was yesterday. That
            // is the one case a person can settle and the extractor cannot.
            if contradictsToday(lowered, resolved, now: now, calendar: calendar) {
                return ResolvedTime(
                    time: resolved, confidence: .low,
                    question: "You wrote \"today\" but that time reads as yesterday — "
                        + "was it \(hour.value) in the morning or the evening?")
            }
            // An explicit 24-hour reading or meridiem is unambiguous; a bare
            // 1-12 resolved by the most-recent rule is merely probable.
            return ResolvedTime(time: resolved,
                                confidence: hour.unambiguous ? .high : .medium,
                                question: nil)
        }

        if lateMarkers.contains(where: { containsPhrase(lowered, $0) }) {
            let resolved = mostRecent(hour: 22, minute: 0, before: now, calendar: calendar)
            if contradictsToday(lowered, resolved, now: now, calendar: calendar) {
                return ResolvedTime(
                    time: resolved, confidence: .low,
                    question: "You wrote \"today\" but the most recent late evening was yesterday — "
                        + "did you mean last night?")
            }
            return ResolvedTime(time: resolved, confidence: .medium, question: nil)
        }
        if morningMarkers.contains(where: { containsPhrase(lowered, $0) }) {
            let resolved = mostRecent(hour: 8, minute: 0, before: now, calendar: calendar)
            if contradictsToday(lowered, resolved, now: now, calendar: calendar) {
                return ResolvedTime(
                    time: resolved, confidence: .low,
                    question: "You wrote \"today\" but this morning has not happened yet — "
                        + "did you mean yesterday morning?")
            }
            return ResolvedTime(time: resolved, confidence: .medium, question: nil)
        }
        return ResolvedTime(time: now, confidence: .low, question: nil)
    }

    /// The sentence claims today and the clock landed on another day.
    ///
    /// The one case a person can settle and the extractor cannot. It used to be
    /// written inline inside the explicit-hour branch ONLY, so the gate's claim
    /// that this is the single trigger was broader than the code: "Worked out
    /// late today" resolved to yesterday at 22:00 and asked nothing, because
    /// `mostRecent` walks backwards and the marker paths never compared the
    /// result against what the sentence said. Hoisted so all three paths share
    /// one rule, which is what the record already described.
    /// (Independent review, 2026-09-02.)
    static func contradictsToday(
        _ lowered: String, _ resolved: Date, now: Date, calendar: Calendar
    ) -> Bool {
        todayMarkers.contains { containsPhrase(lowered, $0) }
            && !calendar.isDate(resolved, inSameDayAs: now)
    }

    public struct Hour { public let value: Int; public let minute: Int; public let unambiguous: Bool }

    /// Pull a clock reading out of the text.
    ///
    /// Handles "5", "5pm", "17:30", "half five" is deliberately NOT handled —
    /// guessing at idiom is how an extractor becomes unpredictable, and `.note`
    /// plus a low confidence is the honest outcome for anything else.
    public static func explicitHour(_ lowered: String) -> Hour? {
        // 24-hour or explicit minutes first: "17:30", "at 21:00".
        if let range = lowered.range(of: #"\b([01]?\d|2[0-3]):([0-5]\d)\b"#, options: .regularExpression) {
            let parts = lowered[range].split(separator: ":")
            if let h = Int(parts[0]), let m = Int(parts[1]) {
                return Hour(value: h, minute: m, unambiguous: h > 12 || h == 0)
            }
        }
        // "5pm" / "5 pm" / "11am"
        if let range = lowered.range(of: #"\b(1[0-2]|0?[1-9])\s?(am|pm)\b"#, options: .regularExpression) {
            let text = lowered[range]
            let isPM = text.contains("pm")
            let digits = text.filter(\.isNumber)
            if let h = Int(digits) {
                let hour = isPM ? (h == 12 ? 12 : h + 12) : (h == 12 ? 0 : h)
                return Hour(value: hour, minute: 0, unambiguous: true)
            }
        }
        // A bare hour, only when introduced by a time word. Without that guard
        // "had 2 coffees" resolves to two o'clock, which is the kind of quiet
        // nonsense that poisons Phase 36.
        if let range = lowered.range(
            of: #"\b(around|about|at|near|by)\s+(1[0-2]|0?[1-9])\b"#,
            options: .regularExpression
        ) {
            let digits = lowered[range].filter(\.isNumber)
            if let h = Int(digits) {
                return Hour(value: h, minute: 0, unambiguous: false)
            }
        }
        return nil
    }

    /// The most recent occurrence of a wall-clock time at or before `before`.
    ///
    /// `tryBothMeridiems` is what makes "around 5" at 9pm mean this afternoon
    /// rather than this morning — and it is a PARAMETER rather than a rule
    /// applied to every hour, which took a failed test to get right.
    ///
    /// The first version applied the both-meridiems search unconditionally. So
    /// "Big breakfast this morning", which the marker table resolves to 8, was
    /// re-read as a choice between 08:00 and 20:00 and came back as **8pm**.
    /// The meridiem was already known and the function overrode it. Only a bare
    /// 1-12 with no meridiem and no context is genuinely ambiguous; everything
    /// else has already been decided by the time it gets here.
    public static func mostRecent(
        hour: Int, minute: Int, before: Date, calendar: Calendar,
        tryBothMeridiems: Bool = false
    ) -> Date {
        var candidates: [Date] = []
        let hours = (tryBothMeridiems && hour <= 12)
            ? [hour, hour + 12].filter { $0 < 24 }
            : [hour]
        for candidate in hours {
            guard let today = calendar.date(
                bySettingHour: candidate, minute: minute, second: 0, of: before
            ) else { continue }
            candidates.append(today <= before
                ? today
                : calendar.date(byAdding: .day, value: -1, to: today) ?? today)
        }
        // The latest one that is still in the past.
        return candidates.filter { $0 <= before }.max() ?? before
    }
}
