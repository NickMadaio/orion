import ActivityKit
import AppKit
import Foundation

/// The domain of the front browser window's page, by AppleScript. Safari, Chrome, Arc, Brave and Edge. The URL itself and the tab
/// title never leave this file: only the domain does, and nothing at all for a private window.
/// Automation permission is asked once per browser, the first time that browser is frontmost. A denial is remembered
/// for ten minutes (no prompt storm, no error spam) and the answer is simply "no domain".
final class BrowserProbe {
    /// `domain` is nil for a private window or an unreadable page; a Page still means "the probe answered".
    struct Page: Equatable { var domain: String? }

    private struct Script { let appName: String; let source: String }
    private static let scripts: [String: Script] = [
        "com.apple.Safari": Script(appName: "Safari", source: "tell application \"Safari\" to return (URL of current tab of front window)"),
        "com.google.Chrome": Script(appName: "Google Chrome", source: "tell application \"Google Chrome\" to return (URL of active tab of front window) & \"\\n\" & (mode of front window as string)"),
        "company.thebrowser.Browser": Script(appName: "Arc", source: "tell application \"Arc\" to return (URL of active tab of front window) & \"\\n\" & (incognito of front window as string)"),
        "com.brave.Browser": Script(appName: "Brave Browser", source: "tell application \"Brave Browser\" to return (URL of active tab of front window) & \"\\n\" & (mode of front window as string)"),
        "com.microsoft.edgemac": Script(appName: "Microsoft Edge", source: "tell application \"Microsoft Edge\" to return (URL of active tab of front window) & \"\\n\" & (mode of front window as string)"),
    ]
    static let denialBackoff: TimeInterval = 600
    static let deadline: TimeInterval = 4
    /// errAEEventNotPermitted: the user said no in Privacy & Security > Automation.
    private static let notPermitted = -1743

    private var deniedAt: [String: Date] = [:]

    static func supports(_ bundleId: String?) -> Bool { bundleId.map { scripts[$0] != nil } ?? false }

    /// Off the main thread and bounded by a deadline (a hung browser must not wedge the probe or the UI); `completion` runs on the main
    /// queue. Nil = no answer (denied, not running, timed out).
    func probe(bundleId: String, completion: @escaping (Page?) -> Void) {
        guard let script = Self.scripts[bundleId] else { return completion(nil) }
        if let when = deniedAt[bundleId], Date().timeIntervalSince(when) < Self.denialBackoff { return completion(nil) }
        TimeoutGate.run(timeout: Self.deadline, work: { () -> (Page?, Bool) in
            var error: NSDictionary?
            let result = NSAppleScript(source: script.source)?.executeAndReturnError(&error)
            if let error { return (nil, (error[NSAppleScript.errorNumber] as? Int) == Self.notPermitted) }
            let parts = (result?.stringValue ?? "").components(separatedBy: "\n")
            guard let url = parts.first, !url.isEmpty else { return (nil, false) }
            return (Page(domain: ActivityPrivacy.domain(url: url, mode: parts.dropFirst().first)), false)
        }, completion: { [weak self] outcome in
            if outcome?.1 == true {
                self?.deniedAt[bundleId] = Date()
                OrionLog.write("[activity] Automation for \(script.appName) is denied; browser sites are off for it for 10 min", key: "activity-denied-\(bundleId)")
            }
            completion(outcome?.0)
        })
    }
}

