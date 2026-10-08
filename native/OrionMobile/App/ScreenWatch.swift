import DeviceActivity
import FamilyControls
import Foundation
import MobileCore

/*
 Screen Time watching, from today's plan (2026-09-30).

 Nick's mission: ORION should "stop doomscrolling" — notice when he is on the
 apps he chose while he should be studying or asleep, nudge, and lock them if
 he keeps going (only with Focus lock on). The rules are the distraction rules
 (scripts/lib/life/distraction.mjs); the watching is Apple's: DeviceActivity
 schedules with usage thresholds, handled by the ScreenMonitor extension even
 when ORION is closed. The app only lays the schedules out:

   work.N   each class / study / deadline / side-project block today:
            nudge at 15 and 30 minutes on those apps, lock at 45 (until it ends)
   night    bedtime → wake: nudge at 10 and 20, lock at 30
   day      the whole day, outside the above: nudge at 60 and 120, never lock

 What each window is about is stored in the app group for the extension.
*/
@MainActor
enum ScreenWatch {
    private static var lastKey = ""
    static let defaults = UserDefaults(suiteName: GlanceFile.phoneGroup)

    static func sync(_ glance: OrionGlance, now: Date = Date()) {
        guard AuthorizationCenter.shared.authorizationStatus == .approved else { return }
        let lists = FocusLists.shared
        let selections = Dictionary(uniqueKeysWithValues: AppList.allCases.map { ($0, lists.selection(for: $0)) })
        let selection = FocusLock.shared.selection
        guard selections.values.contains(where: { !$0.applicationTokens.isEmpty || !$0.categoryTokens.isEmpty }) else {
            watchMorning(glance, now: now)
            return
        }
        let calendar = Calendar.current
        let work = glance.blocks.filter { ["study", "deadline", "side_project", "other"].contains($0.kind) && $0.end > now && $0.minutes >= 15 }.prefix(3)
        let key = work.map { "\($0.id)\($0.start)\($0.end)" }.joined() + "\(glance.night?.bed.timeIntervalSince1970 ?? 0)" + calendar.startOfDay(for: now).description + selections.values.map { String(describing: $0) }.sorted().joined()
        guard key != lastKey else { return }
        lastKey = key

        let center = DeviceActivityCenter()
        center.stopMonitoring()
        var about: [String: [String: String]] = [:]
        func events(_ selection: FamilyActivitySelection, _ steps: [(String, Int)]) -> [DeviceActivityEvent.Name: DeviceActivityEvent] {
            Dictionary(uniqueKeysWithValues: steps.map { name, minutes in
                (DeviceActivityEvent.Name(name), DeviceActivityEvent(applications: selection.applicationTokens,
                    categories: selection.categoryTokens, threshold: DateComponents(minute: minutes)))
            })
        }
        func schedule(_ from: Date, _ to: Date) -> DeviceActivitySchedule {
            DeviceActivitySchedule(intervalStart: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: from),
                                   intervalEnd: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: to), repeats: false)
        }
        for list in AppList.allCases where list != .messaging && !lists.isEmpty(list) {
        let selection = selections[list]!
        for (index, block) in work.enumerated() {
            let name = "work.\(index).\(list.rawValue)"
            let start = max(block.start, now)
            guard block.end.timeIntervalSince(start) >= 15 * 60 else { continue }
            try? center.startMonitoring(DeviceActivityName(name), during: schedule(start, block.end),
                                        events: events(selection, [("nudge1", 10), ("lock", 15)]))
            about[name] = ["list": list.rawValue, "kind": "work", "title": block.title, "end": String(block.end.timeIntervalSince1970)]
        }
        if let night = glance.night, let alarm = night.alarm, alarm > now {
            let start = max(night.bed, now)
            if alarm.timeIntervalSince(start) >= 15 * 60 {
                try? center.startMonitoring(DeviceActivityName("night." + list.rawValue), during: schedule(start, alarm),
                                            events: events(selection, [("nudge1", 10), ("lock", 15)]))
                about["night." + list.rawValue] = ["list": list.rawValue, "kind": "night", "title": "bedtime", "end": String(alarm.timeIntervalSince1970)]
            }
        }
        let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: now) ?? now
        if endOfDay.timeIntervalSince(now) >= 15 * 60 {
            try? center.startMonitoring(DeviceActivityName("day." + list.rawValue), during: schedule(now, endOfDay),
                                        events: events(selection, [("long1", list == .games ? 80 : 110), ("cap", list == .games ? 90 : 120)]))
            about["day." + list.rawValue] = ["list": list.rawValue, "kind": "day", "title": "today", "end": String(endOfDay.timeIntervalSince1970)]
        }
        }
        if let data = try? JSONSerialization.data(withJSONObject: about) { defaults?.set(data, forKey: "orion.screen.about") }
        watchMorning(glance, now: now)
    }
    /// "used": three minutes on the phone (any app) from 45 minutes before the
    /// alarm until four hours after it is one of the two signs he is really up
    /// (2026-10-08, WakeSignals). An event with no apps listed counts all use.
    /// Each morning is its own activity, remembered, and put back whenever it
    /// is missing: the plan moves on to tomorrow's alarm minutes after today's
    /// rings, and sync() stops every monitor when the day changes.
    static func watchMorning(_ glance: OrionGlance, now: Date = Date()) {
        let key = "orion.screen.mornings"
        var windows = (defaults?.dictionary(forKey: key) as? [String: [Double]]) ?? [:]
        let center = DeviceActivityCenter()
        if let alarm = glance.night?.alarm {
            let name = "morning." + String(Int(alarm.timeIntervalSince1970))
            // A moved alarm replaces that morning's window instead of adding a second.
            let replaced = windows.keys.filter { $0 != name && abs((windows[$0]?.first ?? 0) - alarm.timeIntervalSince1970) < 12 * 3600 }
            center.stopMonitoring(replaced.map { DeviceActivityName($0) })
            replaced.forEach { windows[$0] = nil }
            windows[name] = [alarm.addingTimeInterval(-45 * 60).timeIntervalSince1970, alarm.addingTimeInterval(4 * 3600).timeIntervalSince1970]
        }
        windows = windows.filter { $0.value.count == 2 && $0.value[1] > now.timeIntervalSince1970 + 15 * 60 }
        defaults?.set(windows, forKey: key)
        let running = Set(center.activities.map(\.rawValue))
        let calendar = Calendar.current
        let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute]
        for (name, span) in windows where !running.contains(name) {
            let start = max(Date(timeIntervalSince1970: span[0]), now)
            let end = Date(timeIntervalSince1970: span[1])
            try? center.startMonitoring(DeviceActivityName(name),
                                        during: DeviceActivitySchedule(intervalStart: calendar.dateComponents(parts, from: start),
                                                                       intervalEnd: calendar.dateComponents(parts, from: end), repeats: false),
                                        events: [DeviceActivityEvent.Name("used"): DeviceActivityEvent(threshold: DateComponents(minute: 3))])
        }
    }
}
