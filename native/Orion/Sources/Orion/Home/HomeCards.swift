import Foundation

/*
 The new Home's proactive cards (wave 12, U4, 2026-11-02). Nick: "the entire home page … the little app shortcuts?
 all gone. again model the sentientOS UI."

 Home is now a greeting and a small spread of cards, each one thing ORION noticed in data it already holds: the
 next class, what is overdue, a free stretch worth a focus block, the morning's recovery, tonight's bedtime, a
 question ORION asked that is still waiting. Nothing here is invented: every card is a fold over BriefFacts (the
 same facts the brief and the Plan read) and `HomeSignals` (files the scripts write). No data, no card; no cards,
 one calm line.

 This file is the pure part: data in, cards out. The views are HomeCardView / HomeCardSpread.
*/

/// What a card is about. One accent hue per kind (HomeCardStyle).
enum HomeCardKind: String, CaseIterable {
    case question, event, tasks, focus, project, health, finance, sleep
}

/// What a card's buttons do. Every case maps to an action the app already has; see HomeTab.perform.
enum HomeCardAction: Equatable {
    case answer(outreachID: String?)
    case openPlan
    case openBrief
    case openHealth
    /// The Projects tab, with this run selected when there is one.
    case openProject(id: String?)
    case openFinance
    case startFocus(task: String?)
    case resumeFocus
    case markDone(taskID: String)
    case ask(prefill: String)
}

struct HomeCardButton: Equatable {
    let title: String
    let action: HomeCardAction
}

struct HomeCard: Identifiable, Equatable {
    let kind: HomeCardKind
    /// The letter-spaced mono line on top, as parts ("IN 40 MIN", "CS2100", "LEAVE BY 8:45 AM").
    let kicker: [String]
    /// One short sentence in ORION's voice.
    let title: String
    /// One to three lines.
    let body: [String]
    let primary: HomeCardButton
    /// The quiet "details ›" link, when there is somewhere useful to go.
    let details: HomeCardButton?
    /// Lower comes first.
    let rank: Int

    var id: String { kind.rawValue }
    var kickerText: String { kicker.joined(separator: " · ").uppercased() }
}

/// A question ORION sent (an outreach row with an `ask`) that he has not answered yet.
struct PendingQuestion: Equatable {
    let id: String?
    let text: String
    let at: Date
}

/// The focus session, as much as Home needs of it.
struct HomeFocus: Equatable {
    var live: Bool
    var minimized: Bool
    var headline: String
    var remaining: String?
}

/// What Home knows beyond BriefFacts: read from the controlled directory by HomeSignalsReader.
struct HomeSignals: Equatable {
    var question: PendingQuestion?
    /// Only used when there is no BriefFacts clock (tests, a cold start).
    var now: Date?
    var leaveBy: Date?
    var bedtime: Date?
    var nextWake: Date?
    var focus: HomeFocus?
    var knowledgeCount: Int?
    var selfName: String?
    /// Nil when no phone link is set up at all, which is not a fault.
    var phoneLinkAlive: Bool?
    // From the other sections (HomeSections.swift); empty or nil when that section has nothing.
    var projects: [HomeProject] = []
    var finance: HomeFinance?
    /// Today's health-log row: the fallback when the brief has no WHOOP reading.
    var healthDay: HomeHealthDay?
    var focusMinutesToday: Int?
}

enum HomeCardBuilder {
    static let maxCards = 6
    /// A focus block is only worth suggesting with at least this much clear time.
    static let minimumFreeMinutes = 45
    /// An unanswered question older than this has gone stale.
    static let questionWindow: TimeInterval = 3 * 3600

