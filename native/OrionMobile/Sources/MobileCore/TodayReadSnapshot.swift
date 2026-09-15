import Foundation

/// Wire envelope for the local read-only service. A read time never refreshes a plan.
public struct TodayReadSnapshot: Codable, Equatable, Sendable {
    public let revision: Int
    public let capturedAt: Double // Unix seconds; nested TodayPlan uses Swift's default date encoding.
    public let plan: TodayPlan?

    public init(revision: Int, capturedAt: Double, plan: TodayPlan?) throws {
        self.revision = revision; self.capturedAt = capturedAt; self.plan = plan
        try validate()
    }
    private enum CodingKeys: String, CodingKey { case revision, capturedAt, plan }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        guard values.contains(.plan) else { throw TodayPlanError.invalidInput }
        try self.init(revision: values.decode(Int.self, forKey: .revision),
                      capturedAt: values.decode(Double.self, forKey: .capturedAt),
                      plan: values.decodeIfPresent(TodayPlan.self, forKey: .plan))
    }
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(revision, forKey: .revision)
        try values.encode(capturedAt, forKey: .capturedAt)
        if let plan { try values.encode(plan, forKey: .plan) }
        else { try values.encodeNil(forKey: .plan) }
    }
    public func validate() throws {
        guard (0...9_007_199_254_740_991).contains(revision), capturedAt.isFinite, capturedAt >= 0 else {
            throw TodayPlanError.invalidInput
        }
        try plan?.validate()
    }
    public func isCurrent(at now: Date) -> Bool {
        guard let plan, let zone = TimeZone(identifier: plan.timeZone) else { return false }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        // Capture and actual planning evidence must both be recent; exporting an old plan cannot refresh it.
        return (0...300).contains(now.timeIntervalSince1970 - capturedAt)
            && (0...300).contains(now.timeIntervalSince(plan.generatedAt))
            && calendar.isDate(plan.day, inSameDayAs: now)
    }
    public static func decodeResponse(_ data: Data, expectedOwner: String) throws -> TodayReadSnapshot {
        struct Envelope: Decodable { let schemaVersion: Int; let ownerID: String; let snapshot: TodayReadSnapshot }
        guard data.count <= 1_100_000, !expectedOwner.isEmpty else { throw TodayPlanError.invalidInput }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.schemaVersion == 1, envelope.ownerID == expectedOwner else { throw TodayPlanError.invalidInput }
        try envelope.snapshot.validate()
        return envelope.snapshot
    }
}

/// Keep continuity evidence when an invalid response clears the visible reading.
public struct TodayReadHistory: Sendable {
    public private(set) var reading: TodayReadSnapshot?
    private var verified: TodayReadSnapshot?
    public init() {}
    public mutating func receive(_ incoming: TodayReadSnapshot) throws {
        do {
            try incoming.validate()
            if let verified {
                guard incoming.revision >= verified.revision,
                      incoming.revision != verified.revision || incoming == verified else {
                    throw TodayPlanError.revisionConflict
                }
            }
            verified = incoming; reading = incoming
        } catch { reading = nil; throw error }
    }
    public mutating func clear() { reading = nil; verified = nil }
}
