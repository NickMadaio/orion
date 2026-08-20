//
//  Quitting an app, which is the most destructive thing in this whole build.
//
//  There are exactly TWO ways to authorise a quit, and no third:
//
//    .userList  — Nick wrote this app down himself. Unchanged from the original
//                 design, still here, still empty by default.
//    .reviewed  — DistractionReview decided it, having first put the app through
//                 a mechanical floor the reasoning cannot reach past. He asked
//                 for this twice: "it should be an open ended question he
//                 reasons, not a multiple choice."
//
//  Both funnel into the same `quit`, so the guards are written once:
//
//    • The never-quit set holds whatever the authorisation says.
//    • The app's unsaved state is re-read HERE, at the moment of quitting, from
//      macOS rather than from whatever a caller decided earlier. Anything not
//      provably clean is refused — including "could not tell".
//    • `terminate()` and never `forceTerminate()`. The polite quit lets an app
//      put up "save changes?" and lets the user say no. Force-quitting throws
//      away work, and no focus session is worth somebody's unsaved document.
//    • A refusal is a reported outcome, not a retry. If Orion cannot close
//      something it says so once and stops.
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

/// Who said this app could be closed. There is no `.none`: a quit with no
/// authorisation is not representable.
public enum QuitAuthorization: Equatable, Sendable {
    /// Nick's own list.
    case userList
    /// Reasoned about at session start, having already passed the floor.
    case reviewed(reason: String)
}

public enum QuitOutcome: Equatable, Sendable {
    case quit(String)
    /// It was not authorised. The only correct response is to do nothing.
    case notPermitted(String)
    /// Asked, and it did not go — usually an unsaved-changes sheet, which is
    /// exactly the outcome the polite quit exists to allow.
    case declined(String)
    case notRunning(String)
    /// macOS says it has unsaved work. Refused before it is even asked, so no
    /// save sheet ever appears and nothing is at risk of a stray Return key.
    case holdsUnsavedWork(String)
    /// Its state could not be read, which is not the same as it being clean.
    case unreadable(String)

    public var message: String {
        switch self {
        case .quit(let name): return "Closed \(name)."
        case .notPermitted(let name):
            return "\(name) was not authorised for closing, so Orion left it alone."
        case .declined(let name):
            return "\(name) did not close — it may be asking you to save something."
        case .notRunning(let name): return "\(name) was not running."
        case .holdsUnsavedWork(let name):
            return "\(name) has unsaved work, so Orion left it open."
        case .unreadable(let name):
            return "Orion could not tell whether \(name) has unsaved work, so it left it open."
        }
    }
}

public final class QuittableApps {

    /// Never quittable, whatever the list or the reasoning says.
    ///
    /// One definition, in the domain, so the pure floor and the thing that
    /// actually calls `terminate()` cannot drift into two different ideas of
    /// what is sacred. Same spine as `Allowlist.alwaysAllowed`, for the same
    /// reason: closing somebody's password manager or Finder mid-session is not
    /// enforcement. Orion is on it too — an assistant that can quit itself
    /// cannot be asked to stop.
    public static var neverQuittable: Set<String> { DistractionFloor.neverQuit }

    private let url: URL
    private let lock = NSLock()
    /// Asked again at the moment of quitting. Injected so the refusal can be
    /// tested without an app that really does hold an unsaved document.
    private let documents: DocumentStateSensing

    public var onLog: ((String) -> Void)?

    public init(url: URL? = nil,
                documents: DocumentStateSensing = AccessibilityDocumentSensor()) {
        self.documents = documents
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

    /// Ask an app to quit, if and only if something authorised it AND macOS says
    /// it has nothing unsaved.
    ///
    /// The order matters and is the whole safety argument:
    ///
    ///   never-quit set → authorisation → is it running → UNSAVED CHECK → quit
    ///
    /// The unsaved check is last and is done here rather than trusted from a
    /// caller, because a caller's information is as old as whenever it looked.
    /// A document dirtied in the seconds between deciding and acting still
    /// stops the quit.
    ///
    /// `terminate()` rather than `forceTerminate()`, always. The polite quit
    /// goes through the app's own shutdown path, so anything this missed still
    /// puts up a sheet and the user gets to say no — and Orion reports that it
    /// did not close rather than insisting. No focus session is worth somebody's
    /// work.
    @discardableResult
    public func quit(bundleID: String, name: String? = nil,
                     authorizedBy authorization: QuitAuthorization = .userList) -> QuitOutcome {
        let label = name ?? bundleID

        guard !Self.neverQuittable.contains(bundleID) else {
            onLog?("[quit] refused: \(label) is on the never-quit list")
            return .notPermitted(label)
        }

        switch authorization {
        case .userList:
            guard permits(bundleID) else {
                onLog?("[quit] refused: \(label) is not on the quittable list")
                return .notPermitted(label)
            }
        case .reviewed(let reason):
            onLog?("[quit] \(label) was reviewed for this session: \(reason)")
        }

        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
        guard !running.isEmpty else { return .notRunning(label) }

        if let refusal = unsavedRefusal(pids: running.map(\.processIdentifier), label: label) {
            return refusal
        }

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

    /// The unsaved-work gate, kept separate from the app lookup on purpose.
    ///
    /// It is the last thing standing between a decision and `terminate()`, so it
    /// is provable on its own rather than only reachable through whatever
    /// happens to be running on the machine the tests are on. Nil means nothing
    /// objected; anything else is a refusal and the caller returns it unchanged.
    func unsavedRefusal(pids: [pid_t], label: String) -> QuitOutcome? {
        for pid in pids {
            switch documents.documentState(pid: pid).state {
            case .edited:
                onLog?("[quit] refused: \(label) has unsaved changes")
                return .holdsUnsavedWork(label)
            case .unknown:
                onLog?("[quit] refused: \(label) would not say whether it has unsaved work")
                return .unreadable(label)
            case .clean:
                continue
            }
        }
        return nil
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
