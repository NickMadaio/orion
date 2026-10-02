import Foundation

// The phone ↔ Mac link over CloudKit (2026-09-28).
//
// Nick chose CloudKit: a private database under his Apple ID carries the Mac's
// state to the phone and the phone's commands to the Mac. This file is the
// contract both sides compile against, so they cannot drift: record names and
// fields, the snapshot the Mac publishes, and the commands the phone may send.
//
// Foundation only (MobileCore's rule). CloudKit itself lives in the two apps.
//
// Commands are TEXT in orion-remote's grammar, deliberately: the Mac runs every
// one through `orion-remote handle`, the same gate the Discord channel uses —
// sender allowlist, lock, replay guard, rate limit, verb shapes, audit. The
// phone gains no authority Discord does not already have.

public enum LinkSchema {
    public static let containerID = "iCloud.com.nickmadaio.orion"
    public static let zoneName = "OrionLink"

    /// One record, written by the Mac about every 30 seconds.
    public static let stateType = "MacState"
    public static let stateName = "mac"
    public static let stateJSON = "json"
    public static let stateUpdatedAt = "updatedAt"

    /// Written by the phone; the Mac fills in status and reply.
    public static let commandType = "LinkCommand"
    public static let commandText = "text"
    public static let commandSentAt = "sentAt"
    public static let commandDevice = "device"
    public static let commandStatus = "status"
    public static let commandReply = "reply"
    public static let commandThinking = "thinking"
    public static let commandConversation = "conversationID"
    public static let commandModel = "model"
    public static let commandRepliedAt = "repliedAt"
    /// "chat" for conversation with ORION, "control" for buttons. The Mac runs
    /// both the same way; the phone keeps them in different places.
    public static let commandKind = "kind"

    /// Written by the Mac when something needs Nick; the phone is notified.
    public static let alertType = "LinkAlert"
    public static let alertText = "text"
    public static let alertKind = "kind"
    public static let alertAt = "at"

    /// The sender name every phone command carries into orion-remote.
    public static let sender = "phone"
}

public enum LinkCommandStatus: String, Codable, Sendable {
    case pending, running, done, failed
}

public enum LinkCommandKind: String, Codable, Sendable {
    /// Conversation with ORION and the Control buttons: both run through orion-remote.
    case chat, control
    /// Health tracking (water, meals, supplements): a `LinkLog` as JSON, written
    /// by the Mac into its health log. Data, not authority, so not orion-remote.
    case log
    /// "plan", "replan" or "undo": handed to the ORION app, which owns the planner.
    case plan
}

/// What the Mac publishes. Every field is something the Mac read, never a guess:
/// an unreadable source is left empty or nil, not zero.
public struct LinkSnapshot: Codable, Equatable, Sendable {
    public struct Mac: Codable, Equatable, Sendable {
        public var name: String
        public var battery: Int?
        public var charging: Bool?
        public var diskFreeGB: Int?
        public var uptimeHours: Int?
        public var runningApps: [String]
        public var locked: Bool

        public init(name: String, battery: Int? = nil, charging: Bool? = nil, diskFreeGB: Int? = nil,
                    uptimeHours: Int? = nil, runningApps: [String] = [], locked: Bool = false) {
            self.name = name; self.battery = battery; self.charging = charging; self.diskFreeGB = diskFreeGB
            self.uptimeHours = uptimeHours; self.runningApps = runningApps; self.locked = locked
        }
    }

    public struct Run: Codable, Equatable, Sendable, Identifiable {
        public enum Status: String, Codable, Sendable { case working, paused, stopped, needsYou, complete }
        public var id: String
        public var project: String
        public var status: Status
        public var live: Bool
        public var role: String?
        public var model: String?
        public var activeTask: String?
        public var step: String?
        public var accepted: Int
        public var total: Int
        public var percent: Int
        public var minutesOnTask: Int?
        public var deferred: Int

        public init(id: String, project: String, status: Status, live: Bool, role: String? = nil, model: String? = nil,
                    activeTask: String? = nil, step: String? = nil, accepted: Int, total: Int, percent: Int,
                    minutesOnTask: Int? = nil, deferred: Int = 0) {
            self.id = id; self.project = project; self.status = status; self.live = live; self.role = role
            self.model = model; self.activeTask = activeTask; self.step = step; self.accepted = accepted
            self.total = total; self.percent = percent; self.minutesOnTask = minutesOnTask; self.deferred = deferred
        }
    }

