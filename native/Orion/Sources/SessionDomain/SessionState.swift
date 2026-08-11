//
//  Everything that is persisted, and the rules for reading a file written by an
//  older version of this code.
//
//  The state is a value type with no derived fields. There is no `currentPhase`,
//  no `phaseEndsAt`, no `servedMinutes` — every one of those is a function of
//  the plan and the event log, and storing them would create a second copy that
//  can disagree with the first. The bugs that come from that disagreement are
//  exactly the ones that are hardest to see: nothing throws, the numbers are
//  just quietly wrong.
//
//  Migration is not optional. `focus-state.json` will outlive several versions
//  of this code, and Nick's history is not something a schema change is allowed
//  to throw away. So the version is stored, unknown newer versions are refused
//  rather than guessed at, and a corrupt file is a reported condition rather
//  than an empty session.
//

import Foundation

// MARK: - State

public struct SessionState: Codable, Equatable, Sendable {

    /// Bumped whenever the stored shape changes. Read `Migration` before
    /// touching it.
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let id: SessionID

    /// The logical day this session belongs to, from `OrionDay` in the app.
    /// Local, 4 am cutoff. Fixed at start and never recomputed — a session that
    /// crosses the boundary belongs to the day it began in, otherwise the same
    /// session would move between days while it ran.
    public let dayKey: String

    public let plan: SessionPlan

    /// Append-only.
    public let events: [LifecycleEvent]

    /// Effects that have been carried out. Separate from the events, because an
    /// effect being DONE is a different fact from anything having happened to
    /// the session.
    public let acknowledgedEffects: Set<String>

    public init(schemaVersion: Int = SessionState.currentSchemaVersion,
                id: SessionID,
                dayKey: String,
                plan: SessionPlan,
                events: [LifecycleEvent],
                acknowledgedEffects: Set<String> = []) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.dayKey = dayKey
        self.plan = plan
        self.events = events
        self.acknowledgedEffects = acknowledgedEffects
    }

    // MARK: Immutable updates

    /// Every change produces a new value. Nothing here mutates in place, so a
    /// half-applied update cannot exist — in memory or, once the store writes
    /// it, on disk.
    public func appending(_ event: LifecycleEvent) -> SessionState {
        SessionState(schemaVersion: schemaVersion, id: id, dayKey: dayKey, plan: plan,
                     events: events + [event], acknowledgedEffects: acknowledgedEffects)
    }

    /// Append a heartbeat, or move the existing trailing one forward.
    ///
    /// The documented exception to append-only, and the only one. See
    /// `EventKind.processAlive` for why it is safe: a heartbeat records a fact
    /// about the process, never about the session, so replacing one loses
    /// nothing. Coalescing is what keeps a three-hour session from accumulating
    /// two hundred watermark events.
    public func heartbeating(eventID: String, stamp: ClockStamp) -> SessionState {
        let beat = LifecycleEvent(id: eventID, stamp: stamp, kind: .processAlive)
        let updated = events.last?.kind == .processAlive
            ? events.dropLast() + [beat]
            : events + [beat]

        return SessionState(schemaVersion: schemaVersion, id: id, dayKey: dayKey, plan: plan,
                            events: Array(updated), acknowledgedEffects: acknowledgedEffects)
    }

    public func acknowledging(_ effect: EffectID) -> SessionState {
        SessionState(schemaVersion: schemaVersion, id: id, dayKey: dayKey, plan: plan,
                     events: events, acknowledgedEffects: acknowledgedEffects.union([effect.raw]))
    }

    public func hasAcknowledged(_ effect: EffectID) -> Bool {
        acknowledgedEffects.contains(effect.raw)
    }

    public var isFinished: Bool { events.isFinished }
}

// MARK: - The persisted envelope

