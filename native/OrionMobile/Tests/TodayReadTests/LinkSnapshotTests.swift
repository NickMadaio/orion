import XCTest
@testable import MobileCore

/// The phone ↔ Mac contract: both apps compile against these types.
final class LinkSnapshotTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func sample() -> LinkSnapshot {
        LinkSnapshot(
            generatedAt: now,
            mac: .init(name: "Nick’s MacBook", battery: 81, charging: true, diskFreeGB: 200, uptimeHours: 30,
                       runningApps: ["Orion"], locked: false),
            runs: [.init(id: "p1", project: "Attention", status: .working, live: true, role: "worker",
                         activeTask: "Score items", step: "2/5 · write tests", accepted: 4, total: 30, percent: 13)],
            approvals: [.init(id: "A-7F3K", action: "terminal_run", summary: "terminal_run — command: ls",
                              context: "list files", expiresAt: now.addingTimeInterval(600))],
            running: [.init(id: "orion-0011223344556677", title: "ls", actions: ["terminal_run"], startedAt: now)],
            attention: .init(generatedAt: now, interrupt: [], today: [.init(id: "w1", title: "Still waiting on Prof", source: "waiting", reason: "low_score")], note: nil))
    }

    func testASnapshotRoundTripsThroughItsJSON() throws {
        let data = try LinkSnapshot.encode(sample())
        XCTAssertEqual(try LinkSnapshot.decode(data), sample())
    }

    func testAnUnknownVersionIsRefusedRatherThanMisread() throws {
        var snapshot = sample(); snapshot.version = 2
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        XCTAssertThrowsError(try LinkSnapshot.decode(try encoder.encode(snapshot))) { error in
            XCTAssertEqual(error as? LinkError, .unsupportedVersion(2))
        }
    }

    func testPresenceComesFromWhenTheMacLastPublished() {
        let snapshot = sample()
        XCTAssertEqual(snapshot.presence(at: now.addingTimeInterval(20)), .online)
        XCTAssertEqual(snapshot.presence(at: now.addingTimeInterval(150)), .stale)
        XCTAssertEqual(snapshot.presence(at: now.addingTimeInterval(400)), .offline)
        XCTAssertEqual(snapshot.presence(at: now.addingTimeInterval(-60)), .unknown, "a snapshot from the future is a clock problem, not health")
    }

    func testCommandsAreSpelledInOrionRemotesGrammar() throws {
        XCTAssertEqual(LinkCommand.approve("A-7F3K"), "approve A-7F3K")
        XCTAssertEqual(LinkCommand.agent(.stop, project: "p1"), "agent stop p1")
        XCTAssertEqual(LinkCommand.cancelAction("orion-0011223344556677"), "action cancel orion-0011223344556677")
        XCTAssertEqual(try LinkCommand.validate("  device\n"), "device")
        XCTAssertThrowsError(try LinkCommand.validate("   "))
        XCTAssertThrowsError(try LinkCommand.validate(String(repeating: "x", count: 2001)))
        XCTAssertNoThrow(try LinkCommand.validate(String(repeating: "x", count: 1500)), "a real question fits")
        XCTAssertEqual(try LinkCommand.validate("a\u{0007}b"), "a b")
    }

    func testTrackingEntriesRoundTripAsJSONAndAreBounded() throws {
        let meal = LinkLog.meal(title: " Chicken bowl ", meal: "Lunch", calories: 650, protein: 45, carbohydrates: 60, fat: 20)
        XCTAssertEqual(try LinkLog.decode(try meal.encoded()),
                       .meal(title: "Chicken bowl", meal: "Lunch", calories: 650, protein: 45, carbohydrates: 60, fat: 20))
        XCTAssertEqual(try LinkLog.decode(try LinkLog.water(delta: 1).encoded()), .water(delta: 1))
        XCTAssertThrowsError(try LinkLog.water(delta: 0).validated())
        XCTAssertThrowsError(try LinkLog.water(delta: 9).validated())
        XCTAssertThrowsError(try LinkLog.meal(title: "x", meal: "Lunch", calories: -1, protein: 0, carbohydrates: 0, fat: 0).validated())
        XCTAssertThrowsError(try LinkLog.supplement(id: "../etc", taken: true).validated(), "ids are ids, not paths")
        XCTAssertEqual(try LinkLog.meal(title: "x", meal: "Brunch?", calories: 1, protein: 0, carbohydrates: 0, fat: 0).validated(),
                       .meal(title: "x", meal: "Other", calories: 1, protein: 0, carbohydrates: 0, fat: 0))
        XCTAssertThrowsError(try LinkLog.decode("{\"approve\":{}}"), "only the four entry kinds decode")
    }

    func testASnapshotWithoutTheNewFieldsStillDecodes() throws {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: try encoder.encode(sample())) as? [String: Any])
        object["tracking"] = nil; object["plan"] = nil; object["planRequest"] = nil
        XCTAssertNoThrow(try LinkSnapshot.decode(try JSONSerialization.data(withJSONObject: object)))
    }
}
