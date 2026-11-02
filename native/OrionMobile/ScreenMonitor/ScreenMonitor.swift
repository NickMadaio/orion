import CloudKit
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
    private let store = ManagedSettingsStore(named: .init("orion.focus.lists"))

    private func about(_ activity: DeviceActivityName) -> [String: String] {
        guard let data = defaults?.data(forKey: "orion.screen.about"),
              let all = try? JSONSerialization.jsonObject(with: data) as? [String: [String: String]] else { return [:] }
        return all[activity.rawValue] ?? [:]
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        // Three minutes on the phone after the alarm: he is up (2026-10-08).
        if activity.rawValue.hasPrefix("morning") {
            record(activity: activity.rawValue, event: event.rawValue)
            reportWake("used")
            return
        }
        let info = about(activity)
        if let list = info["list"] {
            let reached = Self.minutes(forEvent: event.rawValue, list: list)
            let today = Calendar.current.isDateInToday(Date(timeIntervalSince1970: defaults?.double(forKey: "orion.focuslists.usedAt." + list) ?? 0))
            // Several windows watch the same group: keep the largest reading of the day, never a smaller one.
            defaults?.set(max(reached, today ? defaults?.integer(forKey: "orion.focuslists.used." + list) ?? 0 : 0), forKey: "orion.focuslists.used." + list)
            defaults?.set(Date().timeIntervalSince1970, forKey: "orion.focuslists.usedAt." + list)
        }
        let kind = info["kind"] ?? "day"
        let title = info["title"] ?? "this"
        record(activity: activity.rawValue, event: event.rawValue)
        switch (kind, event.rawValue) {
        case ("work", "nudge1"): notify("You planned \(title) now. 10 minutes on your phone so far — put it down and start.")
        case ("work", "nudge2"): notify("Half an hour on your phone during \(title). One more and I lock your apps until it's over.")
        case ("night", "nudge1"): notify("It's past bedtime and you're still scrolling. Phone down.")
        case ("night", "nudge2"): notify("20 minutes past bedtime on your phone. Every minute comes out of tomorrow. Bed.")
        case ("day", "long1"): notify("An hour on your phone today. Anything you meant to do?")
        case ("day", "long2"): notify("Two hours on your phone today. What's the plan for the rest of it?")
        case (_, "cap"):
            lock(activity: activity.rawValue, kind: "day", until: Double(info["end"] ?? "") ?? Date().addingTimeInterval(1800).timeIntervalSince1970, why: "daily app-list limit")
        case (_, "lock") where kind == "work" || kind == "night":
            lock(activity: activity.rawValue, kind: kind,
                 until: Double(info["end"] ?? "") ?? Date().addingTimeInterval(1800).timeIntervalSince1970,
                 why: kind == "night" ? "until morning" : "until \(title) is over")
        default: break
        }
    }

    /// Minutes of use an event stands for: the fixed nudges, and the "u<N>" steps ScreenWatch adds every few minutes.
    static func minutes(forEvent name: String, list: String) -> Int {
        if name.hasPrefix("u"), let n = Int(name.dropFirst()) { return n }
        switch name {
        case "nudge1": return 10
        case "lock": return 15
        case "long1": return list == "games" ? 80 : 110
        case "cap": return list == "games" ? 90 : 120
        default: return 0
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Extra time ORION granted is over: back on, if the lock's own window still runs.
        if activity.rawValue == "grace" {
            defaults?.removeObject(forKey: "orion.screen.graceUntil")
            let until = defaults?.double(forKey: "orion.focuslock.until") ?? 0
            if until > Date().timeIntervalSince1970, shield() {
                notify("Time's up. Apps locked again until \(clock(until)).")
            }
            return
        }
        // The night window ends at the alarm: a night lock comes off then, including
        // one left by a build that never recorded which window locked it.
        if about(activity)["list"] != nil || defaults?.string(forKey: "orion.screen.lockedBy") == activity.rawValue
            || (activity.rawValue == "night" && defaults?.string(forKey: "orion.screen.lockWhy") != "work") {
            let blocked = (defaults?.stringArray(forKey: "orion.focuslists.blocked") ?? []).filter { name in (defaults?.double(forKey: "orion.focuslists.until." + name) ?? 0) > Date().timeIntervalSince1970 }
            defaults?.set(blocked, forKey: "orion.focuslists.blocked")
            store.clearAllSettings(); if !blocked.isEmpty { _ = shield() }
            for key in ["orion.screen.lockedBy", "orion.focuslock.until", "orion.screen.lockWhy"] { defaults?.removeObject(forKey: key) }
        }
    }

    /// Put the shield on the blocked groups only; false when Focus lock is off or no group with apps is blocked.
    /// There is no fallback to the combined selection: asked for one group, shielding all of them is the bug.
    private func shield() -> Bool {
        guard defaults?.bool(forKey: "orion.focuslock.enabled") == true else { store.clearAllSettings(); return false }
        let blocked = defaults?.stringArray(forKey: "orion.focuslists.blocked") ?? []
        let selections = blocked.compactMap { name -> FamilyActivitySelection? in
            guard let data = defaults?.data(forKey: "orion.focuslists." + name) else { return nil }
            return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
        }
        let apps = selections.reduce(into: Set<ApplicationToken>()) { $0.formUnion($1.applicationTokens) }
        let categories = selections.reduce(into: Set<ActivityCategoryToken>()) { $0.formUnion($1.categoryTokens) }
        let domains = selections.reduce(into: Set<WebDomainToken>()) { $0.formUnion($1.webDomainTokens) }
        guard !apps.isEmpty || !categories.isEmpty || !domains.isEmpty else { store.clearAllSettings(); return false }
        store.shield.applications = apps.isEmpty ? nil : apps
        store.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
        store.shield.webDomains = domains.isEmpty ? nil : domains
        store.shield.webDomainCategories = categories.isEmpty ? nil : .specific(categories)
        return true
    }

    private func clock(_ time: TimeInterval) -> String {
        let formatter = DateFormatter(); formatter.timeStyle = .short
        return formatter.string(from: Date(timeIntervalSince1970: time))
    }

    private func lock(activity: String, kind: String, until: TimeInterval, why: String) {
        guard defaults?.bool(forKey: "orion.focuslock.enabled") == true else { notify("Still using distracting apps. Enable Focus lock to apply a shield."); return }
        // Every window ScreenWatch lays out is per group ("work.0.feeds", "night.video", "day.browsers"). A name that
        // does not end in a group is one an old build left behind: it locks nothing (it used to lock every app).
        guard let list = activity.split(separator: ".").last.map(String.init), Self.groups.contains(list) else { return }
        guard let data = defaults?.data(forKey: "orion.focuslists." + list),
              let picked = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data),
              !picked.applicationTokens.isEmpty || !picked.categoryTokens.isEmpty || !picked.webDomainTokens.isEmpty else {
            notify("Still on \(Self.title(list)). Pick apps for \(Self.title(list)) in ORION and I can lock them next time.")
            return
        }
        var blocked = defaults?.stringArray(forKey: "orion.focuslists.blocked") ?? []
        if !blocked.contains(list) { blocked.append(list) }
        defaults?.set(blocked, forKey: "orion.focuslists.blocked")
        defaults?.set(max(until, defaults?.double(forKey: "orion.focuslists.until." + list) ?? 0), forKey: "orion.focuslists.until." + list)
        defaults?.set(until, forKey: "orion.focuslock.until")
        defaults?.set(kind, forKey: "orion.screen.lockWhy")
        defaults?.set(activity, forKey: "orion.screen.lockedBy")
        if (defaults?.double(forKey: "orion.screen.graceUntil") ?? 0) <= Date().timeIntervalSince1970 { _ = shield(); notify("Locked \(Self.title(list)) \(why).") }
    }

    static let groups: Set<String> = ["messaging", "feeds", "video", "games", "browsers"]
    static func title(_ list: String) -> String { list == "feeds" ? "Social" : list.capitalized }

    private func notify(_ text: String) {
        let content = UNMutableNotificationContent()
        content.title = "ORION"
        content.body = text
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        let identifier = "orion.screen.\(UUID().uuidString)"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
        mirrorToThread(identifier: identifier, text: text)
    }

    /// W10-E: a phone-only notification is also a message in the chat thread, so his reply has something to answer. The
    /// same LinkCommand shape as MobileCore's PhoneMirror.record (the extension does not link MobileCore): device "orion",
    /// status done, the thread's conversation, askId = "phone." + the notification id. Waits (up to 20 s) so the extension
    /// is not torn down mid-save; on failure the app mirrors it from the notification center on its next sweep.
    private func mirrorToThread(identifier: String, text: String) {
        let id = String(("phone." + identifier).prefix(80))
        let zone = CKRecordZone.ID(zoneName: "OrionLink", ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: "LinkCommand", recordID: CKRecord.ID(recordName: id, zoneID: zone))
        record["text"] = "" as CKRecordValue
        record["sentAt"] = Date() as CKRecordValue
        record["device"] = "orion" as CKRecordValue
        record["kind"] = "chat" as CKRecordValue
        record["status"] = "done" as CKRecordValue
        record["reply"] = text as CKRecordValue
        record["conversationID"] = "phone-history" as CKRecordValue
        record["askId"] = id as CKRecordValue
        let done = DispatchSemaphore(value: 0)
        CKContainer(identifier: "iCloud.com.nickmadaio.orion").privateCloudDatabase
            .modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys, atomically: false) { _ in done.signal() }
        _ = done.wait(timeout: .now() + 20)
    }

    /// The same LinkCommand the app's CloudLink.sendNow writes: a `LinkLog.sleep`
    /// for the Mac, which decides whether to give the morning briefing. Waits
    /// (up to 20 s) so the extension is not torn down mid-save.
    private func reportWake(_ event: String) {
        let at = ISO8601DateFormatter().string(from: Date())
        let zone = CKRecordZone.ID(zoneName: "OrionLink", ownerName: CKCurrentUserDefaultName)
        let record = CKRecord(recordType: "LinkCommand", recordID: CKRecord.ID(recordName: UUID().uuidString, zoneID: zone))
        record["text"] = "{\"sleep\":{\"at\":\"\(at)\",\"event\":\"\(event)\"}}" as CKRecordValue
        record["sentAt"] = Date() as CKRecordValue
        record["status"] = "pending" as CKRecordValue
        record["device"] = "iphone" as CKRecordValue
        record["kind"] = "log" as CKRecordValue
        let done = DispatchSemaphore(value: 0)
        CKContainer(identifier: "iCloud.com.nickmadaio.orion").privateCloudDatabase
            .modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys, atomically: false) { [defaults] result in
                if case .failure = result { defaults?.set(at, forKey: "orion.wake.unsent") }
                done.signal()
            }
        _ = done.wait(timeout: .now() + 20)
    }

    private func record(activity: String, event: String) {
        var log = defaults?.array(forKey: "orion.screen.events") as? [[String: String]] ?? []
        log.append(["at": ISO8601DateFormatter().string(from: Date()), "activity": activity, "event": event])
        defaults?.set(Array(log.suffix(200)), forKey: "orion.screen.events")
    }
}
