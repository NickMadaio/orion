import Foundation
import MobileCore

// PHASE 34 — the health sections, asserted against the REAL producer.
//
// Compiled from Sources/Orion/HealthSectionsModel.swift and PlanningSignal.swift,
// so what is checked is what the tab renders. The rules themselves live in
// MobileCore and are checked there; this file is about what the producer
// actually emits when handed a day, which is the half a stand-in cannot test.
//
// AGENTS.md: "A consumer's tests must run over what the producer actually
// emits." Phase 32's fixtures were hand-built and left 23 of 42 guards
// unenforced, so every narrative below comes from calling the producer.

var failures: [String] = []
var checked = 0

func expect(_ condition: @autoclosure () -> Bool, _ what: String) {
    checked += 1
    if !condition() { failures.append(what) }
}

func section(_ name: String) { print("\n\(name)") }

/// A day with everything present and enough history to interpret it.
let goodDay = HealthSectionsModel(inputs: .init(
    recovery: 71, sleepPerformance: 88, sleepHours: 7.5, hrv: 108, restingHeartRate: 52,
    strain: 11.4, calories: 1_850, calorieTarget: 2_200, waterBottles: 5, waterTarget: 9,
    sampleCount: 41, readingAgeHours: 2,
    recentSleepHours: [7.5, 7.2, 8.0, 6.9, 7.1, 7.4, 7.8, 6.6, 7.0, 7.3],
    recentRecovery: [71, 63, 80, 44, 58, 66, 74, 39, 55, 61],
    journalEntryCount: 2))

/// The same day with only two nights behind it — the low-confidence case.
let thinHistory = HealthSectionsModel(inputs: .init(
    recovery: 71, sleepPerformance: 88, sleepHours: 7.5, strain: 11.4,
    sampleCount: 2, readingAgeHours: 2,
    recentSleepHours: [7.5, 7.2], recentRecovery: [71, 63]))

/// Nothing synced. The case that must NOT make sections disappear.
let emptyDay = HealthSectionsModel(inputs: .init(sampleCount: 41, readingAgeHours: 40))

// -- all seven, always ------------------------------------------------------

section("the seven sections exist whatever the data says")

for (label, model) in [("a full day", goodDay), ("two nights of history", thinHistory),
                       ("nothing synced at all", emptyDay)] {
    let produced = model.sections()
    expect(produced.count == HealthSection.allCases.count,
           "\(label): all seven sections are produced")
    expect(produced.map(\.section) == HealthSection.allCases,
           "\(label): in the manifest's order")
    expect(produced.allSatisfy { !$0.narrative.happened.isEmpty },
           "\(label): every section says what happened")
    expect(produced.allSatisfy { !$0.narrative.sources.isEmpty },
           "\(label): every section names at least one source")
}

// -- the three questions ----------------------------------------------------

section("what happened / what it means / what to consider")

let rich = goodDay.sections()
expect(rich.contains { $0.narrative.likelyMeans != nil },
       "a full day with real history produces interpretations")
expect(rich.contains { $0.narrative.consider != nil },
       "and suggestions")
expect(rich.allSatisfy { $0.narrative.confidence == .high },
       "41 samples is high confidence, per Phase 31's ladder")

// The load-bearing asymmetry, checked on the REAL output rather than on the
// type: two nights may report, and may not interpret.
let thin = thinHistory.sections()
expect(thin.allSatisfy { $0.narrative.confidence == .low },
       "two samples is low confidence")
expect(thin.allSatisfy { $0.narrative.likelyMeans == nil },
       "low confidence produces NO interpretation anywhere in the tab")
expect(thin.allSatisfy { $0.narrative.consider == nil },
       "and no advice anywhere in the tab")
expect(thin.allSatisfy { !$0.narrative.happened.isEmpty },
       "but every section still says what happened -- it does not go blank")

// -- missing data is reported, not hidden -----------------------------------

section("an absent reading is said out loud")

let empty = emptyDay.sections()

// Returns nil rather than force-unwrapping. A missing section is exactly the
// defect this block exists to catch, and a harness that CRASHES on it reports
// "Trace/BPT trap: 5" instead of naming the section -- and dies before the
// later checks run. Found by mutation: deleting the recovery fallback killed
// the process rather than failing an assertion.
func narrative(_ s: HealthSection, in list: [HealthSectionContent]) -> SectionNarrative? {
    list.first { $0.section == s }?.narrative
}
expect(narrative(.recovery, in: empty).map {
        $0.happened.lowercased().contains("not come in") || $0.happened.lowercased().contains("sync")
       } == true,
       "a missing recovery says the strap did not sync rather than showing a zero")
expect(narrative(.sleep, in: empty)?.happened.lowercased().contains("no sleep") == true,
       "a missing night says so")
expect(!empty.contains { $0.narrative.happened.contains(" 0") },
       "and nothing anywhere reports a missing reading as zero")

// -- no medical advice, over the real text ----------------------------------

section("no clinical vocabulary survives into any section")

for (label, model) in [("full", goodDay), ("thin", thinHistory), ("empty", emptyDay)] {
    for content in model.sections() {
        let all = [content.narrative.happened, content.narrative.likelyMeans ?? "",
                   content.narrative.consider ?? ""].joined(separator: " ")
        expect(!ClinicalVocabulary.contaminates(all),
               "\(label)/\(content.section.rawValue): no clinical term")
    }
}

// -- the figure budget, over the real text ----------------------------------

section("no section becomes a table")

