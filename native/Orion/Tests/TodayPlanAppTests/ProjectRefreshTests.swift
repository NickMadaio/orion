import XCTest
import Combine
@testable import Orion

final class ProjectRefreshTests: XCTestCase {
    private func project(_ id: String, in home: URL) throws {
        let dir = home.appendingPathComponent(id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let record = #"{"version":1,"id":"\#(id)","name":"Test \#(id)","createdAt":"2026-09-26T10:00:00.000Z","planFile":"plan.md","taskCount":2}"#
        try Data(record.utf8).write(to: dir.appendingPathComponent("project.json"))
    }

    func testFinderMetadataIsNotAnUnreadableProject() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try project("alpha", in: home)
        try Data("junk".utf8).write(to: home.appendingPathComponent(".DS_Store"))
        let result = SavedProject.readAll(at: home)
        XCTAssertEqual(result.projects.map(\.id), ["alpha"])
        XCTAssertNil(result.error)
    }

    func testANewlyAddedProjectAppearsOnTheNextRead() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try project("alpha", in: home)
        let before = SavedProject.readAll(at: home).projects
        try project("beta", in: home)
        let after = SavedProject.readAll(at: home).projects
        XCTAssertNotEqual(before, after)
        XCTAssertEqual(Set(after.map(\.id)), ["alpha", "beta"])
    }

    @MainActor
    func testRefreshNowBumpsBothTheTickAndTheManualCounter() {
        let ticker = RefreshTicker(interval: 3600)
        ticker.refreshNow()
        XCTAssertEqual(ticker.tick, 1)
        XCTAssertEqual(ticker.manual, 1)
    }

    @MainActor
    func testTheTickerFiresOnItsOwnTimer() {
        let ticker = RefreshTicker(interval: 0.05)
        let fired = expectation(description: "ticked")
        fired.assertForOverFulfill = false
        let watch = ticker.$tick.dropFirst().sink { _ in fired.fulfill() }
        wait(for: [fired], timeout: 2)
        watch.cancel()
    }
}
