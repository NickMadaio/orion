//
//  Reading what is actually happening, behind protocols so the policy can be
//  tested without a Mac in a particular state.
//
//  Nothing here needs a permission Nick has not already given.
//  `NSWorkspace.frontmostApplication` raises no TCC prompt; neither does
//  `CGEventSource.secondsSinceLastEventType`. That was a deliberate constraint —
//  the moment enforcement needs Accessibility or Screen Recording it becomes a
//  thing to be afraid of rather than argued with, and Gate 10 is where that
//  trade gets made explicitly if it ever does.
//
//  Every sensor reports UNAVAILABLE as a distinct state rather than guessing.
//  A frontmost app that cannot be read is not "he is on task" and it is not
//  "he is drifting" — it is "we do not know", and the policy is written to
//  treat not-knowing as not-a-violation so a glitch never nags him.
//

import Foundation
import AppKit
import SessionDomain

// MARK: - Protocols

public protocol FrontmostAppSensing: AnyObject {
    /// Nil when it cannot be read.
    func frontmost() -> (bundleID: String, name: String)?
}

public protocol IdleSensing: AnyObject {
    /// Seconds since the last human input, or nil when it cannot be read.
    func idleSeconds() -> TimeInterval?
}

public protocol ScreenStateSensing: AnyObject {
    func isLockedOrAsleep() -> Bool
}

// MARK: - Real implementations

public final class WorkspaceFrontmostSensor: FrontmostAppSensing {
    public init() {}

    public func frontmost() -> (bundleID: String, name: String)? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let bundleID = app.bundleIdentifier else { return nil }
        return (bundleID, app.localizedName ?? bundleID)
    }
}

public final class EventSourceIdleSensor: IdleSensing {
    public init() {}

    /// Seconds since any HID event — key, mouse move, click, scroll.
    ///
    /// `.combinedSessionState` rather than a single event type, because
    /// watching only keystrokes would call somebody idle while they read, and
    /// watching only the mouse would call them idle while they type.
    public func idleSeconds() -> TimeInterval? {
        let seconds = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState, eventType: .init(rawValue: ~0)!
        )
        // A negative or absurd reading means the API had nothing to say.
        guard seconds >= 0, seconds < 60 * 60 * 24 * 7 else { return nil }
        return seconds
    }
}

/// Screen lock and display sleep, from the session dictionary.
///
/// `CGSessionCopyCurrentDictionary` needs no permission. The key has been stable
/// for many macOS releases, but it is still a dictionary lookup that can come
/// back empty — and an empty answer means "not locked" here, because assuming
/// locked would silently switch enforcement off.
public final class SessionDictionaryScreenSensor: ScreenStateSensing {
    public init() {}

    public func isLockedOrAsleep() -> Bool {
        guard let info = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        if let locked = info["CGSSessionScreenIsLocked"] as? Int, locked == 1 { return true }
        if let onConsole = info["kCGSSessionOnConsoleKey"] as? Bool, !onConsole { return true }
        return false
    }
}

/// One candidate for the allowlist, with its name and identifier kept together
/// so they cannot drift apart.
public struct ProposedApp: Equatable, Sendable {
    public let name: String
    public let bundleID: String

    public init(name: String, bundleID: String) {
        self.name = name
        self.bundleID = bundleID
    }
}

// MARK: - The hub

/// One observation, assembled from whatever could be read.
public final class SensorHub {

    private let frontmostSensor: FrontmostAppSensing
    private let idleSensor: IdleSensing
    private let screenSensor: ScreenStateSensing

    /// What could not be read this time, for the UI to disclose.
    public private(set) var unavailable: Set<String> = []

    public init(frontmost: FrontmostAppSensing = WorkspaceFrontmostSensor(),
                idle: IdleSensing = EventSourceIdleSensor(),
                screen: ScreenStateSensing = SessionDictionaryScreenSensor()) {
        self.frontmostSensor = frontmost
        self.idleSensor = idle
        self.screenSensor = screen
    }

    public func observe() -> Observation {
        var missing: Set<String> = []

        let front = frontmostSensor.frontmost()
        if front == nil { missing.insert("frontmost app") }

        let idle = idleSensor.idleSeconds()
        if idle == nil { missing.insert("idle time") }

        unavailable = missing

        return Observation(
            frontmostBundleID: front?.bundleID,
            frontmostName: front?.name,
            // Nil idle becomes zero, i.e. "actively working". Guessing the other
            // way would nag him because a reading failed.
            idleFor: idle ?? 0,
            screenLocked: screenSensor.isLockedOrAsleep()
        )
    }

    /// What to disclose when something cannot be read. Nil when everything works.
    public var disclosure: String? {
        guard !unavailable.isEmpty else { return nil }
        return "Orion cannot read \(unavailable.sorted().joined(separator: " or ")) right now, "
             + "so it is not watching for drift."
    }

    // MARK: Proposing an allowlist

    /// The apps currently running, as candidates.
    ///
    /// A PROPOSAL. It is shown to Nick and enforces nothing until he confirms
    /// it — `Allowlist.confirmed` is false here on purpose, and the policy
    /// refuses to act on an unconfirmed list. The model may suggest; it never
    /// authorizes.
    public static func proposeAllowlist(forTask task: String) -> (Allowlist, [ProposedApp]) {
        var seen = Set<String>()
        let running = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .compactMap { app -> ProposedApp? in
                guard let bundleID = app.bundleIdentifier, seen.insert(bundleID).inserted else {
                    return nil
                }
                return ProposedApp(name: app.localizedName ?? bundleID, bundleID: bundleID)
            }
            // Sorted as PAIRS, once.
            //
            // This used to return a Set of ids and a separate array of names,
            // each sorted on its own, which the caller then zipped by index. The
            // result was a confirmation dialog reading "Claude
            // (com.apple.MobileSMS)" and "Code (com.apple.Music)" — Nick would
            // have authorized a list of apps that had nothing to do with the
            // names he was shown. Keeping them together makes that unrepresentable.
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        return (Allowlist(bundleIDs: Set(running.map(\.bundleID)), confirmed: false), running)
    }
}
