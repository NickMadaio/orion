import AppIntents
import UIKit
import MobileCore

/*
 Wake signals (2026-10-08). Nick: "two main gates for orion knowing im actually
 awake. one, yea using my phone for a few minutes. two, unplugging my phone.
 either work."

 Turning the alarm off is one tap and proves nothing. These two do:
   unplugged  the charger came off. iOS only tells a RUNNING app, so the real
              trigger is a Shortcuts automation ("When charger is disconnected →
              Phone unplugged", Run Immediately) that runs the intent below with
              ORION closed. While ORION happens to be open it notices itself.
   used       three minutes of phone use after the alarm, from the Screen Time
              monitor (ScreenWatch's "morning" window → ScreenMonitor).
 The phone only reports; the Mac decides (scripts/orion-morning: after the
 alarm, before 1 PM, once a morning) and says the day aloud.
*/
enum WakeSignals {
    private static let sentKey = "orion.wake.lastSent."

    /// Report a wake signal to the Mac, which decides whether it is a morning
    /// (scripts/orion-morning). One of each kind per half hour, so a charger
    /// wiggle is not a stream of records.
    static func send(_ event: String, at moment: Date = Date()) async {
        let last = UserDefaults.standard.double(forKey: sentKey + event)
        guard moment.timeIntervalSince1970 - last > 30 * 60 else { return }
        UserDefaults.standard.set(moment.timeIntervalSince1970, forKey: sentKey + event)
        await CloudLink.sendNow(.sleep(event: event, at: ISO8601DateFormatter().string(from: moment)))
    }

    @MainActor private static var observing = false

    /// While ORION is open, the charger coming off is seen directly.
    @MainActor static func observeCharger() {
        guard !observing else { return }
        observing = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { _ in
            guard UIDevice.current.batteryState == .unplugged else { return }
            Task { await send("unplugged") }
        }
    }
}

/// The Shortcuts action: "When charger is disconnected → Phone unplugged".
struct PhoneUnpluggedIntent: AppIntent {
    static let title: LocalizedStringResource = "Phone unplugged"
    static let description = IntentDescription("Tells ORION your phone came off the charger. In the morning, that is how ORION knows you're up and says your day out loud on the Mac.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        await WakeSignals.send("unplugged")
        return .result()
    }
}

struct OrionAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PhoneUnpluggedIntent(), phrases: ["Tell \(.applicationName) my phone is unplugged"],
                    shortTitle: "Phone unplugged", systemImageName: "powerplug")
    }
}
