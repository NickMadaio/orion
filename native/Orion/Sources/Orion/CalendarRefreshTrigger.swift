//
//  When the calendar view must refetch.
//
//  `CalendarModel` caches the interval it fetched and, by design, serves paging
//  from it. Nothing told it when EventKit changed underneath, so a write made by
//  ORION (through the bridge, in another process) left the open day showing the
//  old blocks until a navigation happened to leave the cached interval.
//
//  This is the pure half of the fix: it hears the signals, debounces them, and
//  fires once. No EventKit, no model — a test posts notifications and counts.
//

import Foundation
import EventKit

extension Notification.Name {
    /// An ORION turn finished. The turn may have written to the calendar through
    /// the bridge; there is no cheap way to know, and a refetch is cheap.
    static let orionTurnFinished = Notification.Name("orion.turn.finished")
}

final class CalendarRefreshTrigger {
    enum Reason: Equatable {
        case storeChanged
        case turnFinished
        case requested
    }

    private let delay: TimeInterval
    private let maxWait: TimeInterval
    private let queue: DispatchQueue
    private let fire: (Reason) -> Void
    private let center: NotificationCenter
    private var observers: [NSObjectProtocol] = []
    private var pending: DispatchWorkItem?
    private var pendingSince: Date?
    private var pendingReason: Reason = .requested

    /// `delay` is the quiet period: a batch of writes is one refetch, after the
    /// last of them. `maxWait` bounds how long a steady stream can postpone it.
    init(delay: TimeInterval = 1.0, maxWait: TimeInterval = 1.5,
         queue: DispatchQueue = .main, center: NotificationCenter = .default,
         storeChanged: Notification.Name = .EKEventStoreChanged,
         turnFinished: Notification.Name = .orionTurnFinished,
         fire: @escaping (Reason) -> Void) {
        self.delay = delay
        self.maxWait = maxWait
        self.queue = queue
        self.center = center
        self.fire = fire
        observers = [
            center.addObserver(forName: storeChanged, object: nil, queue: nil) { [weak self] _ in
                self?.request(.storeChanged)
            },
            center.addObserver(forName: turnFinished, object: nil, queue: nil) { [weak self] _ in
                self?.request(.turnFinished)
            }
        ]
    }

    deinit {
        pending?.cancel()
        observers.forEach(center.removeObserver)
    }

    func request(_ reason: Reason = .requested) {
        queue.async { [weak self] in self?.schedule(reason) }
    }

    private func schedule(_ reason: Reason) {
        let now = Date()
        let since = pendingSince ?? now
        pending?.cancel()
        pendingSince = since
        pendingReason = reason
        let wait = max(0, min(delay, maxWait - now.timeIntervalSince(since)))
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let reason = self.pendingReason
            self.pending = nil
            self.pendingSince = nil
            self.fire(reason)
        }
        pending = work
        queue.asyncAfter(deadline: .now() + wait, execute: work)
    }
}