    public struct Approval: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var action: String
        public var summary: String
        public var context: String
        public var expiresAt: Date
        public init(id: String, action: String, summary: String, context: String, expiresAt: Date) {
            self.id = id; self.action = action; self.summary = summary; self.context = context; self.expiresAt = expiresAt
        }
    }

    public struct RunningAction: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var actions: [String]
        public var startedAt: Date?
        public init(id: String, title: String, actions: [String], startedAt: Date?) {
            self.id = id; self.title = title; self.actions = actions; self.startedAt = startedAt
        }
    }

    public struct AttentionRow: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var source: String
        public var reason: String?
        public init(id: String, title: String, source: String, reason: String?) {
            self.id = id; self.title = title; self.source = source; self.reason = reason
        }
    }

    public struct Attention: Codable, Equatable, Sendable {
        public var generatedAt: Date?
        public var interrupt: [AttentionRow]
        public var today: [AttentionRow]
        public var note: String?
        public init(generatedAt: Date?, interrupt: [AttentionRow], today: [AttentionRow], note: String?) {
            self.generatedAt = generatedAt; self.interrupt = interrupt; self.today = today; self.note = note
        }
    }

    /// One day of the Mac's health log (WHOOP and manual). Nil means not recorded.
    public struct HealthDay: Codable, Equatable, Sendable, Identifiable {
        public var date: String          // YYYY-MM-DD
        public var recovery: Int?
        public var hrv: Int?
        public var restingHeartRate: Int?
        public var sleepHours: Double?
        public var sleepPerformance: Int?
        public var strain: Double?
        public var id: String { date }
        public init(date: String, recovery: Int? = nil, hrv: Int? = nil, restingHeartRate: Int? = nil,
                    sleepHours: Double? = nil, sleepPerformance: Int? = nil, strain: Double? = nil) {
            self.date = date; self.recovery = recovery; self.hrv = hrv; self.restingHeartRate = restingHeartRate
            self.sleepHours = sleepHours; self.sleepPerformance = sleepPerformance; self.strain = strain
        }
    }

    /// Today's tracking, from the Mac's health log.
    public struct Tracking: Codable, Equatable, Sendable {
        public struct Meal: Codable, Equatable, Sendable, Identifiable {
            public var id: String
            public var title: String
            public var meal: String
            public var calories: Int
            public var protein: Int
            public init(id: String, title: String, meal: String, calories: Int, protein: Int) {
                self.id = id; self.title = title; self.meal = meal; self.calories = calories; self.protein = protein
            }
        }
        public struct Supplement: Codable, Equatable, Sendable, Identifiable {
            public var id: String
            public var name: String
            public var dose: String
            public var timeOfDay: String
            public var taken: Bool
            public init(id: String, name: String, dose: String, timeOfDay: String, taken: Bool) {
                self.id = id; self.name = name; self.dose = dose; self.timeOfDay = timeOfDay; self.taken = taken
            }
        }
        /// The logical day these numbers belong to (YYYY-MM-DD; the day turns at 4am).
        public var day: String
        public var waterBottles: Int
        public var waterGoal: Int
        public var calories: Int
        public var calorieGoal: Int
        public var protein: Int
        public var proteinGoal: Int
        public var meals: [Meal]
        public var supplements: [Supplement]
        /// Recent distinct foods, newest first, for one-tap logging.
        public var recentFoods: [Meal]
        public init(day: String, waterBottles: Int, waterGoal: Int, calories: Int, calorieGoal: Int, protein: Int,
                    proteinGoal: Int, meals: [Meal], supplements: [Supplement], recentFoods: [Meal] = []) {
            self.day = day; self.waterBottles = waterBottles; self.waterGoal = waterGoal; self.calories = calories
            self.calorieGoal = calorieGoal; self.protein = protein; self.proteinGoal = proteinGoal; self.meals = meals
            self.supplements = supplements; self.recentFoods = recentFoods
        }
    }

    /// The last plan request the phone made, as the ORION app reported it.
    public struct PlanRequest: Codable, Equatable, Sendable {
        public enum State: String, Codable, Sendable { case waiting, working, done, failed }
        public var id: String
        public var action: String
        public var state: State
        public var message: String?
        public var at: Date
        public init(id: String, action: String, state: State, message: String?, at: Date) {
            self.id = id; self.action = action; self.state = state; self.message = message; self.at = at
        }
    }

    public var version: Int
    public var generatedAt: Date
    public var mac: Mac
    public var runs: [Run]
    public var approvals: [Approval]
    public var running: [RunningAction]
    public var attention: Attention?
    /// Oldest first, up to seven days. Optional so older snapshots still decode.
    public var health: [HealthDay]?
    public var tracking: Tracking?
    /// ORION's accepted plan for today, as the Mac saved it. Nil when there is none.
    public var plan: TodayPlan?
    public var planRequest: PlanRequest?
    /// A wake-up time Nick asked ORION for ("wake me up at 7:30"); the phone's
    /// alarm uses it instead of the automatic one for that morning.
    public var wakeRequest: Date?
    /// Extra phone time ORION granted ("unblock my apps until 12:45"): the phone
    /// lifts its Screen Time lock until `until`, then puts it back. `id` makes one
    /// grant apply once.
    public struct ScreenGrant: Codable, Equatable, Sendable {
        public var id: String
        public var until: Date
        public var because: String?
        public init(id: String, until: Date, because: String? = nil) { self.id = id; self.until = until; self.because = because }
    }
    public var screenGrant: ScreenGrant?
    /// When he actually woke and fell asleep, per day, as the Mac worked it out
    /// (WHOOP via the ORION app, else the phone's own signals). 2026-10-01: "have
    /// the wake up line move to when I actually wake up".
    public struct NightDay: Codable, Equatable, Sendable {
        public var date: String          // YYYY-MM-DD
        public var wake: Date?
        public var woke: Bool
        public var bed: Date?
        public var fellAsleep: Date?     // last night's actual sleep, when it was after midnight on `date`
        public init(date: String, wake: Date?, woke: Bool, bed: Date?, fellAsleep: Date? = nil) {
            self.date = date; self.wake = wake; self.woke = woke; self.bed = bed; self.fellAsleep = fellAsleep
        }
    }
    public var night: [NightDay]?
    public var earlyFinish: EarlyFinishContext?
    public var chatModels: [ModelChoice]?
    public var focusLists: [String]?
    /// The follow-up ORION is running now, for the phone's lock screen and widgets.
    public var checkin: OrionGlance.Checkin?
    /// One-off deadlines ahead (quizzes, presentations), from the Mac's calendar export.
    public var deadlines: [OrionGlance.Deadline]?
    /// The last keyboard or mouse input on the Mac. Used at night: at the Mac at
    /// 2 AM is awake, and the phone's alarm moves later for it.
    public var lastInputAt: Date?

    public init(generatedAt: Date, mac: Mac, runs: [Run] = [], approvals: [Approval] = [],
                running: [RunningAction] = [], attention: Attention? = nil, health: [HealthDay]? = nil,
                tracking: Tracking? = nil, plan: TodayPlan? = nil, planRequest: PlanRequest? = nil, wakeRequest: Date? = nil,
                checkin: OrionGlance.Checkin? = nil, deadlines: [OrionGlance.Deadline]? = nil, lastInputAt: Date? = nil,
                screenGrant: ScreenGrant? = nil, night: [NightDay]? = nil, earlyFinish: EarlyFinishContext? = nil, chatModels: [ModelChoice]? = nil, focusLists: [String]? = nil) {
        self.version = LinkSnapshot.currentVersion
        self.generatedAt = generatedAt; self.mac = mac; self.runs = runs; self.approvals = approvals
        self.running = running; self.attention = attention; self.health = health
        self.tracking = tracking; self.plan = plan; self.planRequest = planRequest; self.wakeRequest = wakeRequest
        self.checkin = checkin; self.deadlines = deadlines; self.lastInputAt = lastInputAt
        self.screenGrant = screenGrant; self.night = night; self.earlyFinish = earlyFinish; self.chatModels = chatModels; self.focusLists = focusLists
    }

    public static let currentVersion = 1
    /// CloudKit records hold up to 1 MB; the snapshot stays far below it.
    public static let maxEncodedBytes = 400_000

    public static func encode(_ snapshot: LinkSnapshot) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        guard data.count <= maxEncodedBytes else { throw LinkError.tooLarge(data.count) }
        return data
    }

    public static func decode(_ data: Data) throws -> LinkSnapshot {
        guard data.count <= maxEncodedBytes else { throw LinkError.tooLarge(data.count) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let snapshot = try decoder.decode(LinkSnapshot.self, from: data)
        guard snapshot.version == currentVersion else { throw LinkError.unsupportedVersion(snapshot.version) }
        return snapshot
    }

    /// Online / not responding / offline / never, from when the Mac last published.
    public func presence(at moment: Date, policy: HeartbeatPolicy = .standard) -> MacPresence {
        MacLink(lastSeen: generatedAt).presence(at: moment, policy: policy)
    }
}

