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

    var recovery: Int?
    var sleepPerformance: Int?
    var sleepHours: Double?
    var hrvDelta: String?
    var restingHeartRate: Int?
    var strainTarget: StrainTarget

    var events: [AgendaEvent] = []
    var committedMinutes: Int = 0
    var dueToday: [SyncedTask] = []
    var overdue: [SyncedTask] = []

    /// The next thing that has not happened yet.
    var nextEvent: AgendaEvent? {
        events.filter { !$0.isPast }.min { $0.start < $1.start }
    }

    var hasHealth: Bool { recovery != nil || sleepPerformance != nil }

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
        if let sleepPerformance {
            var sleep = "- Sleep score \(sleepPerformance)%"
            if let sleepHours { sleep += ", \(String(format: "%.1f", sleepHours))h in bed" }
            lines.append(sleep + ".")
        }
        if let recovery {
            var line = "- Recovery \(recovery)% (\(recovery >= 67 ? "green" : recovery >= 34 ? "yellow" : "red"))"
            if let hrvDelta { line += ", HRV \(hrvDelta) vs the 7-day average" }
            if let restingHeartRate { line += ", resting heart rate \(restingHeartRate)" }
            lines.append(line + ".")
            lines.append("- Suggested strain band for today: \(Int(strainTarget.low))–\(Int(strainTarget.high)).")
        }

        if events.isEmpty {
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

        if overdue.isEmpty && dueToday.isEmpty {
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
        - Tie the recovery to what is actually on his calendar today.
        - If anything is overdue, name it.
        - Never state a number that is not in the facts above.
        - No greeting, no lists, no headings, no sign-off.
        - No generic wellness advice. Nothing about stretching, hydration, \
        breathing, taking breaks or listening to your body unless it is in the \
        facts. Say something only these facts could have produced.
        """
    }
}

extension BriefFacts {
    /// One paragraph per logical day.
    var narrativeKey: String { "brief.\(day.key)" }
}
