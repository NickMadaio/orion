import DeviceActivity
import FamilyControls
import ManagedSettings
import MobileCore
import SwiftUI
import UserNotifications

/*
 Locking distracting apps when Nick keeps ignoring ORION (2026-09-29).

 From his statement: "If I keep ignoring it, the intervention should escalate …
 and, where technically possible and explicitly permitted by me, temporarily
 restricting distracting apps." So:

 - Off until he turns it on here, and he picks the apps himself (Apple's own
   picker; ORION never sees which apps, only opaque tokens).
 - It engages only when a check-in has been ignored past its third nudge.
 - It releases the moment he taps Started or Done, and on its own after 45
   minutes (checked whenever ORION next runs — opening the app releases an
   expired lock). It can always be released here by hand.

 Uses Screen Time (Family Controls, individual authorization).
*/
@MainActor
final class FocusLock: ObservableObject {
    static let shared = FocusLock()

    /// Shared with the Screen Time monitor extension (ScreenMonitor), which
    /// nudges and locks from the same choices while ORION is not running.
    static let shared_defaults = UserDefaults(suiteName: "group.com.nickmadaio.orion")

    @Published var enabled = UserDefaults.standard.bool(forKey: "orion.focuslock.enabled") {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "orion.focuslock.enabled")
            Self.shared_defaults?.set(enabled, forKey: "orion.focuslock.enabled")
            if !enabled { release() }
        }
    }
    @Published var selection = FocusLock.loadSelection() {
        didSet {
            if let data = try? PropertyListEncoder().encode(selection) {
                UserDefaults.standard.set(data, forKey: "orion.focuslock.selection")
                Self.shared_defaults?.set(data, forKey: "orion.focuslock.selection")
            }
        }
    }

    /// Copy the current choices where the extension can read them (on launch).
    func mirror() {
        Self.shared_defaults?.set(enabled, forKey: "orion.focuslock.enabled")
        if FocusLists.shared.isEmpty(.feeds), hasApps { FocusLists.shared.set(selection, for: .feeds) }
        store.clearAllSettings()
        if let data = try? PropertyListEncoder().encode(selection) { Self.shared_defaults?.set(data, forKey: "orion.focuslock.selection") }
    }
    /// Read from the app group: the Screen Time monitor locks while ORION is
    /// closed and writes there, so the app must look there too (2026-10-01).
    @Published private(set) var lockedUntil: Date? = FocusLock.groupDate("orion.focuslock.until")

    private static func groupDate(_ key: String) -> Date? {
        let t = shared_defaults?.double(forKey: key) ?? 0; return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }
    @Published private(set) var problem: String?

    private let store = ManagedSettingsStore(named: .init("orion.focus"))

    private static func loadSelection() -> FamilyActivitySelection {
        guard let data = UserDefaults.standard.data(forKey: "orion.focuslock.selection"),
              let value = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) else { return FamilyActivitySelection() }
        return value
    }

    var hasApps: Bool { !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty }

    func authorize() async -> Bool {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            problem = nil
            return true
        } catch {
            problem = "Screen Time access wasn't granted, so ORION can't lock apps."
            enabled = false
            return false
        }
    }

    /// An ignored check-in at level 3+: lock the chosen apps for a while.
    func engage(minutes: Int) {
        guard enabled, hasApps, AuthorizationCenter.shared.authorizationStatus == .approved else { return }
        FocusLists.shared.block([.feeds, .video, .games])
        let until = Date().addingTimeInterval(Double(minutes * 60))
        lockedUntil = until
        Self.shared_defaults?.set(until.timeIntervalSince1970, forKey: "orion.focuslock.until")
        Self.shared_defaults?.set("checkin", forKey: "orion.screen.lockWhy")
    }

    func release() {
        store.clearAllSettings()
        FocusLists.shared.unblockAll()
        lockedUntil = nil
        for key in ["orion.focuslock.until", "orion.screen.lockWhy", "orion.screen.lockedBy"] { Self.shared_defaults?.removeObject(forKey: key) }
    }

    /// Called whenever ORION runs: a lock past its time comes off.
    func releaseIfExpired(now: Date = Date()) {
        lockedUntil = Self.groupDate("orion.focuslock.until")
        if let lockedUntil, now >= lockedUntil { release() }
    }

    /// A new day: once he is up, the night lock comes off (2026-10-01: "my phone's
    /// been locked all night … it's a new day, so my phone shouldn't be locked").
    /// Only a NIGHT lock, only in the morning; work-block locks keep their own end.
    func releaseNightLock(awakeAt moment: Date = Date(), calendar: Calendar = .current) {
        let hour = calendar.component(.hour, from: moment)
        let why = Self.shared_defaults?.string(forKey: "orion.screen.lockWhy")
        let by = Self.shared_defaults?.string(forKey: "orion.screen.lockedBy")
        // A lock with no recorded reason was left by the build that never wrote one; in the morning it is last night's.
        let legacy = why == nil && by == nil && Self.groupDate("orion.focuslock.until") != nil
        guard (4..<14).contains(hour), why == "night" || by == "night" || legacy else { return }
        release()
        let content = UNMutableNotificationContent()
        content.title = "ORION"
        content.body = "Morning. Your apps are unlocked."
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "orion.screen.morning", content: content, trigger: nil))
    }

    /// What ORION on the Mac should know (2026-10-01: Nick asked for 20 more
    /// minutes and ORION said nothing was locked — it could not see the phone).
    static func screenState(now: Date = Date()) -> LinkLog {
        let iso = ISO8601DateFormatter()
        let until = groupDate("orion.focuslock.until").flatMap { $0 > now ? $0 : nil }
        let grace = groupDate("orion.screen.graceUntil").flatMap { $0 > now ? $0 : nil }
        return .screen(at: iso.string(from: now), locked: until != nil && grace == nil,
                       until: until.map(iso.string), why: until == nil ? nil : shared_defaults?.string(forKey: "orion.screen.lockWhy"),
                       graceUntil: grace.map(iso.string), usedMinutes: Dictionary(uniqueKeysWithValues: AppList.allCases.map { list in
                           let usedAt = groupDate("orion.focuslists.usedAt." + list.rawValue)
                           let fresh = usedAt.map { Calendar.current.isDate($0, inSameDayAs: now) && now.timeIntervalSince($0) < 300 } ?? false
                           return (list.rawValue, fresh ? shared_defaults?.integer(forKey: "orion.focuslists.used." + list.rawValue) ?? 0 : 0)
                       }))
    }

    /// Extra time ORION granted ("unblock my apps until 12:45"): lift the lock
    /// now; the Screen Time monitor puts it back at `until` if the lock's own
    /// window is still running, even with ORION closed. Applied once per grant.
    func grant(_ grant: LinkSnapshot.ScreenGrant, now: Date = Date()) {
        guard grant.until > now, Self.shared_defaults?.string(forKey: "orion.screen.grantApplied") != grant.id else { return }
        Self.shared_defaults?.set(grant.id, forKey: "orion.screen.grantApplied")
        Self.shared_defaults?.set(grant.until.timeIntervalSince1970, forKey: "orion.screen.graceUntil")
        store.clearAllSettings()
        FocusLists.shared.unblockAll()
        // DeviceActivity intervals are at least 15 minutes; ending at `until` is what matters.
        let calendar = Calendar.current
        let start = min(now, grant.until.addingTimeInterval(-15 * 60))
        let parts: (Date) -> DateComponents = { calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: $0) }
        let center = DeviceActivityCenter()
        center.stopMonitoring([DeviceActivityName("grace")])
        try? center.startMonitoring(DeviceActivityName("grace"),
                                    during: DeviceActivitySchedule(intervalStart: parts(start), intervalEnd: parts(grant.until), repeats: false))
        let content = UNMutableNotificationContent()
        content.title = "ORION"
        content.body = "Apps unlocked until \(grant.until.formatted(date: .omitted, time: .shortened))."
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "orion.screen.grant.\(grant.id)", content: content, trigger: nil))
    }
}

