//
//  Getting to the main thread from the socket thread without deadlocking.
//
//  `post` is always async, even when already on main, so lines said from
//  different threads reach the screen in the order they were said.
//
//  `snapshot` reads main-thread state (an ObservableObject's @Published
//  values) for a thread that needs an answer. It never uses
//  DispatchQueue.main.sync: it posts async and waits on a semaphore with a
//  timeout, so a busy or wedged main costs the caller a bounded wait and a
//  nil, never a hang. Safe only because main never waits on the caller.
//

import Foundation

public enum MainThreadHop {

    public static func post(_ block: @escaping () -> Void) {
        DispatchQueue.main.async(execute: block)
    }

    public static func snapshot<T>(timeout: TimeInterval,
                                   _ read: @escaping () -> T) -> T? {
        if Thread.isMainThread { return read() }
        let box = SnapshotBox<T>()
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            box.set(read())
            done.signal()
        }
        guard done.wait(timeout: .now() + timeout) == .success else { return nil }
        return box.value
    }
}

private final class SnapshotBox<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T?

    func set(_ value: T) {
        lock.lock(); defer { lock.unlock() }
        stored = value
    }

    var value: T? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }
}
