import Foundation

/*
 What Home borrows from the other sections (wave 12, U5, 2026-11-02). Nick: "now just combine the old stuff with
 the new. from projects, finance, and lastly the hologram on the home page. health etc too".

 Each value here is a small, plain digest of something a section already reads, so the card builders and the
 glance row stay pure:
   · projects — the project agent's saved runs (project-agent/projects/<id>/state.json + heartbeat.json), the same
     files the Projects tab reads through SavedProject;
   · finance  — finance-summary.json, which the Finances tab writes after every Plaid refresh (FinanceExport);
   · health   — today's row of health-log.json, for mornings the brief has no WHOOP reading;
   · focus    — focus-history.jsonl, the minutes of focus actually served today.
 A missing or malformed file is "nothing to say", never an error on screen.
*/

/// One saved project-agent run, as much as Home needs of it.
struct HomeProject: Equatable {
    enum Phase: Equatable {
        /// Status running and a live heartbeat.
        case running
        /// Says running, but the supervisor has stopped reporting.
        case stalled
        /// An open escalation: a question or a parked task that needs Nick.
        case needsYou(String)
        /// Every task accepted, the final review not done (or the controller is waiting for a review).
        case review
        /// Completed, paused, never started: nothing for Home to say.
        case idle
    }

    let id: String
    let name: String
    let phase: Phase
    let accepted: Int
    let total: Int
    let activeTask: String?
    /// When the phase was last true: the heartbeat for running/stalled, the escalation for needsYou.
    let since: Date?

    var progress: String { "\(accepted)/\(total)" }

    /// An escalation older than this is history, not news (a run parked a month ago is not "needs you" today).
    static let needsYouWindow: TimeInterval = 7 * 86_400
    /// A heartbeat older than this is a run that died long ago, not one that just stalled.
    static let stalledWindow: TimeInterval = 24 * 3_600

    /// Whether this project is worth a card or a glance count at `now`.
    func isCurrent(at now: Date) -> Bool {
        let age = since.map { now.timeIntervalSince($0) }
        switch phase {
        case .running, .review: return true
        case .needsYou: return (age ?? .infinity) <= Self.needsYouWindow
        case .stalled: return (age ?? .infinity) <= Self.stalledWindow
        case .idle: return false
        }
    }

    /// The Projects tab's reading of a run, folded to a phase.
    static func make(id: String, name: String, state: ProjectAgentStatus, heartbeat: ProjectAgentHeartbeat?, now: Date) -> HomeProject {
        let heartbeatAt = heartbeat.flatMap { WakeAlarmPlan.parseISO($0.at) }
        let live = heartbeat.map { $0.phase != "stopped" } ?? false
            && heartbeatAt.map { now.timeIntervalSince($0) < 60 && now.timeIntervalSince($0) >= -1 } ?? false
        let phase: Phase
        var since = heartbeatAt
        if let open = state.openEscalations.last {
            phase = .needsYou(open.question?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? open.reason)
            since = WakeAlarmPlan.parseISO(open.at)
        } else if state.status == .running {
            phase = live ? .running : .stalled
        } else if state.status == .waiting_for_review || (state.awaitingFinalReview && state.status != .completed) {
            phase = .review
        } else {
            phase = .idle
        }
        return HomeProject(id: id, name: name, phase: phase, accepted: state.acceptedCount, total: state.tasks.count,
                           activeTask: state.active?.title, since: since)
    }
}

/// finance-summary.json, as much as Home needs of it.
struct HomeFinance: Equatable {
    struct Recurring: Equatable {
        let name: String
        let amount: Double
        /// Last time the charge cleared, when the export recorded it.
        let lastSeen: Date?
    }

    let currency: String
    let spentThisWeek: Double
    let spentThisMonth: Double
    let topCategory: String?
    let recurring: [Recurring]
    let writtenAt: Date

    /// Older than this, the numbers describe a different week.
    static let staleAfter: TimeInterval = 3 * 86_400

    func isFresh(at now: Date) -> Bool { now.timeIntervalSince(writtenAt) <= Self.staleAfter }
    var recurringTotal: Double { recurring.reduce(0) { $0 + $1.amount } }
}

/// One day of health-log.json.
struct HomeHealthDay: Equatable {
    var recovery: Int?
    var sleepHours: Double?
    var sleepPerformance: Int?

    var isEmpty: Bool { recovery == nil && sleepHours == nil }
}

// MARK: - Parsing

enum HomeSectionReader {
    static func finance(_ data: Data) -> HomeFinance? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let stamp = root["writtenAt"] as? String, let written = WakeAlarmPlan.parseISO(stamp) else { return nil }
        let accounts = root["accounts"] as? [[String: Any]] ?? []
        let currency = accounts.compactMap { $0["currency"] as? String }.first ?? "USD"
        let top = (root["topCategoriesThisMonth"] as? [[String: Any]])?.first?["category"] as? String
        let recurring = (root["recurring"] as? [[String: Any]] ?? []).compactMap { row -> HomeFinance.Recurring? in
            guard let name = row["name"] as? String, let amount = number(row["amount"]) else { return nil }
            return HomeFinance.Recurring(name: name, amount: amount, lastSeen: (row["lastSeen"] as? String).flatMap(day))
        }
        return HomeFinance(currency: currency, spentThisWeek: number(root["spentThisWeek"]) ?? 0,
                           spentThisMonth: number(root["spentThisMonth"]) ?? 0, topCategory: top,
                           recurring: recurring, writtenAt: written)
    }

    /// Today's row of health-log.json (`days["2026-11-02"]`).
    static func healthDay(_ data: Data, dayKey: String) -> HomeHealthDay? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let row = (root["days"] as? [String: Any])?[dayKey] as? [String: Any] else { return nil }
        let day = HomeHealthDay(recovery: number(row["recovery"]).map { Int($0) },
                                sleepHours: number(row["sleepHours"]).flatMap { $0 > 0 ? $0 : nil },
                                sleepPerformance: number(row["sleepPerformance"]).map { Int($0) })
        return day.isEmpty ? nil : day
    }

    /// Whole minutes of focus served on `dayKey`, from focus-history.jsonl. Nil when the log has no rows at all.
    static func focusMinutes(_ jsonl: String, dayKey: String) -> Int? {
        let rows = jsonl.split(separator: "\n").compactMap {
            (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any]
        }
        guard !rows.isEmpty else { return nil }
        let seconds = rows.filter { ($0["dayKey"] as? String) == dayKey }.reduce(0.0) { $0 + (number($1["servedFocusSeconds"]) ?? 0) }
        return Int(seconds / 60)
    }

    /// "yyyy-MM-dd" for `date` in `calendar`'s zone.
    static func dayKey(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Every saved run that has a readable state, newest project first (SavedProject's order).
    static func projects(at home: URL = SavedProject.home, now: Date) -> [HomeProject] {
        SavedProject.readAll(at: home).projects.compactMap { project in
            guard case .available(let state) = project.state else { return nil }
            return HomeProject.make(id: project.id, name: project.name, state: state, heartbeat: project.heartbeat, now: now)
        }
    }

    private static func number(_ value: Any?) -> Double? {
        switch value {
        case let value as Double: return value.isFinite ? value : nil
        case let value as Int: return Double(value)
        case let value as NSNumber: return value.doubleValue
        default: return nil
        }
    }

    private static func day(_ text: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: text)
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