    static func cards(brief: BriefFacts?, signals: HomeSignals) -> [HomeCard] {
        let clock = brief?.clock ?? BriefClock(now: signals.now ?? Date())
        let format = HomeFormat(clock: clock)
        let candidates: [HomeCard?] = [
            question(signals.question, format: format),
            brief.flatMap { event($0, leaveBy: signals.leaveBy, format: format) },
            brief.flatMap { tasks($0, format: format) },
            focus(brief: brief, live: signals.focus, leaveBy: signals.leaveBy, format: format),
            project(signals.projects, format: format),
            health(readings(brief: brief, day: signals.healthDay), format: format),
            finance(signals.finance, format: format),
            sleep(bedtime: signals.bedtime, nextWake: signals.nextWake, lastNight: readings(brief: brief, day: signals.healthDay)?.sleepHours,
                  format: format),
        ]
        let order = HomeCardKind.allCases
        return candidates.compactMap { $0 }
            .sorted { ($0.rank, order.firstIndex(of: $0.kind)!) < ($1.rank, order.firstIndex(of: $1.kind)!) }
            .prefix(maxCards)
            .map { $0 }
    }

    // MARK: Question

    private static func question(_ question: PendingQuestion?, format: HomeFormat) -> HomeCard? {
        guard let question else { return nil }
        let age = format.now.timeIntervalSince(question.at)
        guard age >= -60, age <= questionWindow else { return nil }
        return HomeCard(kind: .question, kicker: ["ORION ASKED", format.ago(age)], title: question.text,
                        body: ["Answer here and I'll take it from there."],
                        primary: HomeCardButton(title: "Answer", action: .answer(outreachID: question.id)),
                        details: nil, rank: 0)
    }

    // MARK: Event

    private static func event(_ brief: BriefFacts, leaveBy: Date?, format: HomeFormat) -> HomeCard? {
        let timed = brief.events.filter { !$0.isAllDay && $0.end > format.now }.sorted { $0.start < $1.start }
        guard let next = timed.first else { return nil }
        let short = format.shortName(next.title)
        let inProgress = next.start <= format.now
        let minutes = format.minutes(until: next.start)
        let leave = leaveBy.flatMap { $0 > format.now && $0 <= next.start && !inProgress ? $0 : nil }

        var kicker = [inProgress ? "NOW" : (minutes <= 180 ? "IN \(format.duration(minutes))" : "AT \(format.time(next.start))"), short]
        if let leave { kicker.append("LEAVE BY \(format.time(leave))") }

        let title: String
        if let leave { title = "Leave by \(format.time(leave)) for \(short)." }
        else if inProgress { title = "You're in \(short) until \(format.time(next.end))." }
        else if minutes <= 90 { title = "\(short) starts in \(minutes) minutes." }
        else { title = "\(short) is at \(format.time(next.start))." }

        var body: [String] = []
        if short != next.title { body.append("\(next.title), \(format.time(next.start))–\(format.time(next.end)).") }
        if timed.count > 1 {
            let after = timed[1]
            let more = timed.count - 2
            body.append("After that, \(after.title) at \(format.time(after.start))." + (more > 0 ? " \(HomeFormat.word(more)) more today." : ""))
        }
        return HomeCard(kind: .event, kicker: kicker, title: title, body: body,
                        primary: HomeCardButton(title: "Open my day", action: .openPlan),
                        details: HomeCardButton(title: "details", action: .openBrief),
                        rank: inProgress || minutes <= 90 ? 1 : 3)
    }

    // MARK: Tasks

