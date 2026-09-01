import Combine
import Foundation

/*
 The first thing Orion says each day.

 Two rules shape this file, and the second one is borrowed from `orion-daily`,
 which already learned it the hard way:

   "Deliberately NOT a model call. A summariser that needs the gateway up, a
    model warm and a network reachable is a summariser that silently stops
    running some evening and leaves a hole in the record nobody notices."

 So the brief is FACTS FIRST. Recovery, sleep, wake time, what is on the
 calendar and what is due are read from clients that already have them, and
 they render whether or not any model is reachable. The written paragraph is an
 enhancement layered on top: it appears when it arrives and is simply absent
 when it does not. There is never a spinner where a number should be.

 And it goes to a LOCAL model — see LocalModel for why straight to Ollama and
 not through the agent. NarrativeWriter owns the mechanics and the caching; this
 file owns what Orion actually knows and how it is put to the model.
*/

/// Everything the brief knows, gathered before anything is rendered or written.
struct BriefFacts: Equatable {
    var day: LogicalDay
    var wokeAt: Date?

    /// Phase 33. The brief sits next to the calendar and the task list, and the
    /// prompt asks the model to connect them -- which is Phase 38, health-aware
    /// planning. That is the right feature and it is exactly why the raw numbers
    /// must not be here: this is the prompt the firewall exists to protect.
    var signal: PlanningSignal = PlanningSignal()
    var strainAdvice: String?

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
        events.filter { !$0.isPast }.min { $0.start < $1.start }
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
    var salutation: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 4..<12: return "Good morning"
        case 12..<18: return "Here's where the day stands"
        default: return "Here's what's left of today"
        }
    }

    /// The facts, as lines a small model can follow without inventing anything.
    func prompt() -> String {
        var lines: [String] = []

        if let wokeAt {
            lines.append("- Woke at \(wokeAt.formatted(date: .omitted, time: .shortened)).")
        }
        lines.append(contentsOf: signal.promptLines())
        if let strainAdvice { lines.append("- \(strainAdvice)") }

        if !calendarConnected {
            lines.append("- Calendar: not connected, so what is scheduled is unknown.")
        } else if events.isEmpty {
            lines.append("- Calendar: nothing scheduled.")
        } else {
            let hours = committedMinutes / 60
            let minutes = committedMinutes % 60
            lines.append("- Calendar: \(events.count) event\(events.count == 1 ? "" : "s"), "
                         + "\(hours)h \(minutes)m still committed.")
            if let next = nextEvent {
                lines.append("- Next: \"\(next.title)\" at \(next.timeLabel).")
            }
        }

        if !tasksConnected {
            lines.append("- Tasks: not connected, so what is due is unknown.")
        } else if overdue.isEmpty && dueToday.isEmpty {
            lines.append("- Tasks: nothing due.")
        } else {
            if !dueToday.isEmpty {
                lines.append("- Due today: " + dueToday.prefix(4).map(\.title).joined(separator: ", ") + ".")
            }
            if !overdue.isEmpty {
                lines.append("- Overdue: " + overdue.prefix(3).map(\.title).joined(separator: ", ") + ".")
            }
        }

        return """
        You are Orion, writing Nick's daily brief. Here are today's facts:

        \(lines.joined(separator: "\n"))

        Write 2 to 3 sentences addressed to him, as one paragraph.

        Rules:
        - Tie the recovery STATE to what is actually on his calendar today. \
        This is the point of the brief: a good reading on an empty day and a \
        poor one on a full day call for different things.
        - If anything is overdue, name it.
        - State NO health numbers at all -- no heart rate, no variability, no \
        percentage, no hours slept. There are none in the facts above; do not \
        estimate, infer or invent one. Times and task counts are fine.
        - If the reading confidence is low, or it is not current, say so rather \
        than sounding certain. "I have not got a fresh reading" is a useful \
        sentence; a confident paragraph about stale numbers is not.
        - If a fact says something is not connected, say you cannot see it. \
        Never turn "not connected" into "nothing scheduled" or "nothing due".
        - No greeting, no lists, no headings, no sign-off.
        - No generic wellness advice. Nothing about stretching, hydration, \
        breathing, taking breaks or listening to your body unless it is in the \
        facts. Say something only these facts could have produced.
        """
    }
}

extension BriefFacts {
    /// One paragraph per distinct set of facts — NOT one per day.
    ///
    /// Keying by day alone is what put "sleep score 81%, recovery 55%" on screen
    /// beside tiles reading 27% and 12. The paragraph had been written earlier,
    /// before Whoop synced the night Nick actually had, and a day-shaped key gave
    /// nothing any reason to replace it. The facts are re-derived on every render
    /// and were always correct; only the prose was frozen.
    ///
    /// Digesting the prompt itself means the key tracks the facts automatically:
    /// change what the model is told and the cache entry changes with it, with
    /// nothing to keep in sync by hand. The day stays in the scope so entries
    /// remain readable and prunable.
    var narrativeKey: String { NarrativeKey.make("brief.\(day.key)", facts: prompt()) }
}
