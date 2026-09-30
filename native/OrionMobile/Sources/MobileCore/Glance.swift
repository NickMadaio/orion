import Foundation

// The glance: everything a widget, the lock screen or the Dynamic Island shows
// (2026-09-29).
//
// Nick: "make widgets for both mac and for ios … ones with orion hologram, ones
// with the schedule or todo, one with project view." A widget cannot ask the Mac
// anything; it draws from a file. This is that file's shape, and the rules for
// reading it at any moment of a widget timeline: what is on now, what is next,
// how ORION should look, and the one sentence he says.
//
// Both apps write one: the Mac (ORION Link, from ORION's own state and the ORION
// app's calendar export) and the phone (from Calendar, Reminders and the Mac's
// snapshot). Each platform's widgets read their own device's copy. Foundation
// only, like the rest of MobileCore.

public struct OrionGlance: Codable, Equatable, Sendable {
    public struct Block: Codable, Equatable, Sendable, Identifiable {
        /// class, event, social, study, orion (ORION's own block), free, sleep.
        public var id: String
        public var title: String
        public var start: Date
        public var end: Date
        public var kind: String
        public var fixed: Bool
        public var location: String?
        public init(id: String, title: String, start: Date, end: Date, kind: String, fixed: Bool, location: String? = nil) {
            self.id = id; self.title = title; self.start = start; self.end = end
            self.kind = kind; self.fixed = fixed; self.location = location
        }
        public var minutes: Int { max(0, Int(end.timeIntervalSince(start) / 60)) }
    }

    public struct Todo: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var due: Date?
        /// 1 is most important; 0 means no priority.
        public var priority: Int
        public var done: Bool
        public init(id: String, title: String, due: Date? = nil, priority: Int = 0, done: Bool = false) {
            self.id = id; self.title = title; self.due = due; self.priority = priority; self.done = done
        }
    }

    public struct Project: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        /// working, paused, stopped, needsYou, complete — `LinkSnapshot.Run.Status`.
        public var status: String
        public var percent: Int
        public var accepted: Int
        public var total: Int
        public var live: Bool
        public var activeTask: String?
        public var step: String?
        public init(id: String, name: String, status: String, percent: Int, accepted: Int, total: Int,
                    live: Bool, activeTask: String? = nil, step: String? = nil) {
            self.id = id; self.name = name; self.status = status; self.percent = percent; self.accepted = accepted
            self.total = total; self.live = live; self.activeTask = activeTask; self.step = step
        }
    }

    /// The follow-up ORION is running right now (`orion-checkin`).
    public struct Checkin: Codable, Equatable, Sendable {
        public var id: String
        public var what: String
        /// waiting, reminded, intervening, active, deferred.
        public var phase: String
        public var level: Int
        public var due: Date?
        public var nextCheck: Date?
        public init(id: String, what: String, phase: String, level: Int, due: Date? = nil, nextCheck: Date? = nil) {
            self.id = id; self.what = what; self.phase = phase; self.level = level; self.due = due; self.nextCheck = nextCheck
        }
        /// Asked and not yet started: this is the one that should be loud.
        public var chasing: Bool { ["reminded", "intervening"].contains(phase) }
    }

    public struct Deadline: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var at: Date
        public init(id: String, title: String, at: Date) { self.id = id; self.title = title; self.at = at }
    }

    public struct Tracking: Codable, Equatable, Sendable {
        public var water: Int
        public var waterGoal: Int
        public var calories: Int
        public var calorieGoal: Int
        public var protein: Int
        public var proteinGoal: Int
        public init(water: Int, waterGoal: Int, calories: Int, calorieGoal: Int, protein: Int, proteinGoal: Int) {
            self.water = water; self.waterGoal = waterGoal; self.calories = calories
            self.calorieGoal = calorieGoal; self.protein = protein; self.proteinGoal = proteinGoal
        }
    }

    public struct Night: Codable, Equatable, Sendable {
        public var bed: Date
        public var alarm: Date?
        public var reason: String?
        public var note: String?
        public init(bed: Date, alarm: Date?, reason: String? = nil, note: String? = nil) {
            self.bed = bed; self.alarm = alarm; self.reason = reason; self.note = note
        }
    }

    public static let currentVersion = 1

    public var version: Int
    public var generatedAt: Date
    /// "mac" or "iphone": whose copy this is.
    public var source: String
    /// Today's blocks (calendar and ORION's plan, merged), sorted by start.
    public var blocks: [Block]
    /// Tomorrow's first few, for the evening.
    public var tomorrow: [Block]
    public var todos: [Todo]
    public var projects: [Project]
    public var checkin: Checkin?
    public var deadlines: [Deadline]
    public var tracking: Tracking?
    public var night: Night?
    /// WHOOP recovery, 0–100, when the Mac has it.
    public var recovery: Int?
    /// Approvals waiting for Nick.
    public var approvals: Int

    public init(generatedAt: Date, source: String, blocks: [Block] = [], tomorrow: [Block] = [], todos: [Todo] = [],
                projects: [Project] = [], checkin: Checkin? = nil, deadlines: [Deadline] = [], tracking: Tracking? = nil,
                night: Night? = nil, recovery: Int? = nil, approvals: Int = 0) {
        self.version = Self.currentVersion
        self.generatedAt = generatedAt; self.source = source; self.blocks = blocks.sorted { $0.start < $1.start }
        self.tomorrow = tomorrow; self.todos = todos; self.projects = projects; self.checkin = checkin
        self.deadlines = deadlines.sorted { $0.at < $1.at }; self.tracking = tracking; self.night = night
        self.recovery = recovery; self.approvals = approvals
    }
}

