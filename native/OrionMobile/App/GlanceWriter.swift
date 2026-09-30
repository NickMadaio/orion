import ActivityKit
import Foundation
import WidgetKit
import MobileCore

/*
 The phone's glance: what its widgets, lock screen and Dynamic Island show
 (2026-09-29).

 Built from what the phone knows first-hand — Calendar and Reminders — and
 from the Mac's last snapshot: ORION's plan, the agent runs, tracking, the
 check-in he is running and the deadlines ahead. Written to the app group
 whenever any of those change; the widgets are reloaded only when the
 content did, and the Live Activity follows the same glance.
*/
@MainActor
enum GlanceWriter {
    static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GlanceFile.phoneGroup)?
            .appendingPathComponent(GlanceFile.fileName)
    }

    static func compose(planner: PlannerStore, snapshot: LinkSnapshot?, night: NightPlan?, now: Date = Date()) -> OrionGlance {
        let days = planner.glanceBlocks(now: now)
        let plan = snapshot?.plan.flatMap { Calendar.current.isDate($0.day, inSameDayAs: now) ? $0 : nil }
        // The Mac's checkin is only as fresh as its snapshot: stale after 15 minutes.
        let fresh = snapshot.map { now.timeIntervalSince($0.generatedAt) < 15 * 60 } ?? false
        let recovery = snapshot?.health?.last { $0.date == TrackingDay.key(at: now) }?.recovery
        return OrionGlance(
            generatedAt: now, source: "iphone",
            blocks: OrionGlance.merge(events: days.today, plan: plan), tomorrow: days.tomorrow,
            todos: planner.glanceTodos, projects: OrionGlance.projects(from: snapshot?.runs ?? []),
            checkin: fresh ? snapshot?.checkin : nil, deadlines: snapshot?.deadlines ?? [],
            tracking: OrionGlance.tracking(from: snapshot?.tracking),
            night: night.map { OrionGlance.Night(bed: $0.bed, alarm: $0.wake, reason: $0.reason, note: $0.shifted) },
            recovery: recovery, approvals: fresh ? (snapshot?.approvals.count ?? 0) : 0)
    }

    /// The phone's calendar, kept for writes that happen without a screen
    /// (a snapshot arriving while ORION is in the background).
    static let planner = PlannerStore()

    /// From the link itself: new Mac state, whether or not any view is on screen.
    static func publish(snapshot: LinkSnapshot?) {
        publish(planner: planner, snapshot: snapshot, night: NightRoutine.shared.plan)
    }

    /// Write, reload the widgets if anything changed, and bring the lock screen in line.
    static func publish(planner: PlannerStore, snapshot: LinkSnapshot?, night: NightPlan?, now: Date = Date()) {
        // Early in a launch the Mac's snapshot or tonight's plan may not be loaded
        // yet. Fall back to the last known ones rather than writing a thinner
        // glance: every change reloads the widgets, and iOS rations reloads.
        if let snapshot { SnapshotCache.save(snapshot) }
        var glance = compose(planner: planner, snapshot: snapshot ?? SnapshotCache.load(), night: night, now: now)
        if glance.night == nil, let url, let previous = GlanceFile.read(url)?.night, previous.alarm.map({ $0 > now }) ?? false {
            glance.night = previous
        }
        if let url, (try? GlanceFile.write(glance, to: url)) == true {
            WidgetCenter.shared.reloadAllTimelines()
        }
        LivePresence.shared.sync(glance, now: now)
        ScreenWatch.sync(glance, now: now)
    }
}

extension GlanceWriter {
    /// A check-in answered from a notification: show it at once, before the Mac confirms.
    static func applyCheckinAnswer(_ action: String) {
        guard let url, var glance = GlanceFile.read(url) else { return }
        switch action {
        case "started": glance.checkin?.phase = "active"; glance.checkin?.level = 0; glance.checkin?.nextCheck = Date().addingTimeInterval(25 * 60)
        case "snooze": glance.checkin?.phase = "deferred"; glance.checkin?.nextCheck = Date().addingTimeInterval(10 * 60)
        default: glance.checkin = nil
        }
        if (try? GlanceFile.write(glance, to: url)) == true { WidgetCenter.shared.reloadAllTimelines() }
        LivePresence.shared.sync(glance)
    }
}

/// The health log's day key (the day turns at 4 AM), matching the Mac's.
enum TrackingDay {
    static func key(at now: Date) -> String {
        let shifted = now.addingTimeInterval(-4 * 3600)
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}
