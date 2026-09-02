import Foundation

// PHASE 45 — remote Mac, read-only.
//
// Three capabilities, one prohibition, and seven failure modes the manifest
// names by hand: replay, expiration, revocation, wrong-device routing,
// malformed jobs, network failure, duplicate jobs.
//
// ## "Do not modify anything" is an absent enum member
//
// `ReadOnlyCapability` has exactly three cases and there is no fourth. A write
// capability cannot be named, so no job can request one and no handler can be
// written for one. `JobGate.evaluate` returns a VERDICT and never performs an
// effect — deciding and doing are separate types, so nothing in this file can
// touch the Mac even by accident.
//
// ## Why starting read-only is what makes the retry story safe
//
// This is the part worth writing down, because it is the reason the manifest
// orders the phases this way rather than an incidental detail.
//
// A remote job can fail in two directions that look identical from the phone:
// the job never arrived, or the ANSWER never came back. The phone cannot tell
// them apart, so it must retry, and a retry of a state-changing job is how you
// get two of something. Every one of these three capabilities is a pure read,
// so answering twice costs nothing and returns the same thing. That is what
// makes "network failure" survivable here and what will make it dangerous in
// Phase 46, when the actions stop being harmless.
//
// So `duplicate` and `replay` are deliberately NOT the same rejection:
//
//   · A REPLAY is the same job id arriving twice. It is refused, because a
//     resent id is indistinguishable from an attacker resending a captured
//     one, and the gate must not have to guess which.
//   · A DUPLICATE is the same request under a NEW id — what an honest client
//     does when its answer was lost. It is accepted, because the capability is
//     a read. The rule a client has to follow falls out of that: mint a new id
//     to retry, never re-send the old one.
//
// ## Order of judgement is pinned
//
// Several rejections can apply to one job, so which one is reported is a
// decision and not an accident: routing, then authority, then freshness, then
// replay. A job addressed elsewhere is judged first and is NOT recorded as
// seen — it was never this device's to have an opinion about, and recording it
// would let anyone fill this device's replay memory with jobs meant for
// somebody else.

// MARK: - What may be asked for

/// The three low-risk reads the manifest begins with.
///
/// There is no write member, and that absence is the enforcement of "do not
/// modify anything". Raw values are the manifest's own dotted names.
public enum ReadOnlyCapability: String, CaseIterable, Sendable {
    case deviceStatusRead = "device.status.read"
    case applicationList = "application.list"
    case filesSafeMetadata = "files.safe_metadata"

    /// Every capability here is a pure read, so answering the same question
    /// twice returns the same thing and costs nothing. Total switch: a
    /// capability that were not idempotent would have to say so out loud, and
    /// there is nowhere for it to hide.
    public var isIdempotent: Bool {
        switch self {
        case .deviceStatusRead, .applicationList, .filesSafeMetadata: return true
        }
    }

    /// What it returns, for a consent screen. `files.safe_metadata` is the one
    /// worth spelling out: names, sizes and dates, never contents.
    public var describesReturn: String {
        switch self {
        case .deviceStatusRead: return "battery, uptime, disk space and whether the Mac is awake"
        case .applicationList: return "which applications are running, by name"
        case .filesSafeMetadata: return "file names, sizes and dates — never contents"
        }
    }
}

// MARK: - A job

public struct RemoteJob: Sendable, Equatable, Identifiable {
    public let id: String
    public let capability: ReadOnlyCapability
    /// Which Mac this is for. A job with no target is refused rather than
    /// treated as a broadcast — see `JobGate`.
    public let targetDeviceID: String
    public let issuedAt: Date
    public let expiresAt: Date

    /// Malformed jobs cannot be constructed. This is the manifest's "malformed
    /// jobs" test: not a handler that copes with rubbish, a type that rubbish
    /// cannot become.
    public init?(id: String, capability: ReadOnlyCapability, targetDeviceID: String,
                 issuedAt: Date, expiresAt: Date) {
        guard let id = RemoteJob.token(id, limit: 64),
              let targetDeviceID = RemoteJob.token(targetDeviceID, limit: 64),
              // A job that expires before it was issued is not a short-lived
              // job, it is a broken one, and accepting it would make every
              // freshness check below meaningless.
              expiresAt > issuedAt
        else { return nil }
        self.id = id
        self.capability = capability
        self.targetDeviceID = targetDeviceID
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
    }