// MARK: - Reading it at a moment

extension OrionGlance {
    /// How ORION looks. Each maps to a hologram still in the widget assets.
    public enum Mood: String, Codable, Sendable, CaseIterable {
        /// Gold, at rest: nothing needs him.
        case calm
        /// Violet, thinking: something is on now and he is holding the plan.
        case focus
        /// Blue, listening: waiting on Nick — an approval, an empty evening to fill.
        case asking
        /// Red: a check-in he is ignoring.
        case alert
        /// The event horizon: past bedtime.
        case night
    }

    /// The block happening at `moment`; fixed things (a class) win over ORION's fill.
    public func current(at moment: Date) -> Block? {
        blocks.filter { $0.start <= moment && moment < $0.end && $0.kind != "free" }
            .sorted { ($0.fixed ? 0 : 1, $0.start) < ($1.fixed ? 0 : 1, $1.start) }.first
    }

    /// Next things to start after `moment`, soonest first.
    public func upcoming(after moment: Date, limit: Int = 4) -> [Block] {
        Array(blocks.filter { $0.start > moment && $0.kind != "free" }.prefix(limit))
    }

    /// The rest of today from `moment`: what is on, then what is coming.
    public func remaining(at moment: Date, limit: Int = 8) -> [Block] {
        Array(blocks.filter { $0.end > moment && $0.kind != "free" }.prefix(limit))
    }

    public func openTodos(limit: Int = 6) -> [Todo] {
        Array(todos.filter { !$0.done }.sorted { a, b in
            let pa = a.priority == 0 ? 99 : a.priority, pb = b.priority == 0 ? 99 : b.priority
            if pa != pb { return pa < pb }
            return (a.due ?? .distantFuture) < (b.due ?? .distantFuture)
        }.prefix(limit))
    }

    public func upcomingDeadlines(after moment: Date, limit: Int = 3) -> [Deadline] {
        Array(deadlines.filter { $0.at > moment }.prefix(limit))
    }

    public func isPastBedtime(_ moment: Date) -> Bool {
        guard let night else { return false }
        return moment >= night.bed && moment < (night.alarm ?? night.bed.addingTimeInterval(9 * 3600))
    }

    public func mood(at moment: Date) -> Mood {
        if let checkin, checkin.chasing, checkin.level >= 2 { return .alert }
        if isPastBedtime(moment) { return .night }
        if approvals > 0 || checkin?.chasing == true { return .asking }
        if current(at: moment) != nil || checkin?.phase == "active" { return .focus }
        if emptyEvening(at: moment) { return .asking }
        return .calm
    }

