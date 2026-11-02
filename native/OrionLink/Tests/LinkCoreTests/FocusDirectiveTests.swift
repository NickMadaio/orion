import XCTest
import MobileCore
@testable import LinkCore

/// What the Mac tells the phone to shut, group by group (one group must never widen into every group).
final class FocusDirectiveTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-02T14:00:00Z")!
    private func data(_ text: String) -> Data { Data(text.utf8) }

    func testTheOldBlockShapeStillResolvesToNamesWithNoEnd() {
        let old = data(#"{"at":"2026-11-02T13:59:30Z","until":"2026-11-02T15:00:00Z","block":["feeds","games"],"why":"over"}"#)
        let result = FocusDirective.resolve(auto: old, user: nil, now: now)
        XCTAssertEqual(result?.names, ["feeds", "games"])
        XCTAssertEqual(result?.plan.map(\.until), [nil, nil])
        XCTAssertEqual(result?.plan.first?.why, "over")
    }

    func testAStaleAutoDirectiveIsIgnored() {
        let stale = data(#"{"at":"2026-11-02T13:50:00Z","block":["feeds"]}"#)
        XCTAssertNil(FocusDirective.resolve(auto: stale, user: nil, now: now))
    }

    func testAUserBlockKeepsItsOwnEndWithoutFreshness() {
        let user = data(#"{"at":"2026-11-02T10:00:00Z","lists":[{"name":"browsers","until":"2026-11-02T14:30:00.000Z","why":"revision"},{"name":"video","until":"2026-11-02T13:00:00Z"}]}"#)
        let result = FocusDirective.resolve(auto: nil, user: user, now: now)
        XCTAssertEqual(result?.names, ["browsers"], "an entry past its end is dropped")
        XCTAssertEqual(result?.plan.first?.why, "revision")
        XCTAssertEqual(result?.plan.first?.until, now.addingTimeInterval(30 * 60).timeIntervalSince1970)
    }

    func testAnEmptyUserFileSaysNothingIsHeldSoThePhoneCanLiftIt() {
        let result = FocusDirective.resolve(auto: nil, user: data(#"{"lists":[]}"#), now: now)
        XCTAssertEqual(result?.plan, [])
    }

    func testUnknownNamesAreDroppedNeverWidened() {
        let user = data(#"{"lists":[{"name":"everything","until":"2026-11-02T15:00:00Z"},{"name":"tiktok","until":"2026-11-02T15:00:00Z"}]}"#)
        XCTAssertEqual(FocusDirective.resolve(auto: nil, user: user, now: now)?.plan, [])
    }

    func testAutoAndUserEntriesMergePerGroup() {
        let auto = data(#"{"at":"2026-11-02T13:59:30Z","block":["feeds"],"lists":[{"name":"feeds","why":"22 min of feeds"}]}"#)
        let user = data(#"{"lists":[{"name":"games","until":"2026-11-02T15:00:00Z"}]}"#)
        let result = FocusDirective.resolve(auto: auto, user: user, now: now)
        XCTAssertEqual(result?.names, ["feeds", "games"])
    }

    func testNothingAtAllIsNil() {
        XCTAssertNil(FocusDirective.resolve(auto: nil, user: nil, now: now))
    }
}
