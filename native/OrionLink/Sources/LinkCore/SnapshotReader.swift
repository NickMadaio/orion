import Foundation
import MobileCore

/// Reads ORION's own state files into the parts of a `LinkSnapshot` that files
/// can answer. Hardware facts (battery, disk, apps) come from the app layer.
///
/// Every reader tolerates a missing or unreadable file by returning nothing for
/// it: an absent project, approval or feed is shown as absent, never invented.
public struct SnapshotReader {
    public let home: URL
    public init(home: URL = URL(fileURLWithPath: NSHomeDirectory())) { self.home = home }

    var controlled: URL { home.appendingPathComponent(".openclaw/orion-controlled") }
    var projectsDir: URL { controlled.appendingPathComponent("project-agent/projects") }
    var ticketsDir: URL { home.appendingPathComponent(".openclaw/orion-gate/approvals/tickets") }
    var grantsDir: URL { home.appendingPathComponent(".openclaw/orion-gate/approvals/grants") }
    var runningDir: URL { controlled.appendingPathComponent("actions/running") }
    var feedFile: URL { controlled.appendingPathComponent("attention-today.json") }
    var lockFile: URL { controlled.appendingPathComponent("lock.json") }
    var healthFile: URL { controlled.appendingPathComponent("health-log.json") }
    var planFile: URL { controlled.appendingPathComponent("today-plan.json") }

    // MARK: - Lock

    public func locked() -> Bool {
        guard let object = json(lockFile) as? [String: Any] else { return false }
        return object["locked"] as? Bool == true
    }

    // MARK: - Agent runs