    /// After the day's last fixed thing, with three or more hours of daylight and nothing booked.
    public func emptyEvening(at moment: Date, calendar: Calendar = .current) -> Bool {
        let hour = calendar.component(.hour, from: moment)
        guard (12..<21).contains(hour) else { return false }
        let later = blocks.filter { $0.end > moment && $0.kind != "free" }
        return later.isEmpty
    }

    /// The one thing ORION would say, right now. Plain, specific, never invented:
    /// every clause comes from a field.
    public func line(at moment: Date, calendar: Calendar = .current) -> String {
        if let checkin, checkin.chasing {
            return checkin.level >= 2 ? "Still waiting on \(checkin.what). Start now." : "Time for \(checkin.what)."
        }
        if let night, isPastBedtime(moment) {
            let left = night.alarm.map { Self.duration($0.timeIntervalSince(moment)) }
            return left.map { "Sleep. \($0) left before your alarm." } ?? "Past bedtime. Sleep."
        }
        if let now = current(at: moment) {
            let left = Int(now.end.timeIntervalSince(moment) / 60)
            if let next = upcoming(after: moment, limit: 1).first, next.start.timeIntervalSince(now.end) <= 30 * 60 {
                return "\(now.title) · \(Self.duration(Double(left) * 60)) left, then \(next.title)."
            }
            return "\(now.title) · \(Self.duration(Double(left) * 60)) left."
        }
        if let next = upcoming(after: moment, limit: 1).first {
            let minutes = Int(next.start.timeIntervalSince(moment) / 60)
            if minutes <= 90 { return "\(next.title) in \(Self.duration(Double(minutes) * 60))." }
            if calendar.isDate(next.start, inSameDayAs: moment) { return "Next: \(next.title) at \(Self.clock(next.start, calendar: calendar))." }
        }
        if approvals > 0 { return approvals == 1 ? "One request is waiting for you." : "\(approvals) requests are waiting for you." }
        if emptyEvening(at: moment, calendar: calendar) { return "The rest of today is open. What's the plan?" }
        if let first = tomorrow.first, calendar.component(.hour, from: moment) >= 18 {
            return "Tomorrow starts with \(first.title) at \(Self.clock(first.start, calendar: calendar))."
        }
        if let todo = openTodos(limit: 1).first { return "Clear: \(todo.title)." }
        return "Nothing needs you. It's yours."
    }

    /// Progress through the block on now, 0…1.
    public func progress(of block: Block, at moment: Date) -> Double {
        let total = block.end.timeIntervalSince(block.start)
        guard total > 0 else { return 0 }
        return min(1, max(0, moment.timeIntervalSince(block.start) / total))
    }

    /// Moments a widget timeline should redraw at: each start and end in the
    /// next `hours`, plus every 15 minutes so countdowns stay honest.
    public func timelineMoments(from moment: Date, hours: Double = 6) -> [Date] {
        let horizon = moment.addingTimeInterval(hours * 3600)
        var moments: Set<Date> = [moment]
        for block in blocks + tomorrow {
            for edge in [block.start, block.end] where edge > moment && edge < horizon { moments.insert(edge) }
        }
        if let night { for edge in [night.bed, night.alarm].compactMap({ $0 }) where edge > moment && edge < horizon { moments.insert(edge) } }
        var tick = moment.addingTimeInterval(15 * 60)
        while tick < horizon { moments.insert(tick); tick = tick.addingTimeInterval(15 * 60) }
        return moments.sorted()
    }

