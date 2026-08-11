//
//  focus-history.jsonl — every session Nick has ever run, and never pruned.
//
//  Append-only, one JSON object per line. JSONL rather than a JSON array so an
//  append is genuinely an append: no read, no rewrite, and a process killed
//  mid-write costs at most the last line rather than the whole file.
//
//  The idempotency rule is the important one. `reconcile` emits the history
//  effect for a finished session on every pass until it is acknowledged, and the
//  service can die between writing the line and recording the acknowledgement.
//  So the append itself checks whether that session is already in the file and
//  does nothing if it is. Belt and braces with the acknowledgement, deliberately:
//  a duplicate history record is a corrupted record of Nick's actual life, and
//  the calendar in Gate 8 draws from this.
//
//  Nothing here ever deletes or rewrites a line. Rollback for any future change
//  has to be additive, because a migration that drops a field drops a fact about
//  a session he really did.
//

import Foundation
import SessionDomain

public final class SessionHistory {

    public let url: URL

    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw")
            .appendingPathComponent("orion-controlled")
            .appendingPathComponent("focus-history.jsonl")
    }

    public init(url: URL? = nil) {
        if let url {
            self.url = url
        } else if let override = ProcessInfo.processInfo.environment["ORION_FOCUS_HISTORY"],
                  !override.isEmpty {
            self.url = URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        } else {
            self.url = Self.defaultURL
        }
    }

    // MARK: Appending

    /// Append one record unless that session is already recorded.
    ///
    /// Returns whether a line was actually written, so the caller can tell a
    /// real append from a no-op — a service that thinks it wrote history when it
    /// did not is a different bug from one that wrote it twice.
    @discardableResult
    public func append(_ record: HistoryRecord) throws -> Bool {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )

        return try FileLock.withLock(url) {
            // Inside the lock, because the check and the append have to be one
            // operation or two processes both see "not there" and both write.
            guard try !containsUnlocked(sessionID: record.sessionID) else { return false }

            // Compact, one line. The pretty-printing that makes focus-state.json
            // readable would make this file unparseable line by line.
            try appendUnlocked(compact(record))
            return true
        }
    }

    private func compact(_ record: HistoryRecord) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(record)
    }

    private func appendUnlocked(_ line: Data) throws {
        var payload = line
        payload.append(0x0A)  // newline

        if let handle = FileHandle(forWritingAtPath: url.path) {
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: payload)
        } else {
            try payload.write(to: url, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600],
                                                  ofItemAtPath: url.path)
        }
    }

    // MARK: Reading

    public func contains(sessionID: String) throws -> Bool {
        try FileLock.withLock(url) { try containsUnlocked(sessionID: sessionID) }
    }

    private func containsUnlocked(sessionID: String) throws -> Bool {
        try records().contains { $0.sessionID == sessionID }
    }

    /// Every record, oldest first.
    ///
    /// A single unparseable line is SKIPPED rather than failing the read. This
    /// is the one place that choice is right: a torn final line from a power cut
    /// must not make the whole of Nick's history unreadable, and the calendar
    /// showing all but the last session beats it showing nothing. Corruption in
    /// the middle is reported separately by `readWithFailures`.
    public func records() throws -> [HistoryRecord] {
        try readWithFailures().records
    }

    public func readWithFailures() throws -> (records: [HistoryRecord], skipped: Int) {
        guard FileManager.default.fileExists(atPath: url.path) else { return ([], 0) }

        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw SessionStoreError.corrupt(underlying: error.localizedDescription)
        }

        let decoder = SessionCoding.decoder()
        var records: [HistoryRecord] = []
        var skipped = 0

        for line in data.split(separator: 0x0A) {
            guard !line.isEmpty else { continue }
            if let record = try? decoder.decode(HistoryRecord.self, from: Data(line)) {
                records.append(record)
            } else {
                skipped += 1
            }
        }
        return (records, skipped)
    }

    /// Everything for one logical day, for the calendar.
    public func records(on dayKey: String) throws -> [HistoryRecord] {
        try records().filter { $0.dayKey == dayKey }
    }
}