    /// Ids and device ids are opaque handles, not text. Restricting them to
    /// hex, hyphen and underscore means nothing downstream has to wonder
    /// whether one can carry a control character, a path, or a shell word.
    private static func token(_ raw: String, limit: Int) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= limit else { return nil }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard trimmed.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return trimmed
    }
}

// MARK: - The verdict

public enum JobRejection: String, CaseIterable, Sendable, Equatable {
    /// Addressed to a different Mac.
    case wrongDevice = "wrong_device"
    /// The issuing device's authority has been withdrawn.
    case revoked
    /// Past its expiry.
    case expired
    /// This exact job id has been judged before.
    case replay
}

public enum JobVerdict: Sendable, Equatable {
    case accepted
    case rejected(JobRejection)

    public var isAccepted: Bool { self == .accepted }
    public var rejection: JobRejection? {
        if case .rejected(let reason) = self { return reason }
        return nil
    }
}

// MARK: - The gate

/// Decides whether a job may be answered. Decides only — it never acts.
///
/// Immutable in the caller's sense: `evaluate` returns a verdict and the NEXT
/// gate, rather than mutating one in place, so a caller cannot accidentally
/// record a job as seen while failing to act on the verdict.
public struct JobGate: Sendable, Equatable {
    /// This Mac. A job for anyone else is not this gate's business.
    public let deviceID: String
    /// Job ids already judged. Bounded, newest kept.
    public private(set) var seen: [String]
    /// Issuers whose authority has been withdrawn.
    public private(set) var revokedIssuers: Set<String>
    public let memory: Int

    public init?(deviceID: String, seen: [String] = [], revokedIssuers: Set<String> = [], memory: Int = 500) {
        let trimmed = deviceID.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, memory > 0 else { return nil }
        self.deviceID = trimmed
        self.seen = Array(seen.suffix(memory))
        self.revokedIssuers = revokedIssuers
        self.memory = memory
    }

    public func revoking(_ issuer: String) -> JobGate {
        var next = self
        next.revokedIssuers.insert(issuer)
        return next
    }

    /// Judge one job at an injected instant.
    ///
    /// The order is pinned and is a decision, not an accident:
    ///
    ///  1. **Wrong device.** Judged first, and crucially the job is NOT
    ///     recorded as seen. It was never this device's to have an opinion
    ///     about, and recording it would let anybody fill this device's replay
    ///     memory with jobs addressed to somebody else — a denial of service
    ///     that costs the attacker nothing and needs no valid credential.
    ///  2. **Revoked issuer.** Authority before freshness: a withdrawn device's
    ///     job must be refused whether it is fresh or not, and reporting it as
    ///     merely expired would suggest a newer one would work.
    ///  3. **Expired.** The boundary belongs to expiry — a job at exactly its
    ///     expiry instant is expired. `orion-remote` today stamps an envelope
    ///     with a time and never checks it, which is this rule's absence.
    ///  4. **Replay.** Last, because the three above are properties of the job
    ///     and this one is a property of what this device has already done.
    ///
    /// Everything that gets past step 1 is recorded, including rejections, so
    /// a rejected id cannot be retried into a different answer.
    public func evaluate(_ job: RemoteJob, at moment: Date, issuer: String) -> (verdict: JobVerdict, gate: JobGate) {
        guard job.targetDeviceID == deviceID else {
            return (.rejected(.wrongDevice), self)
        }
        var next = self
        next.seen = Array((seen + [job.id]).suffix(memory))

        if revokedIssuers.contains(issuer) { return (.rejected(.revoked), next) }
        if moment >= job.expiresAt { return (.rejected(.expired), next) }
        if seen.contains(job.id) { return (.rejected(.replay), next) }
        return (.accepted, next)
    }
}