// The rule lives in SectionNarrative.init?, so that is where it is tested. The
// sweep below cannot fail on its own -- an over-budget narrative is nil and has
// already been compactMap'd out of `sections()` before the loop sees it, so it
// asserts a tautology. (Independent review, 2026-09-02.) It is kept as a
// regression over the REAL generated text, which is a genuinely weaker claim
// than it used to look, with the actual rule pinned here first.
expect(SectionNarrative(happened: "Recovery 41%, HRV 38 ms, RHR 62 bpm, strain 14.",
                        sources: [.whoop], confidence: .high) == nil,
       "four figures in one field is refused outright -- the budget is \(SectionNarrative.figureBudget)")
expect(SectionNarrative(happened: "Recovery 41%, HRV 38 ms, RHR 62 bpm.",
                        sources: [.whoop], confidence: .high) != nil,
       "and three is allowed, so the cap is a boundary and not a ban on numbers")
expect(SectionNarrative(happened: "Recovery is low.",
                        likelyMeans: "HRV 38 ms, RHR 62 bpm, sleep 71%, strain 14.",
                        sources: [.whoop], confidence: .high) == nil,
       "and the budget applies per field, not only to the first one")

for (label, model) in [("full", goodDay), ("thin", thinHistory), ("empty", emptyDay)] {
    for content in model.sections() {
        for (field, text) in [("happened", content.narrative.happened),
                              ("likelyMeans", content.narrative.likelyMeans ?? ""),
                              ("consider", content.narrative.consider ?? "")] {
            let figures = SectionNarrative.figureCount(in: text)
            expect(figures <= SectionNarrative.figureBudget,
                   "\(label)/\(content.section.rawValue).\(field): \(figures) figures is over budget")
        }
    }
}

// A positive: the tab is not passing the budget by saying nothing. Somewhere in
// a full day, real numbers must reach the person -- that is what the tab is for,
// and Phase 33 explicitly permits it here.
let allFullText = goodDay.sections().map {
    [$0.narrative.happened, $0.narrative.likelyMeans ?? "", $0.narrative.consider ?? ""]
        .joined(separator: " ")
}.joined(separator: " ")
expect(allFullText.contains("71"), "the recovery number reaches the person who owns it")
expect(allFullText.contains("7h30"), "and so does last night's duration")

// -- formatting -------------------------------------------------------------

section("figures a person reads")

expect(HealthSectionsModel.hours(7.5) == "7h30", "7.5 hours is 7h30")
expect(HealthSectionsModel.hours(7.0) == "7h", "a whole number drops the minutes")
expect(HealthSectionsModel.hours(6.333) == "6h19", "and rounds down rather than inventing precision")
expect(HealthSectionsModel.hours(.nan) == "an unread night",
       "a non-finite duration never reaches Int(), which is a crash in Swift and not an exception")
expect(HealthSectionsModel.oneDecimal(11.44) == "11.4", "strain gets one decimal")
expect(HealthSectionsModel.oneDecimal(.infinity) == "unread", "and infinity is refused")

// -- trends -----------------------------------------------------------------

section("trends are summarised, not dumped")

let longSeries = HealthSectionsModel(inputs: .init(
    sampleCount: 41, readingAgeHours: 1,
    recentSleepHours: Array(repeating: 7.0, count: 90)))
if let trend = longSeries.trend(.sleepDuration) {
    expect(trend.points.count <= HealthTrend.maximumPoints,
           "ninety nights are truncated by the PRODUCER, not by whoever draws it")
    expect(trend.span == trend.points.count, "and the span reports what is actually shown")
} else {
    expect(false, "a long series still produces a trend")
}
expect(emptyDay.trend(.sleepDuration) == nil, "no history produces no trend rather than an empty one")

// Direction, with the ordering stated: newest first, so the FIRST half is
// recent. Getting this backwards inverts every trend on the page.
expect(HealthSectionsModel.direction([9, 9, 9, 5, 5, 5], mayInterpret: true) == .improving,
       "recent nights higher than older ones is improving")
expect(HealthSectionsModel.direction([5, 5, 5, 9, 9, 9], mayInterpret: true) == .declining,
       "and the reverse is declining -- if this pair passes both ways the ordering is unpinned")
expect(HealthSectionsModel.direction([7, 7, 7, 7, 7, 7], mayInterpret: true) == .steady,
       "no movement is steady")
expect(HealthSectionsModel.direction([9, 9, 9, 5, 5, 5], mayInterpret: false) == .unclear,
       "and low confidence cannot claim a direction at all")
expect(HealthSectionsModel.direction([9, 5], mayInterpret: true) == .unclear,
       "two points is not a trend")
expect(HealthSectionsModel.direction([0, 0, 0, 0], mayInterpret: true) == .unclear,
       "an all-zero series does not divide by zero")

// The conversion between WhoopWeek's ordering and this model's. Asserted in
// both directions, because a symmetric test passes on a function that does
// nothing.
expect(HealthSectionsModel.newestFirst([1, 2, 3]) == [3, 2, 1],
       "oldest-first becomes newest-first")
expect(HealthSectionsModel.newestFirst([1, 2, 3]) != [1, 2, 3],
       "and it is not the identity, which a palindromic fixture would not have caught")
expect(HealthSectionsModel.newestFirst([]) == [], "an empty week converts to an empty series")
expect(HealthSectionsModel.direction(HealthSectionsModel.newestFirst([5, 5, 5, 9, 9, 9]),
                                     mayInterpret: true) == .improving,
       "a week that IMPROVED oldest-to-newest reads as improving after conversion")

// -- result -----------------------------------------------------------------

print("\n\(checked) checks, \(failures.count) failed")
for failure in failures { print("  FAIL \(failure)") }
exit(failures.isEmpty ? 0 : 1)
