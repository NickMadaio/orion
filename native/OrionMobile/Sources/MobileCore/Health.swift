import Foundation

// HealthKit, as a local port. Nothing here imports HealthKit.
//
// The iOS build is what keeps MobileCore free of platform frameworks, and this
// phase does not spend that. What lives here is the authorization state machine,
// the set of types ORION asks for, and the shape of a sample. The HKHealthStore
// adapter is the platform layer and it does not exist -- the same position
// Phase 12 took with the cipher and Phase 16 with the secure store, for the same
// reason: a placeholder that silently returns plausible numbers would be
// indistinguishable from working until the day it mattered.

/// The categories the manifest names. Eight, and no more.
///
/// "Do not request every HealthKit permission" is not a warning to be careful.
/// It is why this enum exists at all: the set of types ORION may ask for is
/// closed, and `HealthTypeCatalogue` records how much of HealthKit that is.
public enum HealthType: String, CaseIterable, Sendable, Comparable {
    case sleep
    case restingHeartRate = "resting_heart_rate"
    case heartRateVariability = "heart_rate_variability"
    case respiratoryRate = "respiratory_rate"
    case steps
    case activeEnergy = "active_energy"
    case workouts
    case exerciseMinutes = "exercise_minutes"

    public static func < (lhs: HealthType, rhs: HealthType) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// How much of HealthKit ORION deliberately does not ask for.
///
/// A number rather than a comment, so "we only request a few types" is something
/// the check can fail on. HealthKit exposes well over a hundred quantity,
/// category and clinical types; the count below is a deliberate floor for the
/// comparison, not a claim to be exact.
public enum HealthTypeCatalogue {
    /// A conservative lower bound on what HealthKit offers.
    public static let approximateAvailableTypes = 100

    /// Types ORION will not request in this phase or any later one without its
    /// own decision, with the reason. Clinical records especially: reading
    /// somebody's medical records to plan their week is not a feature.
    public static let neverRequested: [String: String] = [
        "clinical_records": "medical records are not planning input; reading them to schedule a day is not a feature",
        "mental_health": "state-of-mind entries are a journal, not a signal, and Phase 35 owns the journal",
        "reproductive_health": "not used by anything ORION does, and the most sensitive category there is",
        "blood_glucose": "clinical data ORION has no competence to interpret",
        "medications": "an app that knows the medications is an app that will be asked about them",
    ]
}

/// Where a request for one type stands.
public enum HealthAuthorization: String, Sendable, Equatable {
    case notRequested = "not_requested"
    case requested
    /// The person declined, and HealthKit told us -- which it does for WRITE
    /// access only.
    case denied
    /// The request completed and HealthKit will not say what was granted.
    ///
    /// **This is the normal outcome for a read.** Apple deliberately makes a
    /// denial and an empty data set indistinguishable so that an app cannot
    /// detect a refusal. That is the privacy property, not a limitation to be
    /// worked around -- and pretending otherwise produces the bug AGENTS.md
    /// already records: missing health data is not zero.
    case unknowable
    /// Previously granted and taken away. Distinguished from `denied` because
    /// what happens next is different: local history stays.
    case revoked
}

public enum HealthError: Error, Equatable {
    case unavailable(String)
    case notOnThisDevice(String)
    case tooBroad(String)
    case nothingNewToRequest
}

/// What a query found, kept distinct from what it means.
///
/// Three outcomes and not two. `noData` is not `denied` and neither is zero: a
/// person who did not wear their watch has no resting heart rate, and scoring
/// that as zero tells them they had a bad day because a device did not sync.
public enum HealthReading: Sendable, Equatable {
    case samples([HealthSample])
    case noData
    case notAuthorized
}

/// One measurement. Deliberately not `Codable`.
///
/// "Keep raw historical HealthKit data local whenever practical" is a rule about
/// a type. This one has no JSON form, no `encode`, and no initialiser from a
/// serialised representation, so a future convenience cannot upload it without
/// somebody first writing the encoder and being asked why. Phase 17's cache
/// rules already list `health_state` as never cached; this is the same rule at
/// the other end.
public struct HealthSample: Sendable, Equatable {
    public let type: HealthType
    public let start: Date
    public let end: Date
    public let value: Double
    public let unit: String

