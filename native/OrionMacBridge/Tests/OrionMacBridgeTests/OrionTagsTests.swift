import XCTest
@testable import OrionMacBridge

final class OrionTagsTests: XCTestCase {
    func testWritesKindFirstThenTags() {
        let notes = OrionTags.notes(kind: "gym", tags: OrionTags.parse(payload: "logged,rank-must"))
        XCTAssertTrue(notes.hasSuffix("[orion:gym] [orion:logged] [orion:rank-must]"))
    }

    func testReadsEveryMarkerAndKeepsKindFirst() {
        let notes = OrionTags.notes(kind: "side_project", tags: ["anchor", "rank-high"])
        XCTAssertEqual(OrionTags.markers(in: notes), ["side_project", "anchor", "rank-high"])
        XCTAssertEqual(OrionTags.kind(in: notes), "side_project")
    }

    func testOldNotesWithOneMarkerStillRead() {
        let notes = "Planned by ORION. It may move this block when your day changes. [orion:study]"
        XCTAssertEqual(OrionTags.markers(in: notes), ["study"])
        XCTAssertEqual(OrionTags.kind(in: notes), "study")
        XCTAssertEqual(OrionTags.kind(in: nil), "")
    }

    func testRejectsBadTagsCapsAtFourAndDeduplicates() {
        let tags = OrionTags.parse(payload: "ok, BAD,has space,a,a,b,c,d,e,toolongtagtoolongtagtoolong")
        XCTAssertEqual(tags, ["ok", "a", "b", "c"])
        XCTAssertEqual(OrionTags.parse(payload: nil), [])
    }
}