/// Control ▸ Focus lock.
struct FocusLockSection: View {
    @ObservedObject var lock: FocusLock
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Focus lock", tint: Phone.soft)
            Toggle(isOn: Binding(get: { lock.enabled }, set: { value in
                if value { Task { if await lock.authorize() { lock.enabled = true; if !lock.hasApps { picking = true } } } }
                else { lock.enabled = false }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Lock distracting apps when I ignore ORION").font(.system(size: 15, weight: .medium))
                    Text("Only after a check-in has been ignored three times. Tapping Started or Done unlocks them; otherwise they unlock after 45 minutes.")
                        .font(.system(size: 12)).foregroundStyle(Phone.dim)
                }
            }
            .tint(Phone.accent)
            if lock.enabled {
                NavigationLink("Named app lists") { FocusListsView() }
                Button { picking = true } label: {
                    Label(lock.hasApps ? "Change which apps (\(lock.selection.applicationTokens.count) apps, \(lock.selection.categoryTokens.count) categories)" : "Choose apps to lock", systemImage: "apps.iphone")
                }
                .buttonStyle(PhoneButtonStyle())
            }
            if let until = lock.lockedUntil {
                HStack {
                    Text("Locked until \(until.formatted(date: .omitted, time: .shortened))").font(.system(size: 13)).foregroundStyle(Phone.orange)
                    Spacer()
                    Button("Unlock now") { lock.release() }.font(.system(size: 13, weight: .semibold))
                }
            }
            if let problem = lock.problem { Text(problem).font(.footnote).foregroundStyle(Phone.orange) }
        }
        .familyActivityPicker(isPresented: $picking, selection: $lock.selection)
    }
}