    public init(type: HealthType, start: Date, end: Date, value: Double, unit: String) {
        self.type = type
        self.start = start
        self.end = end
        self.value = value
        self.unit = unit
    }
}

/// The port an adapter would implement.
public protocol HealthStore: Sendable {
    func requestAuthorization(for types: Set<HealthType>) throws -> [HealthType: HealthAuthorization]
    func read(_ type: HealthType, from: Date, to: Date) throws -> HealthReading
}

/// The default. Refuses rather than returning plausible numbers.
public struct RefusingHealthStore: HealthStore {
    public init() {}

    public func requestAuthorization(for types: Set<HealthType>) throws -> [HealthType: HealthAuthorization] {
        throw HealthError.unavailable(
            "no HealthKit adapter is installed: iOS reads through HKHealthStore, which MobileCore does not import"
        )
    }

    public func read(_ type: HealthType, from: Date, to: Date) throws -> HealthReading {
        throw HealthError.unavailable("no HealthKit adapter is installed")
    }
}

/// iPhone only, as the manifest says.
public enum HealthDevice: String, Sendable, CaseIterable {
    case iPhone
    case iPad
    case mac
    case watch

    /// Watch is excluded here and that is not an oversight: Phase 77 is "Future
    /// Apple Watch Expansion". A watch that started reading health data now
    /// would make that phase a migration rather than an addition.
    public var mayReadHealth: Bool { self == .iPhone }
}

/// The incremental request ledger.
///
/// "Request individual data types incrementally" means the second request asks
/// only for what is new. Re-requesting a type the person already answered
/// re-opens a permission sheet they have already seen, and the thing people
/// learn from repeated sheets is to dismiss them.
public struct HealthAuthorizationLedger: Sendable, Equatable {
    private var states: [HealthType: HealthAuthorization]
    public let device: HealthDevice

    public init(device: HealthDevice = .iPhone) {
        self.device = device
        self.states = Dictionary(
            uniqueKeysWithValues: HealthType.allCases.map { ($0, .notRequested) }
        )
    }

    public func status(of type: HealthType) -> HealthAuthorization {
        states[type] ?? .notRequested
    }

    /// The subset of `wanted` that has not been asked about yet.
    public func outstanding(from wanted: Set<HealthType>) -> Set<HealthType> {
        wanted.filter { status(of: $0) == .notRequested }
    }

    /// Whether this ledger's own device may hold health authorization at all.
    ///
    /// The stored `device` used to be written once and read by nothing: the
    /// guard consulted the `on:` PARAMETER, so a ledger constructed for `.mac`
    /// authorized happily when the caller passed `on: .iPhone`, and the two
    /// values disagreed with the stored one losing silently. An independent
    /// review re-pointed the guard at `self.device` and no assertion noticed.
    private func requireThisDeviceMayRead() throws {
        guard device.mayReadHealth else {
            throw HealthError.notOnThisDevice(
                "the manifest puts HealthKit on iPhone only; \(device.rawValue) does not read health data"
            )
        }
    }

    /// Ask for what is new. Refuses an empty ask and refuses the whole catalogue.
    public mutating func request(_ wanted: Set<HealthType>, on device: HealthDevice) throws -> Set<HealthType> {
        try requireThisDeviceMayRead()
        guard device == self.device else {
            // Two devices in one call is a caller that has lost track of which
            // machine it is on, and the safe reading is neither.
            throw HealthError.notOnThisDevice(
                "this ledger belongs to \(self.device.rawValue) and was asked to request on \(device.rawValue)"
            )
        }
        guard device.mayReadHealth else {
            throw HealthError.notOnThisDevice(
                "the manifest puts HealthKit on iPhone only; \(device.rawValue) does not read health data"
            )
        }
        guard wanted.count <= HealthType.allCases.count else {
            throw HealthError.tooBroad("ORION asks for eight types and there are only eight")
        }
        let new = outstanding(from: wanted)
        guard !new.isEmpty else { throw HealthError.nothingNewToRequest }
        for type in new { states[type] = .requested }
        return new
    }

