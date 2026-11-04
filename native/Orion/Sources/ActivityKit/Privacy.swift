import Foundation

/// What activity.json may hold. No URL (its query string carries tokens and searches), no window title except a game's,
/// and nothing at all about a private or incognito window.
public enum ActivityPrivacy {
    public static func window(category: ActivityCategory, title: String?) -> String? {
        guard category == .game, let title, !title.isEmpty else { return nil }
        return title
    }

    /// The domain of a page, or nil for a private window. `mode` is the browser's own word for the window ("incognito", "normal", ...).
    public static func domain(url: String, mode: String?) -> String? {
        if isPrivate(mode: mode) { return nil }
        return SiteClassifier.domain(fromURL: url)
    }

    public static func isPrivate(mode: String?) -> Bool {
        guard let m = mode?.lowercased() else { return false }
        return m.contains("incognito") || m.contains("private") || m == "true"
    }
}

/// Runs `work` off the main thread and calls `completion` on the main queue exactly once: with the value, or with nil when the
/// deadline passes first. The work is abandoned, not cancelled (an Accessibility or AppleScript call cannot be), so a hung app
/// costs one background thread and the UI never waits.
public enum TimeoutGate {
    public static func run<T>(timeout: TimeInterval, work: @escaping () -> T, completion: @escaping (T?) -> Void) {
        let lock = NSLock()
        var finished = false
        func finish(_ value: T?) {
            lock.lock(); let first = !finished; finished = true; lock.unlock()
            if first { DispatchQueue.main.async { completion(value) } }
        }
        DispatchQueue.global(qos: .utility).async { finish(work()) }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) { finish(nil) }
    }
}