public enum LinkError: Error, Equatable {
    case tooLarge(Int)
    case unsupportedVersion(Int)
    case invalidCommand(String)
}

/// The commands the phone's buttons send, spelled in orion-remote's grammar.
/// Free text (anything else) reaches ORION as conversation.
public enum LinkCommand {
    /// orion-remote takes up to 4000 bytes for a question; 2000 characters stays under it.
    public static let maxLength = 2000

    /// Trimmed, control characters removed, 1...maxLength characters.
    public static func validate(_ text: String) throws -> String {
        let cleaned = String(text.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) ? " " : Character($0) })
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { throw LinkError.invalidCommand("empty") }
        guard cleaned.count <= maxLength else { throw LinkError.invalidCommand("longer than \(maxLength) characters") }
        return cleaned
    }

    public static func approve(_ id: String) -> String { "approve \(id)" }
    public static func deny(_ id: String) -> String { "deny \(id)" }
    public static func agent(_ action: AgentAction, project: String) -> String { "agent \(action.rawValue) \(project)" }
    public static func cancelAction(_ taskId: String) -> String { "action cancel \(taskId)" }
    public static let deviceStatus = "device"
    public static let runningApps = "apps"

    public enum AgentAction: String, Sendable { case status, pause, resume, stop }
}