/// What is actually on disk.
///
/// A session is wrapped rather than stored bare so the file can hold nothing —
/// which is the normal state most of the time — without that being represented
/// as a corrupt or missing file. `{"session": null}` is a valid, meaningful
/// document, and it is what `orion-focus` already writes.
public struct SessionDocument: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let session: SessionState?

    public init(session: SessionState?) {
        self.schemaVersion = SessionState.currentSchemaVersion
        self.session = session
    }

    public init(schemaVersion: Int, session: SessionState?) {
        self.schemaVersion = schemaVersion
        self.session = session
    }

    public static var empty: SessionDocument { SessionDocument(session: nil) }
}

// MARK: - Reading and writing

public enum SessionCoding {

    /// Sorted keys so a golden fixture is stable and a diff of the state file is
    /// readable. ISO-8601 dates rather than raw intervals for the same reason —
    /// this file gets read by a human when something has gone wrong.
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    public static func encode(_ document: SessionDocument) throws -> Data {
        try encoder().encode(document)
    }

    /// Decode, migrating if necessary.
    ///
    /// Throws rather than returning an empty document. "The file is unreadable"
    /// and "there is no session" are different facts and the caller has to be
    /// able to tell them apart — silently turning the first into the second is
    /// how a running session disappears without anything appearing in a log.
    public static func decode(_ data: Data) throws -> SessionDocument {
        let decoder = decoder()

        // Read the version before the body, so a newer file can be refused
        // instead of being half-decoded into something that looks plausible.
        let probe: VersionProbe
        do {
            probe = try decoder.decode(VersionProbe.self, from: data)
        } catch {
            throw SessionStoreError.corrupt(underlying: String(describing: error))
        }

        guard probe.schemaVersion <= SessionState.currentSchemaVersion else {
            throw SessionStoreError.fromTheFuture(
                found: probe.schemaVersion,
                supported: SessionState.currentSchemaVersion
            )
        }

        do {
            let document = try decoder.decode(SessionDocument.self, from: data)
            return try Migration.migrate(document)
        } catch let error as SessionStoreError {
            throw error
        } catch {
            throw SessionStoreError.corrupt(underlying: String(describing: error))
        }
    }

    private struct VersionProbe: Decodable {
        let schemaVersion: Int
    }
}

// MARK: - Errors

public enum SessionStoreError: Error, Equatable, Sendable {
    /// The bytes are not a session document.
    case corrupt(underlying: String)

    /// Written by a newer Orion. Refused deliberately: guessing at a shape we
    /// do not know is how history gets destroyed by a downgrade.
    case fromTheFuture(found: Int, supported: Int)

    /// The version is one we used to write but no longer know how to read.
    case unmigratable(from: Int)

    /// What Nick sees. Every one of these has to be visible — a silently empty
    /// session is this project's worst failure mode.
    public var message: String {
        switch self {
        case .corrupt:
            return "The focus session file could not be read. "
                 + "Nothing has been changed; the file is still there."
        case .fromTheFuture(let found, let supported):
            return "The focus session file was written by a newer version of Orion "
                 + "(format \(found), this build reads \(supported)). Refusing to touch it."
        case .unmigratable(let from):
            return "The focus session file is in format \(from), which this build "
                 + "no longer knows how to read."
        }
    }
}

// MARK: - Migration

public enum Migration {

    /// The oldest version this build can still read.
    public static let oldestReadable = 1

    /// Bring a decoded document up to the current schema.
    ///
    /// Deliberately a no-op today — version 1 is the first. It exists now, with
    /// its test, so that adding version 2 is editing a working mechanism rather
    /// than inventing one under pressure while a user's history is at stake.
    ///
    /// The rule for every future step: migrations only ever ADD or DERIVE. A
    /// migration that drops a field drops a fact about a session Nick actually
    /// ran, and there is no version of that which is acceptable.
    public static func migrate(_ document: SessionDocument) throws -> SessionDocument {
        guard document.schemaVersion >= oldestReadable else {
            throw SessionStoreError.unmigratable(from: document.schemaVersion)
        }
        guard document.schemaVersion < SessionState.currentSchemaVersion else {
            return document
        }

        // Future steps chain here, each one taking version N to N+1.
        return SessionDocument(session: document.session)
    }
}