    private static func tasks(_ brief: BriefFacts, format: HomeFormat) -> HomeCard? {
        let overdue = brief.overdue, due = brief.dueToday
        if let first = overdue.first {
            if overdue.count == 1 {
                let late = format.lateness(first.dueDate)
                return HomeCard(kind: .tasks, kicker: ["OVERDUE", late, "REMINDERS"], title: "You still owe “\(first.title)”.",
                                body: [due.isEmpty ? "Still open. Done, or should I move it?" : "Plus \(HomeFormat.word(due.count).lowercased()) due today."],
                                primary: HomeCardButton(title: "Mark it done", action: .markDone(taskID: first.id)),
                                details: HomeCardButton(title: "details", action: .openPlan), rank: 2)
            }
            var kicker = ["OVERDUE", "\(overdue.count) TASKS"]
            if !due.isEmpty { kicker.append("+\(due.count) DUE TODAY") }
            return HomeCard(kind: .tasks, kicker: kicker, title: "\(HomeFormat.word(overdue.count)) things are overdue.",
                            body: [overdue.prefix(3).map(\.title).joined(separator: " · ")],
                            primary: HomeCardButton(title: "Open the plan", action: .openPlan), details: nil, rank: 2)
        }
        guard let first = due.first else { return nil }
        let single = due.count == 1
        return HomeCard(kind: .tasks, kicker: ["DUE TODAY", single ? "1 TASK" : "\(due.count) TASKS"],
                        title: single ? "“\(first.title)” is due today." : "\(HomeFormat.word(due.count)) things are due by tonight.",
                        body: [single ? "Mark it off and the list is clear." : due.prefix(3).map(\.title).joined(separator: " · ")],
                        primary: single ? HomeCardButton(title: "Mark it done", action: .markDone(taskID: first.id))
                                        : HomeCardButton(title: "Open the plan", action: .openPlan),
                        details: single ? HomeCardButton(title: "details", action: .openPlan) : nil, rank: 4)
    }

    // MARK: Focus

    private static func focus(brief: BriefFacts?, live: HomeFocus?, leaveBy: Date?, format: HomeFormat) -> HomeCard? {
        if let live, live.live {
            // Full screen covers Home while a session is up; the card is for a session he tucked away.
            guard live.minimized else { return nil }
            return HomeCard(kind: .focus, kicker: ["FOCUS"] + (live.remaining.map { [$0] } ?? []), title: "You're mid-session.",
                            body: [live.headline], primary: HomeCardButton(title: "Back to focus", action: .resumeFocus),
                            details: nil, rank: 1)
        }
        guard let brief, (7..<22).contains(format.hour) else { return nil }
        let timed = brief.events.filter { !$0.isAllDay }
        guard !timed.contains(where: { $0.start <= format.now && $0.end > format.now }) else { return nil }
        let next = timed.filter { $0.start > format.now }.min { $0.start < $1.start }
        guard let end = next?.start ?? (brief.calendarConnected ? format.today(hour: 22) : nil) else { return nil }
        // Free time ends when he has to leave, not when the class starts.
        let until = leaveBy.map { $0 > format.now && $0 < end ? $0 : end } ?? end
        let free = format.minutes(until: until)
        guard free >= minimumFreeMinutes else { return nil }
        let topic = brief.overdue.first?.title ?? brief.dueToday.first?.title
        let block = min(50, (free - 10) / 5 * 5)
        return HomeCard(kind: .focus,
                        kicker: next == nil ? ["CLEAR RUN", "UNTIL \(format.time(until))"] : ["FREE UNTIL \(format.time(until))", format.duration(free)],
                        title: topic.map { "Good window for “\($0)”." } ?? "You've got a clear stretch.",
                        body: [until < end ? "A \(block)-minute block fits before you leave."
                               : next.map { "A \(block)-minute block fits before \(format.shortName($0.title))." } ?? "Nothing on the calendar until \(format.time(until))."],
                        primary: HomeCardButton(title: "Start focus", action: .startFocus(task: topic)),
                        details: HomeCardButton(title: "details", action: .openPlan), rank: 5)
    }

    // MARK: Health

    /// The brief's WHOOP readings, or today's health-log row when the brief has none.
    static func readings(brief: BriefFacts?, day: HomeHealthDay?) -> HealthReadings? {
        if let readings = brief?.readings, readings.recovery != nil || readings.sleepHours != nil {
            return HealthReadings(readings: readings, source: "WHOOP")
        }
        guard let day, !day.isEmpty else { return nil }
        return HealthReadings(readings: BriefFacts.Readings(recovery: day.recovery, sleepPerformance: day.sleepPerformance,
                                                            sleepHours: day.sleepHours),
                              source: "HEALTH LOG")
    }

