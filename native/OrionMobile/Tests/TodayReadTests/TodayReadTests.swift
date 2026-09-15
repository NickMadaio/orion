import XCTest
@testable import MobileCore

final class TodayReadTests: XCTestCase {
    func plan(at now: Date) throws -> TodayPlan {
        try TodayPlanScheduler.propose(now: now, timeZone: "Europe/London", preferences: .init(), tasks: [], commitments: [], reason: "Read fixture", sourceFingerprint: "test")
    }
    func testFreshnessUsesPlanEvidenceAndExpires() throws {
        let now = Date(timeIntervalSince1970: 1_789_555_200)
        let snapshot = try TodayReadSnapshot(revision: 1, capturedAt: now.timeIntervalSince1970, plan: plan(at: now))
        XCTAssertTrue(snapshot.isCurrent(at: now))
        XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(301)))
        XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(-1)))
        let reexport = try TodayReadSnapshot(revision: 1, capturedAt: now.timeIntervalSince1970 + 400, plan: snapshot.plan)
        XCTAssertFalse(reexport.isCurrent(at: now.addingTimeInterval(400)))
    }
    func testRepeatedRollbackAndEquivocationRemainRefused() throws {
        var history = TodayReadHistory()
        let good = try TodayReadSnapshot(revision: 8, capturedAt: 100, plan: nil)
        try history.receive(good)
        for invalid in [try TodayReadSnapshot(revision: 7, capturedAt: 100, plan: nil),
                        try TodayReadSnapshot(revision: 8, capturedAt: 101, plan: nil)] {
            for _ in 0..<2 {
                XCTAssertThrowsError(try history.receive(invalid))
                XCTAssertNil(history.reading)
            }
        }
        try history.receive(good)
        XCTAssertEqual(history.reading, good)
        history.clear()
        XCTAssertNil(history.reading)
    }
    func testExplicitEmptyPlanRoundTrip() throws {
        let empty = try TodayReadSnapshot(revision: 0, capturedAt: 0, plan: nil)
        let data = try JSONEncoder().encode(empty)
        let value = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertTrue(value["plan"] is NSNull)
        XCTAssertEqual(try JSONDecoder().decode(TodayReadSnapshot.self, from: data), empty)
        XCTAssertThrowsError(try JSONDecoder().decode(TodayReadSnapshot.self, from: Data("{\"revision\":0,\"capturedAt\":0}".utf8)))
    }
    func testWireOwnershipVersionBoundsAndValidation() throws {
        let now = Date()
        let snapshot = try TodayReadSnapshot(revision: 8, capturedAt: now.timeIntervalSince1970, plan: plan(at: now))
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot))
        func wire(owner: String = "owner-one", version: Int = 1, body: Any? = nil) throws -> Data {
            try JSONSerialization.data(withJSONObject: ["schemaVersion": version, "ownerID": owner, "snapshot": body ?? object])
        }
        XCTAssertEqual(try TodayReadSnapshot.decodeResponse(wire(), expectedOwner: "owner-one"), snapshot)
        XCTAssertThrowsError(try TodayReadSnapshot.decodeResponse(wire(owner: "owner-two"), expectedOwner: "owner-one"))
        XCTAssertThrowsError(try TodayReadSnapshot.decodeResponse(wire(version: 2), expectedOwner: "owner-one"))
        XCTAssertThrowsError(try TodayReadSnapshot.decodeResponse(wire(body: ["revision": -1, "capturedAt": 0, "plan": NSNull()]), expectedOwner: "owner-one"))
        XCTAssertThrowsError(try TodayReadSnapshot.decodeResponse(Data(repeating: 32, count: 1_100_001), expectedOwner: "owner-one"))
        var broken = object as! [String: Any]
        var badPlan = broken["plan"] as! [String: Any]; badPlan["timeZone"] = "invalid"
        broken["plan"] = badPlan
        XCTAssertThrowsError(try TodayReadSnapshot.decodeResponse(wire(body: broken), expectedOwner: "owner-one"))
    }
}
