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

 And it goes to a LOCAL model. Three sentences over facts Orion has already
 computed is the definition of work that should not cost anything, and it
 happens every single morning forever. `llama3.2:3b` answers in a second or two
 and is more than enough for the job.

 The paragraph is cached per logical day, so it is written once each morning
 rather than on every window open.
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

/// Writes the paragraph, once per day, locally.
///
/// Straight to Ollama rather than through the agent — see LocalModel for the
/// measurement that settled it: 1.1s of prose versus 44s of the model trying to
/// call a tool.
final class BriefWriter: ObservableObject {

    @Published private(set) var narrative: String?
    @Published private(set) var isWriting = false

    private var wroteForDay: String?

    /// Cached per logical day. Written once each morning, not on every open.
    private static func cacheKey(_ day: LogicalDay) -> String { "orion.brief.text.\(day.key)" }

    func load(for facts: BriefFacts) {
        let key = BriefWriter.cacheKey(facts.day)
        if let cached = UserDefaults.standard.string(forKey: key), !cached.isEmpty {
            narrative = cached
            wroteForDay = facts.day.key
            return
        }
        write(facts)
    }

    private func write(_ facts: BriefFacts) {
        // Nothing to say yet. Better to show no paragraph than to have a model
        // write prose about an empty day.
        guard facts.hasHealth || !facts.events.isEmpty || !facts.dueToday.isEmpty || !facts.overdue.isEmpty else {
            return
        }
        guard !isWriting, wroteForDay != facts.day.key else { return }
        wroteForDay = facts.day.key
        isWriting = true

        let prompt = facts.prompt()
        let dayKey = facts.day.key
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var text: String?
            let started = Date()
            do {
                let raw = try LocalModel.complete(prompt: prompt)
                let cleaned = BriefWriter.tidy(raw)
                if !cleaned.isEmpty {
                    text = cleaned
                    let ms = Int(Date().timeIntervalSince(started) * 1000)
                    OrionLog.write("[brief] wrote \(cleaned.count) chars in \(ms)ms via \(LocalModel.defaultModel)")
                }
            } catch {
                // Not surfaced. The brief is complete without it, and an error
                // banner over a working screen would be noise about a thing the
                // user did not ask for.
                OrionLog.write("[brief] local model unavailable — \(error.localizedDescription)")
            }

            DispatchQueue.main.async {
                guard let self else { return }
                self.isWriting = false
                guard let text else {
                    // Let a later open try again rather than latching failure
                    // for the rest of the day.
                    self.wroteForDay = nil
                    return
                }
                self.narrative = text
                UserDefaults.standard.set(text, forKey: "orion.brief.text.\(dayKey)")
            }
        }
    }

    /// Small models like to open with "Here's your brief:" and wrap things in
    /// quotes. Strip the scaffolding rather than prompt-engineering against it
    /// forever.
    static func tidy(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        // Drop a leading label line like "Morning brief:" or "Here you go:".
        if let newline = text.firstIndex(of: "\n") {
            let first = text[text.startIndex..<newline].trimmingCharacters(in: .whitespaces)
            if first.hasSuffix(":") && first.count < 60 {
                text = String(text[text.index(after: newline)...])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        if text.hasPrefix("\"") && text.hasSuffix("\"") && text.count > 2 {
            text = String(text.dropFirst().dropLast())
        }

        // Collapse to a single paragraph: the prompt asks for prose, and a
        // stray blank line turns two sentences into two visual blocks.
        return text
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
