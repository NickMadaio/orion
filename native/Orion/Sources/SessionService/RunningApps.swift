//
//  Everything Orion can honestly say about what is running.
//
//  Assembled from four sources, none of which needs a permission Nick has not
//  already granted:
//
//    NSRunningApplication  name, bundle id, activation policy, hidden, frontmost,
//                          launch date. It has no document state — see
//                          DocumentStateSensor for what had to be done instead.
//    Accessibility         unsaved-document state, via the close button.
//    ActivationHistory     when he last switched to it, since Orion started.
//    The app's Info.plist  whether it declares document types it can edit.
//
//  Behind a protocol, because the reasoning and the safety floor above it must
//  be testable against a machine in a state no real Mac would hold still in.
//

import Foundation
import AppKit
import SessionDomain

public protocol RunningAppsReading: AnyObject {
    func facts(now: Date) -> [AppFacts]
}

public final class RunningApps: RunningAppsReading {

    private let documents: DocumentStateSensing
    private let activations: ActivationHistoryReading
    private let workspace: NSWorkspace

    /// Bundle path → declares editable document types. A bundle's Info.plist
    /// does not change while it is running, and this is read for every app on
    /// every session start.
    private static let editorCacheLock = NSLock()
    private static var editorCache: [String: Bool] = [:]

    public init(documents: DocumentStateSensing = AccessibilityDocumentSensor(),
                activations: ActivationHistoryReading = ActivationHistory(),
                workspace: NSWorkspace = .shared) {
        self.documents = documents
        self.activations = activations
        self.workspace = workspace
    }

    public func facts(now: Date = Date()) -> [AppFacts] {
        let frontmost = workspace.frontmostApplication?.bundleIdentifier
        var seen = Set<String>()

        return workspace.runningApplications.compactMap { app -> AppFacts? in
            guard let bundleID = app.bundleIdentifier, !bundleID.isEmpty,
                  seen.insert(bundleID).inserted else { return nil }

            let background = app.activationPolicy != .regular
            // A background process is refused by the floor anyway, so do not
            // spend an accessibility round trip proving it. Sixty menu-bar
            // helpers times a one-second timeout is a stalled session start.
            let state: (state: DocumentState, readableWindows: Int?) = background
                ? (.unknown, nil)
                : documents.documentState(pid: app.processIdentifier)

            return AppFacts(
                bundleID: bundleID,
                name: app.localizedName ?? bundleID,
                isFrontmost: bundleID == frontmost,
                isHidden: app.isHidden,
                isBackgroundOnly: background,
                isSystemComponent: Self.isSystemComponent(app.bundleURL),
                documents: state.state,
                readableWindows: state.readableWindows,
                secondsSinceLastActive: activations.secondsSinceActive(bundleID, now: now),
                secondsSinceLaunch: app.launchDate.map { max(0, now.timeIntervalSince($0)) },
                editsDocuments: Self.declaresEditableDocuments(app.bundleURL)
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    // MARK: Bundle facts

    /// System MACHINERY, not "shipped by Apple".
    ///
    /// The distinction is load-bearing: Messages, Music, Mail, Safari and News
    /// all live in `/System/Applications` on a modern Mac, and they are exactly
    /// the apps this feature exists to close. What must never be touched is what
    /// lives in `/System/Library` — Finder, Dock, loginwindow, the agents that
    /// hold the desktop together.
    static func isSystemComponent(_ url: URL?) -> Bool {
        guard let path = url?.path else { return false }
        return path.hasPrefix("/System/Library/")
            || path.hasPrefix("/usr/")
            || path.hasPrefix("/Library/CoreServices/")
            || path.hasPrefix("/System/iOSSupport/System/Library/")
    }

    /// Read straight out of the plist rather than through `Bundle`, which would
    /// have macOS map a foreign bundle for a question this simple.
    static func declaresEditableDocuments(_ url: URL?) -> Bool {
        guard let url else { return false }
        let key = url.path

        editorCacheLock.lock()
        if let cached = editorCache[key] { editorCacheLock.unlock(); return cached }
        editorCacheLock.unlock()

        let answer = readEditableDocuments(url)

        editorCacheLock.lock(); editorCache[key] = answer; editorCacheLock.unlock()
        return answer
    }

    private static func readEditableDocuments(_ bundle: URL) -> Bool {
        let plist = bundle.appendingPathComponent("Contents/Info.plist")
        guard let data = try? Data(contentsOf: plist),
              let root = try? PropertyListSerialization.propertyList(
                  from: data, options: [], format: nil) as? [String: Any]
        else { return false }

        guard let types = root["CFBundleDocumentTypes"] as? [[String: Any]] else { return false }
        return types.contains { type in
            if let role = type["CFBundleTypeRole"] as? String,
               role.caseInsensitiveCompare("Editor") == .orderedSame { return true }
            return type["NSDocumentClass"] != nil
        }
    }
}