    /// Record what came back. A read that completed with no answer is
    /// `unknowable`, which is the normal case.
    public mutating func settle(_ type: HealthType, as outcome: HealthAuthorization) throws {
        try requireThisDeviceMayRead()
        guard status(of: type) != .notRequested else {
            // An outcome for something never asked about is an authorization
            // that skipped the permission sheet. It was the only path back from
            // `revoked` too, which made revocation re-grantable in silence.
            throw HealthError.unavailable(
                "\(type.rawValue) was never requested; there is no outcome to record"
            )
        }
        states[type] = outcome
    }

    /// Access taken away. **Nothing local is deleted.**
    ///
    /// Revocation says ORION may no longer read new data. It does not say the
    /// person wants their history erased, and a re-grant an hour later should
    /// find it where they left it -- the same position Phase 22 took on an
    /// OAuth grant being revoked.
    public mutating func revoke(_ type: HealthType) {
        // Deliberately not gated and deliberately not throwing: taking access
        // away must always succeed, including on a device that should never
        // have had it.
        states[type] = .revoked
    }

    /// Ask again for something that was revoked.
    ///
    /// `outstanding` only returns `.notRequested` types, so a revoked type
    /// could never be re-requested -- and the only path back to readable was
    /// `settle`, with no request, no sheet and no device check. Re-granting is
    /// a decision, so it is its own named call.
    public mutating func reopen(_ type: HealthType) throws {
        try requireThisDeviceMayRead()
        guard status(of: type) == .revoked || status(of: type) == .denied else {
            throw HealthError.nothingNewToRequest
        }
        states[type] = .notRequested
    }

    /// Types ORION may currently attempt to read.
    public var readable: Set<HealthType> {
        Set(states.filter { $0.value == .unknowable }.keys)
    }

    /// Whether any type is in a state that needs the person's attention.
    public var needsAttention: Set<HealthType> {
        Set(states.filter { $0.value == .denied || $0.value == .revoked }.keys)
    }
}

/// Reading, with the states kept honest.
public enum HealthLocalLayer {
    /// Interpret a query result against what is known about authorization.
    ///
    /// The one function that decides what an empty answer means, so the decision
    /// is in one place rather than at every call site that gets an empty array.
    public static func interpret(
        _ samples: [HealthSample],
        authorization: HealthAuthorization
    ) -> HealthReading {
        switch authorization {
        case .denied:
            return .notAuthorized
        case .revoked:
            // Revocation stops NEW reads. The gate says local history stays,
            // and reporting `.notAuthorized` over samples already held threw it
            // away at the one place a caller would look for it.
            return samples.isEmpty ? .noData : .samples(samples)
        case .notRequested, .requested:
            // `.requested` means the sheet is up and nothing is known yet.
            // Reporting it in the DENIED bucket says the person refused, which
            // is a different claim from "we have not been told".
            return .notAuthorized
        case .unknowable:
            // The whole point. Empty means empty; it does not mean denied and
            // it certainly does not mean zero.
            return samples.isEmpty ? .noData : .samples(samples)
        }
    }

    /// Whether a reading may contribute a number to anything.
    ///
    /// `noData` may not. AGENTS.md records what happens otherwise: a score that
    /// counts a missing input as zero tells somebody they had a bad day because
    /// a watch did not sync.
    public static func contributes(_ reading: HealthReading) -> Bool {
        if case .samples(let samples) = reading { return !samples.isEmpty }
        return false
    }
}