    struct HealthReadings {
        let readings: BriefFacts.Readings
        let source: String
        var sleepHours: Double? { readings.sleepHours }
    }

    private static func health(_ health: HealthReadings?, format: HomeFormat) -> HomeCard? {
        guard let health else { return nil }
        let readings = health.readings
        let low = (readings.recovery ?? 100) < 34
        guard format.hour < 14 || low else { return nil }
        let kicker = [readings.recovery.map { "RECOVERY \($0)" }, readings.sleepPerformance.map { "SLEEP \($0)%" }, health.source].compactMap { $0 }
        let title: String
        switch readings.recovery {
        case let value? where value >= 67: title = "You're well recovered. Make it count."
        case let value? where value >= 34: title = "Middling recovery. Front-load the hard work."
        case .some: title = "Low recovery. Go easy on yourself today."
        case .none: title = "You slept \(String(format: "%.1f", readings.sleepHours ?? 0)) hours."
        }
        let figures = [readings.sleepHours.map { String(format: "%.1f h asleep", $0) }, readings.hrvDelta.map { "HRV \($0)" },
                       readings.restingHeartRate.map { "resting HR \($0)" }].compactMap { $0 }
        return HomeCard(kind: .health, kicker: kicker, title: title,
                        body: figures.isEmpty ? [] : [figures.joined(separator: " · ")],
                        primary: HomeCardButton(title: "Read the brief", action: .openBrief),
                        details: HomeCardButton(title: "details", action: .openHealth), rank: low ? 2 : 3)
    }

    // MARK: Sleep

    /// Under this, last night was short enough to say so.
    static let shortNightHours = 6.5

    private static func sleep(bedtime: Date?, nextWake: Date?, lastNight: Double?, format: HomeFormat) -> HomeCard? {
        let short = lastNight.flatMap { $0 < shortNightHours ? $0 : nil }
        guard let bedtime else { return short.flatMap { shortNight($0, format: format) } }
        let minutes = format.minutes(until: bedtime)
        guard minutes > -120, minutes <= 8 * 60, format.hour >= 17 || minutes <= 300 else { return nil }
        let past = minutes < 0
        return HomeCard(kind: .sleep,
                        kicker: past ? ["PAST BEDTIME", format.duration(-minutes)]
                                     : ["BED BY \(format.spoken(bedtime).uppercased())", "IN \(format.duration(minutes))"],
                        title: past ? "You're past bedtime. Time to stop." : "Lights out by \(format.spoken(bedtime)) tonight.",
                        body: [short.map { "Last night was \(String(format: "%.1f", $0)) hours, so don't push it." },
                               nextWake.map { "Alarm's set for \(format.time($0))." } ?? "Wind down for the last hour before it."].compactMap { $0 },
                        primary: HomeCardButton(title: "Look at tomorrow", action: .ask(prefill: "What does tomorrow look like?")),
                        details: HomeCardButton(title: "details", action: .openPlan),
                        rank: past || minutes <= 120 ? 1 : 4)
    }
}

/// The greeting block's two lines.
enum HomeGreeting {
    static func line(clock: BriefClock, name: String?) -> String {
        guard let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { return "\(clock.greeting)." }
        return "\(clock.greeting), \(name)."
    }

    static func subline(knowledgeCount: Int?, cardCount: Int, clock: BriefClock) -> String {
        if let count = knowledgeCount, count > 0 {
            return count == 1 ? "I'VE LEARNED ONE THING ABOUT YOU" : "I'VE LEARNED \(count) THINGS ABOUT YOU"
        }
        if cardCount == 1 { return "ONE THING NEEDS YOU TODAY" }
        if cardCount > 1 { return "\(cardCount) THINGS NEED YOU TODAY" }
        return HomeFormat(clock: clock).date(clock.now).uppercased()
    }
}
