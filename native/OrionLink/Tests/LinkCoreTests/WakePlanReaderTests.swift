import XCTest
import MobileCore
@testable import LinkCore

final class WakePlanReaderTests: XCTestCase {
    private var home: URL!
    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".openclaw/orion-controlled"), withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: self.home) }
    }
    private func write(_ json: String) throws {
        try json.write(to: home.appendingPathComponent(".openclaw/orion-controlled/wake-plan.json"), atomically: true, encoding: .utf8)
    }

    func testANickPlanIsCarriedWithTheFileFields() throws {
        try write(#"{"generatedAt":"2026-11-02T20:00:00.000Z","source":"nick","alarms":[{"date":"2026-11-03","at":"07:15","iso":"2026-11-03T12:15:00.000Z","reason":"class","byNick":true},{"date":"2026-11-04","at":"09:00","reason":"usual"}],"bedtimes":[{"date":"2026-11-02","sleepBy":"23:15","nudgeAt":"22:45","sleepByIso":"2026-11-03T04:15:00.000Z","nudgeAtIso":"2026-11-03T03:45:00.000Z"}]}"#)
        let plan = try XCTUnwrap(SnapshotReader(home: home).wakePlan())
        XCTAssertEqual(plan.alarms.first?.at, "07:15")
        XCTAssertEqual(plan.alarms.count, 1, "an alarm without byNick is dropped")
        XCTAssertEqual(plan.bedtimes.first?.nudgeAt, "22:45")
    }

    func testDefaultMissingOrBrokenPlansAreNil() throws {
        XCTAssertNil(SnapshotReader(home: home).wakePlan())
        try write(#"{"source":"default","alarms":[],"bedtimes":[]}"#)
        XCTAssertNil(SnapshotReader(home: home).wakePlan())
        try write("not json")
        XCTAssertNil(SnapshotReader(home: home).wakePlan())
    }

    func testReachRunsBesideTheInstalledRemote() {
        let runner = CommandRunner(node: URL(fileURLWithPath: "/n/node"), remote: URL(fileURLWithPath: "/r/scripts/orion-remote"), timeout: 5)
        XCTAssertEqual(runner.reachProcessArguments(["hi", "--already-sent", "phone"]), ["/r/scripts/orion-reach", "hi", "--already-sent", "phone"])
    }
}
