import Foundation

/*
 A lock that works ACROSS PROCESSES, for the files two Orions both own.

 Several files here are written by the app and by the `orion-control` plugin at
 the same time — health-log.json is the sharp one, because Nick can tick a
 supplement in the UI in the same second he tells Orion he took it. Both sides
 do read-modify-write.

 The atomic rename those writers already use is NOT a fix for that. It only
 guarantees a reader never sees half a file. The actual hazard is a LOST UPDATE:

     app                          plugin
     read  {A}                    read  {A}
     add B -> {A,B}               add C -> {A,C}
     rename {A,B}
                                  rename {A,C}      <- B is gone, silently

 Nothing errors. Nobody notices until a supplement Nick ticked is unticked an
 hour later, and by then there is nothing to debug.

 `Tests/run-race-test.sh` reproduces it on demand: it drives the real store and
 the real plugin at one scratch file and counts survivors, with the lock and
 without. Four seconds of both writers flat out, unlocked, lost 1965 of 5725
 updates — 34%, and 27–38% across three runs. Locked: 0 of 2187 and 0 of 4062,
 nothing refused. The app is the side that loses; only 284 of its 908 unlocked
 writes survived, because the node side completes about five cycles per one of
 ours and therefore overwrites more often than it is overwritten.

 So the whole read-modify-write goes under one lock and the state is re-read
 INSIDE it. Re-reading is the half people skip: a copy fetched before the lock
 was held is precisely the stale copy that causes the bug, so `withLock` is
 useless unless the read is in the body.

 THE PROTOCOL IS COPIED, DELIBERATELY AND EXACTLY, from `scripts/orion-notify`
 and `scripts/orion-remote`, which already lock `remote.json` this way:

   • the lockfile is `<path>.lock`, created with O_CREAT|O_EXCL — the atomic
     "create only if absent" that makes this a lock at all;
   • a lock older than 15s is assumed to belong to a process that was killed
     mid-write, and is broken. A crashed helper must never be able to lock Nick
     out of his own supplements permanently;
   • waiting gives up after ~6s.

 Those three numbers, and the lockfile NAME, are load-bearing across the two
 languages. A Swift lock at `<path>.lock` and a node lock at `<path>.lockfile`
 would both "work" and would exclude nothing. Change them here and you must
 change `openclaw-plugins/orion-control/src/health.ts` in the same commit.

 Advisory, not enforced by the kernel: it only excludes writers who ask. That
 is the same guarantee the node side has, and both writers ask. Readers do NOT
 take it — the atomic rename means a reader always sees some complete version
 of the file, so making readers queue would buy nothing and cost latency.
*/

enum FileLock {

    /// Longer than any honest hold (a write here is single-digit milliseconds),
    /// short enough that a crash is not felt as a permanent outage.
    static let staleAfter: TimeInterval = 15

    /// Matches the node side's 60 attempts × 100ms.
    static let giveUpAfter: TimeInterval = 6

    /// Polled faster than the node side's 100ms purely to keep the UI snappy:
    /// `mutate` runs on the main thread, so every millisecond spent waiting is
    /// a millisecond the window is not drawing. The poll interval is local
    /// tuning and is NOT part of the cross-language contract — only the
    /// lockfile name, O_EXCL, and the 15s stale rule have to agree.
    private static let pollInterval: useconds_t = 20_000

    struct Busy: LocalizedError {
        let path: String
        var errorDescription: String? {
            "\(path) stayed locked for \(Int(FileLock.giveUpAfter))s"
        }
    }

    /// Run `body` with `<target>.lock` held. Rethrows whatever `body` throws,
    /// releasing the lock either way.
    @discardableResult
    static func withLock<T>(_ target: URL, _ body: () throws -> T) throws -> T {
        let lockPath = target.path + ".lock"
        let deadline = Date().addingTimeInterval(giveUpAfter)

        while true {
            let descriptor = open(lockPath, O_CREAT | O_EXCL | O_WRONLY, 0o600)
            if descriptor >= 0 {
                close(descriptor)
                defer { unlink(lockPath) }
                return try body()
            }

            // Anything other than "already held" is a real filesystem problem
            // (no such directory, no permission) and must not be retried for
            // six seconds before surfacing.
            let failure = errno
            guard failure == EEXIST else {
                throw NSError(
                    domain: NSPOSIXErrorDomain,
                    code: Int(failure),
                    userInfo: [
                        NSLocalizedDescriptionKey:
                            "could not take \(lockPath): \(String(cString: strerror(failure)))"
                    ]
                )
            }

            breakIfStale(lockPath)
            if Date() >= deadline { throw Busy(path: target.lastPathComponent) }
            usleep(pollInterval)
        }
    }

    /// The lockfile is created and never written to, so its mtime is when it
    /// was taken.
    ///
    /// Breaking is racy on purpose — two processes can decide the same lock is
    /// stale and both proceed. That is accepted for the same reason the node
    /// side accepts it: reaching 15s means the holder is gone, and the
    /// alternative to a rare double-entry is Nick's UI being wedged until he
    /// reboots. It is the lesser of the two failures, not a free one.
    private static func breakIfStale(_ lockPath: String) {
        guard
            let attributes = try? FileManager.default.attributesOfItem(atPath: lockPath),
            let taken = attributes[.modificationDate] as? Date,
            Date().timeIntervalSince(taken) > staleAfter
        else { return }
        unlink(lockPath)
    }
}
