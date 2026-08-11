//
//  Quitting an app, which is the most destructive thing in this whole build.
//
//  The decision, and it is not negotiable: THE LIST IS USER-MAINTAINED, NOT
//  MODEL JUDGEMENT. Orion may quit an app only if Nick has previously written
//  that app down as quittable. There is no inference, no "it looks like a
//  distraction", no proposal that becomes an authorization if he does not
//  object. The enforcement allowlist works the other way round — the model
//  proposes and he confirms — and that asymmetry is deliberate: confirming a
//  list of things NOT to interrupt is low stakes, and confirming a list of
//  things that may be closed under you while you are typing in them is not.
//
//  Everything here is built so the damaging mistake is impossible rather than
//  unlikely:
//
//    • An empty list is the default and quits nothing.
//    • `terminate()` and never `forceTerminate()`. The polite quit lets an app
//      put up "save changes?" and lets the user say no. Force-quitting throws
//      away work, and no focus session is worth somebody's unsaved document.
//    • A refusal — the app declining to quit, or macOS declining to ask — is a
//      reported outcome, not a retry. If Orion cannot close something it says so
//      once and stops.
//    • Orion, Finder, loginwindow and the password manager can never be added.
//

import Foundation
import AppKit
import SessionDomain

public struct QuittableApp: Codable, Equatable, Sendable, Identifiable {
    public let bundleID: String
    public let name: String

    public var id: String { bundleID }

    public init(bundleID: String, name: String) {
        self.bundleID = bundleID
        self.name = name
    }
}

public enum QuitOutcome: Equatable, Sendable {
    case quit(String)
    /// It was not on the list. The only correct response is to do nothing.
    case notPermitted(String)
    /// Asked, and it did not go — usually an unsaved-changes sheet, which is
    /// exactly the outcome the polite quit exists to allow.
    case declined(String)
    case notRunning(String)

    public var message: String {
        switch self {
        case .quit(let name): return "Closed \(name)."
        case .notPermitted(let name):
            return "\(name) is not on your quittable list, so Orion left it alone."
        case .declined(let name):
            return "\(name) did not close — it may be asking you to save something."
        case .notRunning(let name): return "\(name) was not running."
        }
    }
}

public final class QuittableApps {

    /// Never quittable, whatever the list says.
    ///
    /// Same spine as `Allowlist.alwaysAllowed`, for the same reason: closing
    /// somebody's password manager or Finder mid-session is not enforcement.
    /// Orion is here too — an assistant that can quit itself cannot be asked to
    /// stop.
    public static let neverQuittable: Set<String> = [
        "com.nickmadaio.orion.app",
        "com.apple.finder",
        "com.apple.loginwindow",
        "com.1password.1password",
        "com.apple.systempreferences",
        "com.apple.SecurityAgent",
        "com.apple.Terminal"
    ]

    private let url: URL
    private let lock = NSLock()

    public var onLog: ((String) -> Void)?

    public init(url: URL? = nil) {
        if let url {
            self.url = url
        } else if let override = ProcessInfo.processInfo.environment["ORION_QUITTABLE_APPS"],
                  !override.isEmpty {
            self.url = URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        } else {
            self.url = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".openclaw")
                .appendingPathComponent("orion-controlled")
                .appendingPathComponent("quittable-apps.json")
        }
    }

    // MARK: The list

    /// Empty unless Nick has written something in it. Empty means nothing is
    /// ever quit, which is the correct default for a destructive capability.
    public func list() -> [QuittableApp] {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? Data(contentsOf: url),
              let apps = try? JSONDecoder().decode([QuittableApp].self, from: data) else {
            return []
        }
        return apps.filter { !Self.neverQuittable.contains($0.bundleID) }
    }

    /// Add one. Called only from a control Nick operates — never from the model,
    /// never from a proposal, never as a side effect of anything else.
    @discardableResult
    public func add(_ app: QuittableApp) -> Bool {
        guard !Self.neverQuittable.contains(app.bundleID) else {
            onLog?("[quit] refused to make \(app.name) quittable — it is on the never list")
            return false
        }
        var apps = list()
        guard !apps.contains(where: { $0.bundleID == app.bundleID }) else { return true }
        apps.append(app)
        write(apps)
        onLog?("[quit] \(app.name) added to the quittable list")
        return true
    }

    public func remove(_ bundleID: String) {
        write(list().filter { $0.bundleID != bundleID })
        onLog?("[quit] \(bundleID) removed from the quittable list")
    }

    public func permits(_ bundleID: String) -> Bool {
        guard !Self.neverQuittable.contains(bundleID) else { return false }
        return list().contains { $0.bundleID == bundleID }
    }

    private func write(_ apps: [QuittableApp]) {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(apps) else { return }
        try? data.write(to: url, options: [.atomic])
    }

    // MARK: Quitting

    /// Ask an app to quit, if and only if it is on the list.
    ///
    /// `terminate()` rather than `forceTerminate()`, always. The polite quit
    /// goes through the app's own shutdown path, so an unsaved document puts up
    /// a sheet and the user gets to say no — and Orion reports that it did not
    /// close rather than insisting. No focus session is worth somebody's work.
    @discardableResult
    public func quit(bundleID: String, name: String? = nil) -> QuitOutcome {
        let label = name ?? bundleID

        guard permits(bundleID) else {
            onLog?("[quit] refused: \(label) is not on the quittable list")
            return .notPermitted(label)
        }

        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
        guard !running.isEmpty else { return .notRunning(label) }

        var allWent = true
        for app in running where !app.terminate() { allWent = false }

        if allWent {
            onLog?("[quit] asked \(label) to close")
            return .quit(label)
        }
        // Not retried, and never escalated to force. Said once.
        onLog?("[quit] \(label) declined to close — probably an unsaved-changes sheet")
        return .declined(label)
    }

    /// Candidates to OFFER Nick, which is a different thing from a list to act
    /// on. Nothing here is quittable until he adds it by hand.
    public static func candidates() -> [QuittableApp] {
        NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .compactMap { app in
                guard let bundleID = app.bundleIdentifier,
                      !neverQuittable.contains(bundleID) else { return nil }
                return QuittableApp(bundleID: bundleID, name: app.localizedName ?? bundleID)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}
