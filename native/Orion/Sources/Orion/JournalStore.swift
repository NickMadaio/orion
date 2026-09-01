import Combine
import Foundation
import SessionService
import MobileCore

/*
 PHASE 35 — where journal entries live.

 The extraction rules are in MobileCore and are pure; this is the part that
 touches the disk, and it deliberately does very little else. Entries are
 append-only in spirit: a correction REPLACES an entry by id and keeps its
 `originalText`, so the record shows that Orion guessed and was told otherwise
 rather than showing only the final answer. Phase 36 reads this, and a
 correlation built on silently-rewritten history is a correlation about nothing.

 Two things copied deliberately from `HealthLog`, because they are cross-file
 contracts rather than preferences:

 · `FileLock.withLock` around the whole read-modify-write. Two subsystems now
   write under ~/.openclaw/orion-controlled/ and the lockfile NAME is the
   contract — two copies of that protocol is precisely how it drifts into two
   locks that exclude nothing.

 · An `ORION_HEALTH_JOURNAL` override, so a test can point this somewhere
   harmless. It reads the environment of this process only.
*/

// MARK: - The wire format

/// One entry as stored. Flat and boring on purpose: this file is read by a
/// future Phase 36 and possibly by a script, so it should be obvious.
struct StoredJournalEntry: Codable, Equatable {
    var id: String
    var eventType: String
    /// ISO-8601 UTC. Never a local datetime string — Phase 40's whole point.
    var time: String
    var source: String
    var confidence: String
    var notes: String
    var originalText: String
    /// When the row was written, as opposed to when the event happened.
    var recordedAt: String
}

struct JournalFile: Codable {
    var entries: [StoredJournalEntry] = []
    var updatedAt: String?
}

// MARK: - The store

final class JournalStore: ObservableObject {

    @Published private(set) var entries: [JournalEvent] = []
    @Published private(set) var lastError: String?
    /// The question a just-added entry raised, if it raised one. Cleared as soon
    /// as it is answered or another entry is added — it is a prompt, not state.
    @Published var pendingClarification: String?

    static var fileURL: URL {
        if let override = ProcessInfo.processInfo.environment["ORION_HEALTH_JOURNAL"],
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw")
            .appendingPathComponent("orion-controlled")
            .appendingPathComponent("health-journal.json")
    }

    private static let stamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "GMT")
        return formatter
    }()

    init(loadNow: Bool = true) {
        if loadNow { load() }
    }

    // MARK: Reading

    func load() {
        guard let data = try? Data(contentsOf: Self.fileURL) else {
            entries = []
            return
        }
        guard let file = try? JSONDecoder().decode(JournalFile.self, from: data) else {
            // Do NOT silently reset to empty. An unreadable journal that reports
            // as "no entries" tells Phase 36 there is nothing to correlate,
            // which is a finding rather than a failure.
            lastError = "The journal file could not be read; it has not been changed."
            return
        }
        entries = file.entries.compactMap(Self.decode).sorted { $0.time > $1.time }
    }

    static func decode(_ row: StoredJournalEntry) -> JournalEvent? {
        guard let type = JournalEventType(rawValue: row.eventType),
              let source = JournalSource(rawValue: row.source),
              let confidence = JournalConfidence(rawValue: row.confidence),
              let time = stamp.date(from: row.time) else { return nil }
        return JournalEvent(id: row.id, eventType: type, time: time, source: source,
                            confidence: confidence, notes: row.notes,
                            originalText: row.originalText)
    }

    static func encode(_ event: JournalEvent, recordedAt: Date) -> StoredJournalEntry {
        StoredJournalEntry(
            id: event.id, eventType: event.eventType.rawValue,
            time: stamp.string(from: event.time), source: event.source.rawValue,
            confidence: event.confidence.rawValue, notes: event.notes,
            originalText: event.originalText, recordedAt: stamp.string(from: recordedAt))
    }

    // MARK: Writing

    /// Read a line, store what came out, and surface a question only if the
    /// extractor raised one.
    @discardableResult
    func add(_ text: String, now: Date = Date()) -> JournalExtraction? {
        guard let extraction = JournalExtractor.extract(
            text, now: now, calendar: Calendar.current, id: Self.newID()) else {
            pendingClarification = nil
            return nil
        }
        write { file in
            file.entries.append(Self.encode(extraction.event, recordedAt: now))
        }
        pendingClarification = extraction.clarification
        return extraction
    }

    /// Replace an entry with a corrected version, by id.
    ///
    /// Goes through `JournalEvent.correcting` rather than building a new event,
    /// so a caller cannot produce a `.correction` at low confidence — the second
    /// door this codebase keeps finding unlocked.
    @discardableResult
    func correct(
        id: String, eventType: JournalEventType? = nil, time: Date? = nil,
        notes: String? = nil, now: Date = Date()
    ) -> JournalEvent? {
        guard let existing = entries.first(where: { $0.id == id }),
              let corrected = existing.correcting(eventType: eventType, time: time, notes: notes)
        else { return nil }
        write { file in
            file.entries.removeAll { $0.id == id }
            file.entries.append(Self.encode(corrected, recordedAt: now))
        }
        pendingClarification = nil
        return corrected
    }

    func entryCount(on day: Date, calendar: Calendar = .current) -> Int {
        entries.filter { calendar.isDate($0.time, inSameDayAs: day) }.count
    }

    private func write(_ change: (inout JournalFile) -> Void) {
        do {
            try FileManager.default.createDirectory(
                at: Self.fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            try FileLock.withLock(Self.fileURL) {
                var file = (try? Data(contentsOf: Self.fileURL))
                    .flatMap { try? JSONDecoder().decode(JournalFile.self, from: $0) }
                    ?? JournalFile()
                change(&file)
                file.updatedAt = Self.stamp.string(from: Date())
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                let data = try encoder.encode(file)
                let temporary = Self.fileURL.appendingPathExtension("tmp")
                try data.write(to: temporary, options: .atomic)
                _ = try FileManager.default.replaceItemAt(Self.fileURL, withItemAt: temporary)
            }
            load()
            lastError = nil
        } catch {
            lastError = "Could not save the journal: \(error.localizedDescription)"
        }
    }

    /// Short, unique, and not a timestamp.
    ///
    /// Two entries typed in the same second must not collide, and an id that
    /// encodes the time would make a correction that moves the time look like a
    /// different entry.
    static func newID() -> String {
        "j-" + UUID().uuidString.prefix(8).lowercased()
    }
}
