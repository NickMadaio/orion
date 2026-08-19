//
//  Which apps have actually been used lately.
//
//  macOS keeps no public "recently used apps" list — `runningApplications` is in
//  roughly launch order, and `NSRunningApplication` has no last-activated date.
//  The Dock's ordering is private. So the only honest way to know is to WATCH,
//  which means this only knows about activations since Orion started.
//
//  That limitation is carried in the type rather than hidden: "not seen" is nil,
//  not "a long time ago". A nil means Orion has not watched this app being used,
//  which is a weaker claim than "he has not used it" and the caller treats it as
//  the weaker claim.
//

import Foundation
import AppKit

public protocol ActivationHistoryReading: AnyObject {
    /// Seconds since this app was last frontmost, or nil when Orion has not
    /// seen it activated at all.
    func secondsSinceActive(_ bundleID: String, now: Date) -> TimeInterval?
}

public final class ActivationHistory: ActivationHistoryReading {

    private let lock = NSLock()
    private var lastActive: [String: Date] = [:]
    private var observer: NSObjectProtocol?
    private let clock: () -> Date

    public init(clock: @escaping () -> Date = { Date() }) {
        self.clock = clock
    }

    deinit {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
    }

    /// Starts watching, and seeds itself with whatever is frontmost now so a
    /// session started thirty seconds after launch still protects the app he was
    /// working in.
    public func start() {
        if let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier {
            record(bundleID)
        }
        guard observer == nil else { return }
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bundleID = app.bundleIdentifier else { return }
            self?.record(bundleID)
        }
    }

    public func record(_ bundleID: String) {
        lock.lock(); lastActive[bundleID] = clock(); lock.unlock()
    }

    public func secondsSinceActive(_ bundleID: String, now: Date = Date()) -> TimeInterval? {
        lock.lock(); defer { lock.unlock() }
        guard let when = lastActive[bundleID] else { return nil }
        return max(0, now.timeIntervalSince(when))
    }
}
