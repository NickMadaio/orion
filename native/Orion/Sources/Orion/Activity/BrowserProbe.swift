import AppKit
import Foundation

/// The URL and tab title of the front browser window, by AppleScript. Safari, Chrome, Arc, Brave and Edge.
/// Automation permission is asked once per browser, the first time that browser is frontmost. A denial is remembered
/// for ten minutes (no prompt storm, no error spam) and the answer is simply "no URL".
final class BrowserProbe {
    struct Page: Equatable { var url: String; var title: String? }

    private struct Script { let appName: String; let source: String }
    private static let scripts: [String: Script] = [
        "com.apple.Safari": Script(appName: "Safari", source: "tell application \"Safari\" to return (URL of current tab of front window) & \"\\n\" & (name of current tab of front window)"),
        "com.google.Chrome": Script(appName: "Google Chrome", source: "tell application \"Google Chrome\" to return (URL of active tab of front window) & \"\\n\" & (title of active tab of front window)"),
        "company.thebrowser.Browser": Script(appName: "Arc", source: "tell application \"Arc\" to return (URL of active tab of front window) & \"\\n\" & (title of active tab of front window)"),
        "com.brave.Browser": Script(appName: "Brave Browser", source: "tell application \"Brave Browser\" to return (URL of active tab of front window) & \"\\n\" & (title of active tab of front window)"),
        "com.microsoft.edgemac": Script(appName: "Microsoft Edge", source: "tell application \"Microsoft Edge\" to return (URL of active tab of front window) & \"\\n\" & (title of active tab of front window)"),
    ]
    static let denialBackoff: TimeInterval = 600
    /// errAEEventNotPermitted: the user said no in Privacy & Security > Automation.
    private static let notPermitted = -1743

    private let queue = DispatchQueue(label: "orion.activity.browser-probe", qos: .utility)
    private var deniedAt: [String: Date] = [:]

    static func supports(_ bundleId: String?) -> Bool { bundleId.map { scripts[$0] != nil } ?? false }

    /// Runs off the main thread so a permission prompt never freezes the UI; `completion` is called on the main queue. Nil = no URL.
    func probe(bundleId: String, completion: @escaping (Page?) -> Void) {
        guard let script = Self.scripts[bundleId] else { return completion(nil) }
        if let when = deniedAt[bundleId], Date().timeIntervalSince(when) < Self.denialBackoff { return completion(nil) }
        queue.async { [weak self] in
            var error: NSDictionary?
            let result = NSAppleScript(source: script.source)?.executeAndReturnError(&error)
            var page: Page?
            if let error {
                if (error[NSAppleScript.errorNumber] as? Int) == Self.notPermitted {
                    DispatchQueue.main.async { self?.deniedAt[bundleId] = Date() }
                    OrionLog.write("[activity] Automation for \(script.appName) is denied; browser URLs are off for it for 10 min", key: "activity-denied-\(bundleId)")
                }
            } else if let text = result?.stringValue {
                let parts = text.components(separatedBy: "\n")
                if let url = parts.first, !url.isEmpty { page = Page(url: url, title: parts.dropFirst().joined(separator: "\n").nilIfEmpty) }
            }
            DispatchQueue.main.async { completion(page) }
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
