import CoreGraphics
import Foundation

/// The idle reading the focus watcher reports, and the rules for trusting it.
///
/// 2026-10-16 proactive-messaging audit (#3): the watcher asked CoreGraphics for
/// the time since an event of type `.null`, which is not an input event, so the
/// answer was "never": roughly the time since boot (1,022,283 s, 11.8 days, while
/// real idle was 40 s). Every planned block then looked idle and the enforcement
/// ladder quit and locked Claude, Safari, Zoom and loginwindow.
enum IdleReading {
    /// No real person is idle for a day with the session open; treat it as a bad reading.
    static let maxPlausibleSeconds: TimeInterval = 24 * 3600

    /// Seconds since the last input of ANY kind (keyboard, mouse, trackpad, scroll).
    static func systemIdleSeconds() -> TimeInterval {
        // kCGAnyInputEventType is ~0; Swift has no named constant for it.
        guard let anyInput = CGEventType(rawValue: ~0) else { return .nan }
        return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
    }

    /// The reading when it can be believed, else nil ("unknown", never "off task").
    /// Invalid: not finite, negative, over a day, or longer than the machine has
    /// been up or the app has been running.
    static func validated(raw: TimeInterval, sinceBoot: TimeInterval, sinceLaunch: TimeInterval) -> TimeInterval? {
        guard raw.isFinite, raw >= 0, raw <= maxPlausibleSeconds else { return nil }
        guard raw <= sinceBoot, raw <= sinceLaunch else { return nil }
        return raw
    }

    // Wall-clock bounds. systemUptime stops during sleep, so use the boot time.
    static let launchedAt = Date()
    static func secondsSinceBoot(now: Date = Date()) -> TimeInterval {
        var tv = timeval(); var size = MemoryLayout<timeval>.stride
        var mib: [Int32] = [CTL_KERN, KERN_BOOTTIME]
        guard sysctl(&mib, 2, &tv, &size, nil, 0) == 0 else { return ProcessInfo.processInfo.systemUptime }
        return now.timeIntervalSince(Date(timeIntervalSince1970: TimeInterval(tv.tv_sec)))
    }

    /// The validated idle for this moment, nil when the system gave nonsense.
    static func current(now: Date = Date()) -> TimeInterval? {
        validated(raw: systemIdleSeconds(), sinceBoot: secondsSinceBoot(now: now),
                  sinceLaunch: now.timeIntervalSince(launchedAt))
    }
}

/// Who the enforcement ladder may act on, and when.
enum EnforcementGuard {
    private static let names: Set<String> = ["loginwindow", "ScreenSaverEngine", "SecurityAgent", "UserNotificationCenter"]
    private static let bundles: Set<String> = ["com.apple.loginwindow", "com.apple.ScreenSaver.Engine", "com.apple.SecurityAgent"]

    /// The lock screen and system prompts are never off-task (audit 2026-10-16: "quit/lock on loginwindow").
    static func isNeverATarget(name: String, bundleID: String?) -> Bool {
        names.contains(name) || (bundleID.map(bundles.contains) ?? false)
    }

    static func allowed(consent: Bool, idleValid: Bool, name: String, bundleID: String?) -> Bool {
        consent && idleValid && !isNeverATarget(name: name, bundleID: bundleID)
    }
}
