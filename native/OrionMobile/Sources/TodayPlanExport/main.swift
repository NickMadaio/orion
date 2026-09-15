import Foundation
import MobileCore

// Explicit read-only export. No default personal path and no changes to the source store.
struct Document: Decodable { let schemaVersion: Int; let revision: Int; let current: TodayPlan? }
do {
    let args = Array(CommandLine.arguments.dropFirst())
    let snapshot: TodayReadSnapshot
    if args == ["--fixture"] {
        let now = Date()
        let plan = try TodayPlanScheduler.propose(now: now, timeZone: "Europe/London",
            preferences: TodayPlanPreferences(), tasks: [], commitments: [],
            reason: "Connection test fixture", sourceFingerprint: "phone-read-fixture-v1")
        snapshot = try .init(revision: 1, capturedAt: now.timeIntervalSince1970, plan: plan)
    } else {
        guard args.count == 1 else { throw TodayPlanError.invalidInput }
        let url = URL(fileURLWithPath: args[0])
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 8 * 1024 * 1024 else { throw TodayPlanError.invalidInput }
        let doc = try JSONDecoder().decode(Document.self, from: Data(contentsOf: url))
        guard doc.schemaVersion == 1 else { throw TodayPlanError.invalidInput }
        snapshot = try .init(revision: doc.revision, capturedAt: doc.current?.generatedAt.timeIntervalSince1970 ?? 0, plan: doc.current)
    }
    let data = try JSONEncoder().encode(snapshot)
    guard data.count <= 1_000_000 else { throw TodayPlanError.invalidInput }
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("Export refused: invalid or unreadable plan.\n".utf8))
    exit(1)
}