    /// Live runs first, then the most recently changed; at most `limit`.
    public func runs(now: Date = Date(), limit: Int = 4) -> [LinkSnapshot.Run] {
        let entries = (try? FileManager.default.contentsOfDirectory(at: projectsDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let read: [(LinkSnapshot.Run, Date)] = entries.compactMap { dir in
            guard !dir.lastPathComponent.hasPrefix("."), let run = run(in: dir, now: now) else { return nil }
            let stateURL = dir.appendingPathComponent("state.json")
            let changed = (try? stateURL.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            return (run, changed)
        }
        return read.sorted { a, b in
            if a.0.live != b.0.live { return a.0.live }
            return a.1 > b.1
        }.prefix(limit).map(\.0)
    }

    func run(in dir: URL, now: Date) -> LinkSnapshot.Run? {
        guard let project = json(dir.appendingPathComponent("project.json")) as? [String: Any],
              let id = project["id"] as? String, let name = project["name"] as? String,
              let state = json(dir.appendingPathComponent("state.json")) as? [String: Any],
              let tasks = state["tasks"] as? [[String: Any]], !tasks.isEmpty else { return nil }
        let beat = json(dir.appendingPathComponent("heartbeat.json")) as? [String: Any]
        let live = Self.isLive(beat, now: now)
        let accepted = tasks.filter { ($0["status"] as? String) == "accepted" }
        let totalWeight = tasks.reduce(0.0) { $0 + (($1["weight"] as? Double) ?? 1) }
        let doneWeight = accepted.reduce(0.0) { $0 + (($1["weight"] as? Double) ?? 1) }
        let status = state["status"] as? String ?? ""
        let finalReview = state["finalReview"] as? Bool == true
        var percent = totalWeight > 0 ? Int((doneWeight / totalWeight * 100).rounded(.down)) : 0
        if !(status == "completed" && finalReview) { percent = min(percent, 99) }
        let escalations = state["escalations"] as? [[String: Any]] ?? []
        let open = escalations.filter { $0["resolvedAt"] == nil || $0["resolvedAt"] is NSNull }
        let deferred = open.filter { $0["deferred"] as? Bool == true }.count
        let activeID = state["activeTask"] as? String
        let active = tasks.first { ($0["id"] as? String) == activeID }
        let step: String? = (active?["subtask"] as? [String: Any]).flatMap { sub in
            guard let label = sub["label"] as? String else { return nil }
            let clean = label.trimmingCharacters(in: CharacterSet(charactersIn: "—–- ").union(.whitespaces))
            if let index = sub["index"] as? Int, let total = sub["total"] as? Int, total > 1 { return "\(index)/\(total) · \(clean)" }
            return clean
        }
        let holding = state["pauseRequested"] as? Bool == true || state["stopRequested"] as? Bool == true || status == "paused"
        let runStatus: LinkSnapshot.Run.Status
        if status == "completed" { runStatus = .complete }
        else if status == "escalated" || (!live && open.contains { $0["deferred"] as? Bool != true }) { runStatus = .needsYou }
        else if live && holding { runStatus = .paused }
        else if live { runStatus = .working }
        else { runStatus = holding ? .paused : .stopped }
        let since = (beat?["roleSince"] as? String).flatMap(Self.parseDate)
        return LinkSnapshot.Run(
            id: id, project: name, status: runStatus, live: live,
            role: live ? beat?["role"] as? String : nil, model: live ? beat?["model"] as? String : nil,
            activeTask: active?["title"] as? String, step: step,
            accepted: accepted.count, total: tasks.count, percent: percent,
            minutesOnTask: live ? since.map { max(0, Int(now.timeIntervalSince($0) / 60)) } : nil,
            deferred: deferred)
    }

    /// The same rule as the Mac app: a recent beat from a supervisor that has not stopped.
    static func isLive(_ beat: [String: Any]?, now: Date) -> Bool {
        guard let beat, let at = (beat["at"] as? String).flatMap(parseDate) else { return false }
        let age = now.timeIntervalSince(at)
        return (beat["phase"] as? String) != "stopped" && age >= -1 && age < 60
    }

    // MARK: - Approvals

    /// Waiting and unexpired, soonest to expire first; a granted ticket is not waiting.
    public func approvals(now: Date = Date()) -> [LinkSnapshot.Approval] {
        let granted = Set(names(in: grantsDir).map { ($0 as NSString).deletingPathExtension })
        return names(in: ticketsDir).compactMap { name -> LinkSnapshot.Approval? in
            guard let ticket = json(ticketsDir.appendingPathComponent(name)) as? [String: Any],
                  let id = ticket["id"] as? String, !granted.contains(id),
                  let expires = (ticket["expiresAt"] as? String).flatMap(Self.parseDate), expires > now else { return nil }
            return LinkSnapshot.Approval(id: id, action: ticket["action"] as? String ?? "unknown",
                                         summary: ticket["summary"] as? String ?? "",
                                         context: ticket["context"] as? String ?? "", expiresAt: expires)
        }.sorted { $0.expiresAt < $1.expiresAt }
    }

    // MARK: - Running actions

    public func running() -> [LinkSnapshot.RunningAction] {
        names(in: runningDir).compactMap { name -> LinkSnapshot.RunningAction? in
            guard let item = json(runningDir.appendingPathComponent(name)) as? [String: Any],
                  let id = item["taskId"] as? String else { return nil }
            let commands = item["commands"] as? [String] ?? []
            return LinkSnapshot.RunningAction(id: id, title: commands.first ?? item["goal"] as? String ?? id,
                                              actions: item["actions"] as? [String] ?? [],
                                              startedAt: (item["startedAt"] as? String).flatMap(Self.parseDate))
        }.sorted { ($0.startedAt ?? .distantPast) < ($1.startedAt ?? .distantPast) }
    }

    // MARK: - Attention feed

    public func attention() -> LinkSnapshot.Attention? {
        guard let feed = json(feedFile) as? [String: Any], feed["version"] as? Int == 1 else { return nil }
        func rows(_ key: String) -> [LinkSnapshot.AttentionRow] {
            (feed[key] as? [[String: Any]] ?? []).prefix(20).compactMap { row in
                guard let id = row["id"] as? String, let title = row["title"] as? String else { return nil }
                return .init(id: id, title: title, source: row["source"] as? String ?? "", reason: row["reason"] as? String)
            }
        }
        return .init(generatedAt: (feed["generatedAt"] as? String).flatMap(Self.parseDate),
                     interrupt: rows("interrupt"), today: rows("today"), note: feed["note"] as? String)
    }

    // MARK: - Health

    /// The last `days` recorded days of the Mac's health log, oldest first.
    /// Only the day-level numbers travel; supplements, meals and workouts do not.
    public func health(days: Int = 7) -> [LinkSnapshot.HealthDay] {
        guard let log = json(healthFile) as? [String: Any], let byDay = log["days"] as? [String: [String: Any]] else { return [] }
        func int(_ value: Any?) -> Int? { (value as? NSNumber).map { $0.intValue } }
        func double(_ value: Any?) -> Double? { (value as? NSNumber).map { $0.doubleValue } }
        return byDay.keys.sorted().suffix(days).compactMap { key -> LinkSnapshot.HealthDay? in
            guard let day = byDay[key] else { return nil }
            let entry = LinkSnapshot.HealthDay(
                date: key, recovery: int(day["recovery"]), hrv: int(day["hrv"]),
                restingHeartRate: int(day["restingHeartRate"]), sleepHours: double(day["sleepHours"]),
                sleepPerformance: int(day["sleepPerformance"]), strain: double(day["strain"]))
            let empty = entry.recovery == nil && entry.hrv == nil && entry.sleepHours == nil && entry.strain == nil
            return empty ? nil : entry
        }
    }

    // MARK: - Tracking and the day plan

    public func tracking(now: Date = Date()) -> LinkSnapshot.Tracking? {
        TrackingLog(file: healthFile).today(now: now)
    }

    /// The ORION app's accepted plan, only while it is still today's.
    public func plan(now: Date = Date(), calendar: Calendar = .current) -> TodayPlan? {
        struct Document: Decodable { let current: TodayPlan? }
        guard let data = try? Data(contentsOf: planFile), data.count < 2_000_000,
              let plan = (try? JSONDecoder().decode(Document.self, from: data))?.current,
              calendar.isDate(plan.day, inSameDayAs: now) else { return nil }
        return plan
    }

    /// The last plan request, while it is recent enough to still matter.
    public func planRequest(now: Date = Date()) -> LinkSnapshot.PlanRequest? {
        guard let request = PlanRequestFile.read(PlanRequestFile.url(home: home)),
              now.timeIntervalSince(request.at) < 6 * 3600 else { return nil }
        return request
    }

    /// "wake me up at 7:30" from `scripts/orion-wake`, while it is still ahead.
    public func wakeRequest(now: Date = Date()) -> Date? {
        guard let object = json(controlled.appendingPathComponent("wake-request.json")) as? [String: Any],
              let at = (object["at"] as? String).flatMap(Self.parseDate), at > now.addingTimeInterval(-3600) else { return nil }
        return at
    }

    /// Extra phone time from `scripts/orion-phone-time grant`, while it is still running.
    public func screenGrant(now: Date = Date()) -> LinkSnapshot.ScreenGrant? {
        guard let object = json(controlled.appendingPathComponent("screen-grant.json")) as? [String: Any],
              let id = object["id"] as? String, let until = (object["until"] as? String).flatMap(Self.parseDate),
              until > now else { return nil }
        return .init(id: id, until: until, because: object["because"] as? String)
    }

    /// Wake and sleep markers from `orion-watch` (night.json): planned or actual.
    public func night(calendar: Calendar = .current) -> [LinkSnapshot.NightDay]? {
        guard let object = json(controlled.appendingPathComponent("night.json")) as? [String: Any],
              let days = object["days"] as? [[String: Any]] else { return nil }
        let parse = DateFormatter(); parse.locale = Locale(identifier: "en_US_POSIX"); parse.calendar = calendar
        parse.timeZone = calendar.timeZone; parse.dateFormat = "yyyy-MM-dd"
        let rows: [(String, Date, [String: Any])] = days.compactMap { day in
            guard let date = day["date"] as? String, let midnight = parse.date(from: date) else { return nil }
            return (date, midnight, day)
        }
        let minute = { (midnight: Date, value: Any?) in (value as? NSNumber).map { midnight.addingTimeInterval($0.doubleValue * 60) } }
        let result: [LinkSnapshot.NightDay] = rows.map { date, midnight, day in
            let previous = rows.first { calendar.date(byAdding: .day, value: 1, to: $0.1) == midnight }
            let asleep = (previous?.2["asleepAt"] as? NSNumber)?.intValue
            return .init(date: date, wake: minute(midnight, day["wake"]), woke: day["woke"] as? Bool ?? false,
                         bed: minute(midnight, day["bed"]),
                         fellAsleep: asleep.flatMap { $0 >= 1440 ? midnight.addingTimeInterval(Double(($0 - 1440) * 60)) : nil })
        }
        return result.isEmpty ? nil : result
    }

    // MARK: - Check-ins and the widgets

    /// The follow-up that matters most right now: one being chased, else one in
    /// progress, else the next one waiting. `orion-checkin` keeps times in whole
    /// minutes since 1970.
    public func checkin(now: Date = Date()) -> OrionGlance.Checkin? {
        guard let object = json(controlled.appendingPathComponent("checkins.json")) as? [String: Any],
              let items = object["checkins"] as? [[String: Any]] else { return nil }
        let minute = { (value: Any?) in (value as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue * 60) } }
        let open: [OrionGlance.Checkin] = items.compactMap { item in
            guard let id = item["id"] as? String, let what = item["what"] as? String,
                  let loop = item["loop"] as? [String: Any], let phase = loop["phase"] as? String,
                  !["done", "cancelled", "given_up"].contains(phase) else { return nil }
            return .init(id: id, what: what, phase: phase, level: (loop["level"] as? NSNumber)?.intValue ?? 0,
                         due: minute(item["dueAt"]), nextCheck: minute(loop["nextCheckAt"]))
        }
        func rank(_ c: OrionGlance.Checkin) -> Int { c.chasing ? 0 : c.phase == "active" ? 1 : 2 }
        return open.filter { rank($0) < 2 || ($0.due ?? .distantFuture) < now.addingTimeInterval(3 * 3600) }
            .sorted { (rank($0), $0.due ?? .distantFuture) < (rank($1), $1.due ?? .distantFuture) }.first
    }

    /// The ORION app's calendar export (see GlanceExport.swift there), while fresh.
    public func glanceCalendar(now: Date = Date()) -> OrionGlance? {
        guard let glance = GlanceFile.read(controlled.appendingPathComponent("glance-calendar.json")),
              now.timeIntervalSince(glance.generatedAt) < 6 * 3600,
              Calendar.current.isDate(glance.generatedAt, inSameDayAs: now) else { return nil }
        return glance
    }

    /// Everything the Mac's widgets show, from one snapshot plus the calendar export.
    public func glance(from snapshot: LinkSnapshot, now: Date = Date()) -> OrionGlance {
        let calendar = glanceCalendar(now: now)
        let recovery = snapshot.health?.last { $0.date == TrackingLog.dayKey(at: now) }?.recovery
        let night: OrionGlance.Night? = snapshot.wakeRequest.map { OrionGlance.Night(bed: $0.addingTimeInterval(-9 * 3600), alarm: $0, reason: "you asked") }
        return OrionGlance(generatedAt: now, source: "mac",
                           blocks: OrionGlance.merge(events: calendar?.blocks ?? [], plan: snapshot.plan),
                           tomorrow: calendar?.tomorrow ?? [], todos: calendar?.todos ?? [],
                           projects: OrionGlance.projects(from: snapshot.runs), checkin: snapshot.checkin,
                           deadlines: calendar?.deadlines ?? [], tracking: OrionGlance.tracking(from: snapshot.tracking),
                           night: night, recovery: recovery, approvals: snapshot.approvals.count)
    }

    // MARK: - Helpers

    func json(_ url: URL) -> Any? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    func names(in dir: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".json") && !$0.hasPrefix(".") }
    }

    static func parseDate(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
