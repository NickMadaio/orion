//
//  focus-state.json — the one file that says what session is running.
//
//  Written by exactly one process, and locked anyway. The single-writer rule is
//  a design decision, and design decisions do not survive contact with
//  `open -na Orion`, which is what the dashboard LaunchAgent runs and which
//  starts a SECOND instance rather than raising the existing one. The lock costs
//  a couple of milliseconds and removes a whole class of question.
//
//  Every write is: take the lock, re-read inside it, apply, write a uniquely
//  named scratch file, rename it over the target. That is the same idiom
//  `HealthLog.publish` uses and for the same reasons — the rename is what makes
//  a reader either see the old file or the new one and never half of either,
//  and the unique scratch name is what stops two writers from fighting over one
//  temporary path if a stale lock is ever broken.
//
//  A file that cannot be read is an ERROR, never an empty session. A session
//  that silently disappears with nothing in a log is this project's worst
//  failure mode and it has happened before.
//

import Foundation
import SessionDomain

public final class SessionStore {

    public let url: URL

    /// Where the state lives by convention: alongside everything else Orion
    /// owns, so a backup or an audit finds it with the rest.
    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw")
            .appendingPathComponent("orion-controlled")
            .appendingPathComponent("focus-state.json")
    }

    /// `ORION_FOCUS_STATE` redirects it, for tests and for the harnesses. Reads
    /// this process's own environment only, which is not a channel anything
    /// hostile reaches — the app is launched by Nick from /Applications.
    public init(url: URL? = nil) {
        if let url {
            self.url = url
        } else if let override = ProcessInfo.processInfo.environment["ORION_FOCUS_STATE"],
                  !override.isEmpty {
            self.url = URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        } else {
            self.url = Self.defaultURL
        }
    }

    // MARK: Reading

    /// The current document.
    ///
    /// A missing file is an empty document — that is a real, ordinary state and
    /// the only one that reads as "no session". Anything else that goes wrong
    /// throws.
    public func load() throws -> SessionDocument {
        guard FileManager.default.fileExists(atPath: url.path) else { return .empty }

        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw SessionStoreError.corrupt(underlying: error.localizedDescription)
        }

        // An empty file is what a machine that lost power mid-rename leaves
        // behind. Treat it as absent rather than as corrupt: there is nothing to
        // recover, and refusing to start a new session because of it would turn
        // a power cut into a permanent outage.
        guard !data.isEmpty else { return .empty }

        return try SessionCoding.decode(data)
    }

    /// Load, but never throw — for callers that only want to display something.
    ///
    /// Returns the failure alongside the fallback rather than swallowing it, so
    /// the UI can show "the file is unreadable" instead of "no session", which
    /// are very different things to tell somebody.
    public func loadForDisplay() -> (document: SessionDocument, failure: SessionStoreError?) {
        do {
            return (try load(), nil)
        } catch let error as SessionStoreError {
            return (.empty, error)
        } catch {
            return (.empty, .corrupt(underlying: error.localizedDescription))
        }
    }

    // MARK: Writing

    /// Read-modify-write under the lock, with the read INSIDE it.
    ///
    /// The re-read is the half that is easy to skip and the only half that
    /// matters: a copy fetched before the lock was held is precisely the stale
    /// copy whose write-back erases somebody else's change.
    ///
    /// `change` returning nil means "leave it alone" and skips the write
    /// entirely — a reducer that rejected a command should not rewrite the file
    /// with identical bytes and bump its mtime.
    @discardableResult
    public func mutate(
        _ change: (SessionDocument) throws -> SessionDocument?
    ) throws -> SessionDocument {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )

        return try FileLock.withLock(url) {
            let current = try load()
            guard let next = try change(current) else { return current }
            try publish(next)
            return next
        }
    }

    /// Replace the document wholesale. Still locked, still atomic.
    public func write(_ document: SessionDocument) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileLock.withLock(url) { try publish(document) }
    }

    /// Scratch file, then rename.
    ///
    /// `rename(2)` rather than `replaceItemAt` for the same reason HealthLog
    /// uses it: it is the same atomic swap, and unlike `replaceItemAt` it also
    /// works on first run when there is no existing file to replace.
    ///
    /// 0600 because a session names what Nick is working on.
    private func publish(_ document: SessionDocument) throws {
        let data = try SessionCoding.encode(document)
        let scratch = url.deletingLastPathComponent()
            .appendingPathComponent(".focus-state.\(UUID().uuidString).tmp")

        try data.write(to: scratch, options: [.atomic, .completeFileProtection])
        try FileManager.default.setAttributes([.posixPermissions: 0o600],
                                              ofItemAtPath: scratch.path)

        guard rename(scratch.path, url.path) == 0 else {
            let failure = errno
            try? FileManager.default.removeItem(at: scratch)
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(failure),
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "could not publish focus-state.json: \(String(cString: strerror(failure)))"
                ]
            )
        }
    }
}
