import Combine
import Foundation

/*
 The brief renders a factual summary without a model. A local model can choose
 one supported detail to highlight, but its prose never reaches the view.
 Source dates, calendar coverage and task scope remain explicit. NarrativeWriter
 caches only the selection; BriefNarrative validates it against current facts.
*/

/// Everything the brief knows, gathered before anything is rendered or written.
struct BriefFacts: Equatable {
    var day: LogicalDay
    var clock: BriefClock = BriefClock(now: Date())
    var wokeAt: Date?

    /// Phase 33: the model receives only derived categories and provenance,
    /// through BriefHealth's factual details. Raw measurements stay on the card.
    var signal: PlanningSignal = PlanningSignal()
    var healthHighlights: [BriefHighlight] = []

    /// Raw readings for the CARD ONLY. The ring meter and the figures beside it
    /// are Nick looking at his own numbers on his own machine, which is not a
    /// subsystem and is not what Phase 33 restricts.
    ///
    /// Nested rather than flat so the separation is visible at every use site:
    /// `facts.readings.recovery` in a view is correct, and the same expression
    /// inside `prompt()` is obviously wrong. `prompt()` does not mention
    /// `readings` at all, and the firewall test asserts that numerically rather
    /// than trusting it.
    struct Readings: Equatable {
        var recovery: Int?
        var sleepPerformance: Int?
        var sleepHours: Double?
        var hrvDelta: String?
        var restingHeartRate: Int?
        var strainTarget: StrainTarget = StrainTarget.forRecovery(nil)
    }
    var readings = Readings()

    var events: [AgendaEvent] = []
    var committedMinutes: Int = 0
    var dueToday: [SyncedTask] = []
    var overdue: [SyncedTask] = []
    var openTaskCount: Int?

    /// Whether those two lists mean anything yet.
    ///
    /// An empty `events` array has two completely different causes — a clear day,
    /// or no Calendar permission — and saying "nothing scheduled" for the second
    /// one is not an optimistic reading, it is a made-up fact. Nick would act on
    /// it. The same goes for tasks. Keep the distinction all the way into the
    /// prompt so the model cannot flatten it either.
    var calendarConnected: Bool = true
    var tasksConnected: Bool = true

    /// The next thing that has not happened yet.
    var nextEvent: AgendaEvent? {
        events.filter { $0.end > clock.now }.min { $0.start < $1.start }
    }

    var hasHealth: Bool { signal.hasAnything }

    /// Whether there is anything worth showing at all. A parked card with no
    /// numbers, no next event and nothing due is a button that opens an empty
    /// page, so it should not be on screen.
    var hasAnything: Bool {
        hasHealth || !events.isEmpty || !dueToday.isEmpty || !overdue.isEmpty
    }

    /// How to greet, given when the day actually started rather than what the
    /// clock says. Opening Orion for the first time at 3pm is still the start
    /// of your day, and "Good morning" would be wrong twice over.
    var salutation: String { clock.salutation }

    /// A constrained emphasis request; raw model prose is never rendered.
    func prompt() -> String { narrative.prompt }

}

extension BriefFacts {
    /// The versioned choice cache excludes the old freeform paragraphs. Semantic
    /// changes invalidate a selection; the visible clock is rendered afresh.
    var narrativeKey: String { narrative.key }
}
