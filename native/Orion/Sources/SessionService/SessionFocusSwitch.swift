//
//  Turning the session's Focus mode on and off, on a queue of its own.
//
//  Its own serial queue for two reasons. First, never on main: running a
//  Shortcut is process work, and on 2026-11-01 doing it inside SessionService's
//  publish on main fed the deadlock. Second, never behind distraction review,
//  whose model call can take a minute. The queue is serial, so an "off" always
//  runs after any "on" queued before it.
//
//  `changed` is confined to the queue. Any ATTEMPT counts as a change: a
//  Shortcut that timed out may still have switched Focus on, so the session's
//  end always sends "off" unless nothing ran at all.
//

import Foundation

public final class SessionFocusSwitch {

    private let enableAction: () -> ExternalOutcome
    private let disableAction: () -> ExternalOutcome
    private let queue: DispatchQueue
    private var changed = false

    public init(enable: @escaping () -> ExternalOutcome,
                disable: @escaping () -> ExternalOutcome,
                label: String = "com.nickmadaio.orion.focus-mode") {
        self.enableAction = enable
        self.disableAction = disable
        self.queue = DispatchQueue(label: label, qos: .userInitiated)
    }

    /// Whether an outcome may have left Focus on. Only "not configured" means
    /// no Shortcut ran.
    public static func mayHaveChanged(_ outcome: ExternalOutcome) -> Bool {
        if case .notConfigured = outcome { return false }
        return true
    }

    /// Queue an "on". Skipped if the session is no longer live when it runs.
    /// `completion` is called on the switch's queue.
    public func enable(isLive: @escaping () -> Bool,
                       completion: @escaping (ExternalOutcome) -> Void) {
        queue.async { [weak self] in
            guard let self, isLive() else { return }
            let outcome = self.enableAction()
            if Self.mayHaveChanged(outcome) { self.changed = true }
            completion(outcome)
        }
    }

    /// Queue an "off", sent only if an "on" was attempted.
    public func disable() {
        queue.async { [weak self] in
            guard let self, self.changed else { return }
            _ = self.disableAction()
            self.changed = false
        }
    }

    /// Wait for queued work. For tests; never call from main in the app.
    func sync() { queue.sync {} }
}
