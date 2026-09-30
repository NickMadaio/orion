import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import UserNotifications

/*
 The Screen Time monitor (2026-09-30): runs when a usage threshold ORION set
 (App/ScreenWatch.swift) is reached, even with ORION closed. Nudges first;
 locks only in a work block or after bedtime, only after two nudges, and only
 if Nick turned Focus lock on. Free time is never locked. Every event is also
 written to the app group so ORION can learn from it.
*/
final class ScreenMonitor: DeviceActivityMonitor {
    private let defaults = UserDefaults(suiteName: "group.com.nickmadaio.orion")
    private let store = ManagedSettingsStore(named: .init("orion.focus"))

    private func about(_ activity: DeviceActivityName) -> [String: String] {
        guard let data = defaults?.data(forKey: "orion.screen.about"),
              let all = try? JSONSerialization.jsonObject(with: data) as? [String: [String: String]] else { return [:] }
        return all[activity.rawValue] ?? [:]
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        let info = about(activity)
        let kind = info["kind"] ?? "day"
        let title = info["title"] ?? "this"
        record(activity: activity.rawValue, event: event.rawValue)
        switch (kind, event.rawValue) {
        case ("work", "nudge1"): notify("You planned \(title) now. 15 minutes on your phone so far — put it down and start.")
        case ("work", "nudge2"): notify("Half an hour on your phone during \(title). One more and I lock your apps until it's over.")
        case ("night", "nudge1"): notify("It's past bedtime and you're still scrolling. Phone down.")
        case ("night", "nudge2"): notify("20 minutes past bedtime on your phone. Every minute comes out of tomorrow. Bed.")
        case ("day", "long1"): notify("An hour on your phone today. Anything you meant to do?")
        case ("day", "long2"): notify("Two hours on your phone today. What's the plan for the rest of it?")
        case (_, "lock") where kind == "work" || kind == "night":
            lock(until: Double(info["end"] ?? "") ?? Date().addingTimeInterval(1800).timeIntervalSince1970, why: kind == "night" ? "until morning" : "until \(title) is over")
        default: break
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        if defaults?.string(forKey: "orion.screen.lockedBy") == activity.rawValue {
            store.clearAllSettings()
            defaults?.removeObject(forKey: "orion.screen.lockedBy")
            defaults?.removeObject(forKey: "orion.focuslock.until")
        }
    }

    private func lock(until: TimeInterval, why: String) {
        guard defaults?.bool(forKey: "orion.focuslock.enabled") == true,
              let data = defaults?.data(forKey: "orion.focuslock.selection"),
              let selection = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) else {
            notify("Still on your phone. (Turn on Focus lock in ORION if you want me to lock these apps next time.)")
            return
        }
        store.shield.applications = selection.applicationTokens
        store.shield.applicationCategories = .specific(selection.categoryTokens)
        defaults?.set(until, forKey: "orion.focuslock.until")
        notify("Locked your distracting apps \(why). Tap Started on ORION's check-in or open ORION to unlock.")
    }

    private func notify(_ text: String) {
        let content = UNMutableNotificationContent()
        content.title = "ORION"
        content.body = text
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "orion.screen.\(UUID().uuidString)", content: content, trigger: nil))
    }

    private func record(activity: String, event: String) {
        var log = defaults?.array(forKey: "orion.screen.events") as? [[String: String]] ?? []
        log.append(["at": ISO8601DateFormatter().string(from: Date()), "activity": activity, "event": event])
        defaults?.set(Array(log.suffix(200)), forKey: "orion.screen.events")
    }
}