    public static func clock(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    public static func duration(_ seconds: TimeInterval) -> String {
        let minutes = max(0, Int((seconds / 60).rounded()))
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60, rest = minutes % 60
        return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
    }
}

// MARK: - Building one

extension OrionGlance {
    /// Merge calendar events with ORION's accepted plan. Calendar wins where the
    /// plan only mirrors it (its commitment blocks); ORION's own task blocks are
    /// kept; transitions and free time are dropped.
    public static func merge(events: [Block], plan: TodayPlan?) -> [Block] {
        var merged = events
        for block in plan?.blocks ?? [] where block.kind == .task {
            let duplicate = merged.contains { $0.title.caseInsensitiveCompare(block.title) == .orderedSame
                && abs($0.start.timeIntervalSince(block.start)) < 300 }
            if !duplicate {
                merged.append(Block(id: "plan-\(block.id)", title: block.title, start: block.start, end: block.end,
                                    kind: "orion", fixed: false))
            }
        }
        return merged.sorted { $0.start < $1.start }
    }

    /// What kind of block an event is, from its title: the Life loop's rules, simplified.
    public static func kind(of title: String, orionKind: String? = nil) -> String {
        if let orionKind, !orionKind.isEmpty { return orionKind == "study" ? "study" : "orion" }
        let lower = title.lowercased()
        let hasCode = lower.range(of: #"\b[a-z]{3,4}\s?\d{4}\b"#, options: .regularExpression) != nil
        if hasCode || ["lecture", "seminar", "tutorial", "class", "lab "].contains(where: lower.contains) { return "class" }
        if ["with ", "friend", "club", "party", "dinner with", "drinks", "ministry of sound"].contains(where: lower.contains) { return "social" }
        if ["study", "revise", "revision", "homework", "reading"].contains(where: lower.contains) { return "study" }
        return "event"
    }

    /// Worth a countdown: quizzes, exams, presentations, things due. Classes and
    /// plans are not deadlines, even one-off ones.
    public static func isDeadline(_ title: String) -> Bool {
        let lower = title.lowercased()
        return ["quiz", "exam", "midterm", "final", "presentation", "deadline", "due", "submission", "submit",
                "essay", "coursework", "assignment", "test", "interview"].contains { word in
            lower.range(of: "\\b\(word)", options: .regularExpression) != nil
        }
    }

    public static func projects(from runs: [LinkSnapshot.Run]) -> [Project] {
        runs.map { Project(id: $0.id, name: $0.project, status: $0.status.rawValue, percent: $0.percent,
                           accepted: $0.accepted, total: $0.total, live: $0.live, activeTask: $0.activeTask, step: $0.step) }
    }

    public static func tracking(from tracking: LinkSnapshot.Tracking?) -> Tracking? {
        tracking.map { Tracking(water: $0.waterBottles, waterGoal: $0.waterGoal, calories: $0.calories,
                                calorieGoal: $0.calorieGoal, protein: $0.protein, proteinGoal: $0.proteinGoal) }
    }
}

// MARK: - The file

public enum GlanceFile {
    /// The iPhone app group; the Mac uses its team-prefixed one.
    public static let phoneGroup = "group.com.nickmadaio.orion"
    public static let macGroup = "JQNK3T6ACY.com.nickmadaio.orion"
    public static let fileName = "glance.json"
    /// Small requests a Mac widget button leaves for ORION Link ("water +1").
    public static let requestsName = "widget-requests.jsonl"

    public static func encode(_ glance: OrionGlance) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(glance)
    }

    public static func decode(_ data: Data) throws -> OrionGlance {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let glance = try decoder.decode(OrionGlance.self, from: data)
        guard glance.version == OrionGlance.currentVersion else { throw LinkError.unsupportedVersion(glance.version) }
        return glance
    }

    public static func read(_ url: URL) -> OrionGlance? {
        guard let data = try? Data(contentsOf: url), data.count < 1_000_000 else { return nil }
        return try? decode(data)
    }

    /// Written atomically; returns whether the content changed (ignoring the clock),
    /// so the caller reloads widget timelines only when there is something new.
    @discardableResult
    public static func write(_ glance: OrionGlance, to url: URL) throws -> Bool {
        var probe = glance; probe.generatedAt = .distantPast
        if var old = read(url) {
            old.generatedAt = .distantPast
            if old == probe { return false }
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encode(glance).write(to: url, options: .atomic)
        return true
    }
}