/// What the ORION app can be asked to do with today's plan.
public enum LinkPlanAction: String, Codable, Sendable, CaseIterable {
    /// Plan the rest of today from Calendar and the Orion Reminders list.
    case plan
    /// Re-plan from now, keeping pinned slots (running late, or something moved).
    case replan
    /// Put back the plan before the last change.
    case undo
}

/// One tracking entry from the phone. Encoded as JSON in the command's text.
public enum LinkLog: Codable, Equatable, Sendable {
    case water(delta: Int)
    case meal(title: String, meal: String, calories: Int, protein: Int, carbohydrates: Int, fat: Int)
    case removeMeal(id: String)
    case supplement(id: String, taken: Bool)
    /// "bed" when Nick says he is going to sleep, "up" when he stops the alarm.
    /// `at` is when it happened on the phone, ISO-8601. History for learning his patterns.
    case sleep(event: String, at: String)
    /// A sample of what the phone can see about Nick's state: motion ("still",
    /// "walking", "running", "vehicle", "unknown"), charging, and a coarse place
    /// (lat/lon rounded to ~100 m) when he has allowed location. History for the
    /// life loop's "what is actually happening"; nothing acts on one sample.
    case signal(at: String, motion: String, charging: Bool, latitude: Double?, longitude: Double?)
    /// Whether the phone's Screen Time lock is on (2026-10-01: Nick asked ORION for
    /// 20 more minutes and ORION said nothing was locked; it could not see the phone).
    /// `why` is "night", "work" or "checkin"; `until` and `graceUntil` are ISO-8601.
    case screen(at: String, locked: Bool, until: String?, why: String?, graceUntil: String?, usedMinutes: [String: Int]? = nil)
    /// An answer to a check-in notification: "started", "snooze" (10 more min) or "done".
    case checkin(action: String)
    /// Something noted on the phone ("remember…", an idea, or an offline
    /// conversation), filed into ORION's memory journal for that day by the Mac.
    case note(text: String, at: String)

    public static let meals = ["Breakfast", "Lunch", "Dinner", "Snack", "Other"]

    /// Bounds a person could mean; anything else is refused rather than clamped.
    public func validated() throws -> LinkLog {
        func text(_ value: String, _ limit: Int) throws -> String {
            let cleaned = try LinkCommand.validate(value)
            guard cleaned.count <= limit else { throw LinkError.invalidCommand("longer than \(limit) characters") }
            return cleaned
        }
        func identifier(_ value: String) throws -> String {
            guard (1...64).contains(value.count),
                  value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
            else { throw LinkError.invalidCommand("not an id") }
            return value
        }
        switch self {
        case .water(let delta):
            guard (-3...3).contains(delta), delta != 0 else { throw LinkError.invalidCommand("water changes by 1 to 3 bottles") }
            return self
        case let .meal(title, meal, calories, protein, carbohydrates, fat):
            guard (0...5000).contains(calories), (0...500).contains(protein), (0...1000).contains(carbohydrates), (0...500).contains(fat)
            else { throw LinkError.invalidCommand("those numbers are out of range") }
            return .meal(title: try text(title, 80), meal: Self.meals.contains(meal) ? meal : "Other",
                         calories: calories, protein: protein, carbohydrates: carbohydrates, fat: fat)
        case .removeMeal(let id): return .removeMeal(id: try identifier(id))
        case let .supplement(id, taken): return .supplement(id: try identifier(id), taken: taken)
        case let .signal(at, motion, charging, latitude, longitude):
            guard ["still", "walking", "running", "vehicle", "cycling", "unknown"].contains(motion),
                  ISO8601DateFormatter().date(from: at) != nil else { throw LinkError.invalidCommand("not a signal") }
            let round = { (value: Double?) in value.map { ($0 * 1000).rounded() / 1000 } }
            if let latitude, !(-90...90).contains(latitude) { throw LinkError.invalidCommand("bad latitude") }
            if let longitude, !(-180...180).contains(longitude) { throw LinkError.invalidCommand("bad longitude") }
            return .signal(at: at, motion: motion, charging: charging, latitude: round(latitude), longitude: round(longitude))
        case let .note(text, at):
            guard ISO8601DateFormatter().date(from: at) != nil else { throw LinkError.invalidCommand("not a time") }
            let cleaned = String(text.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) && $0 != "\n" ? " " : Character($0) })
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty, cleaned.count <= 1200 else { throw LinkError.invalidCommand("a note is 1 to 1200 characters") }
            return .note(text: cleaned, at: at)
        case let .screen(at, locked, until, why, graceUntil, usedMinutes):
            let time = { (value: String?) in value == nil || ISO8601DateFormatter().date(from: value!) != nil }
            guard ISO8601DateFormatter().date(from: at) != nil, time(until), time(graceUntil),
                  why == nil || ["night", "work", "checkin", "day"].contains(why!) else { throw LinkError.invalidCommand("not a screen state") }
            guard usedMinutes == nil || usedMinutes!.allSatisfy({ ["messaging", "feeds", "video", "games"].contains($0.key) && (0...1440).contains($0.value) }) else { throw LinkError.invalidCommand("invalid app-list usage") }
            return .screen(at: at, locked: locked, until: until, why: why, graceUntil: graceUntil, usedMinutes: usedMinutes)
        case .checkin(let action):
            guard ["started", "snooze", "done", "early-block", "early-out-of-class"].contains(action) else { throw LinkError.invalidCommand("not a check-in answer") }
            return self
        case let .sleep(event, at):
            guard ["bed", "up"].contains(event) else { throw LinkError.invalidCommand("sleep event is bed or up") }
            guard at.count <= 40, ISO8601DateFormatter().date(from: at) != nil else { throw LinkError.invalidCommand("not a time") }
            return self
        }
    }

    public func encoded() throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }

    public static func decode(_ text: String) throws -> LinkLog {
        guard text.utf8.count <= 4000 else { throw LinkError.invalidCommand("too long") }
        return try JSONDecoder().decode(LinkLog.self, from: Data(text.utf8)).validated()
    }
}
