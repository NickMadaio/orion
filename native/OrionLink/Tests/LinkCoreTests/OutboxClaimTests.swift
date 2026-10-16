import XCTest
@testable import LinkCore

/// 2026-10-16 audit #6/#12: the outbox is cleared only after a confirmed save.
final class OutboxClaimTests: XCTestCase {
    private var dir: URL!
    private var outbox: URL { dir.appendingPathComponent("alerts-outbox.jsonl") }

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: self.dir) }
    }

    private func write(_ text: String) throws { try text.write(to: outbox, atomically: true, encoding: .utf8) }
    private func content(_ url: URL) -> String { (try? String(contentsOf: url, encoding: .utf8)) ?? "" }

    func testClaimReadsTheItemsAndLeavesTheOutboxFree() throws {
        try write("{\"id\":\"a\",\"text\":\"one\"}\n")
        let claim = try XCTUnwrap(OutboxClaim.claim(outbox))
        XCTAssertEqual(claim.items.count, 1)
        XCTAssertEqual(claim.items.first?["id"] as? String, "a")
        XCTAssertFalse(FileManager.default.fileExists(atPath: outbox.path))   // new writes start a fresh file
    }

    func testAFailedSaveKeepsTheMessagesForTheNextClaim() throws {
        try write("{\"id\":\"a\",\"text\":\"one\"}\n")
        _ = try XCTUnwrap(OutboxClaim.claim(outbox))        // save fails: complete() is never called
        try write("{\"id\":\"b\",\"text\":\"two\"}\n")       // something new arrives meanwhile
        let retry = try XCTUnwrap(OutboxClaim.claim(outbox))
        XCTAssertEqual(retry.items.compactMap { $0["id"] as? String }, ["a", "b"])
    }

    func testCompleteDeletesTheClaimedMessages() throws {
        try write("{\"id\":\"a\",\"text\":\"one\"}\n")
        let claim = try XCTUnwrap(OutboxClaim.claim(outbox))
        claim.complete()
        XCTAssertNil(OutboxClaim.claim(outbox))
        XCTAssertEqual(content(outbox), "")
    }

    func testNothingToClaimWhenEmptyOrMissing() throws {
        XCTAssertNil(OutboxClaim.claim(outbox))
        try write("")
        XCTAssertNil(OutboxClaim.claim(outbox))
    }

    func testRequeueAppendsAlertsThatCameFromElsewhere() throws {
        try OutboxClaim.requeue([["id": "t", "text": "tick", "level": 2]], to: outbox)
        let claim = try XCTUnwrap(OutboxClaim.claim(outbox))
        XCTAssertEqual(claim.items.first?["text"] as? String, "tick")
    }

    func testUrgentOutreachBecomesALevelTwoAlert() {
        XCTAssertEqual(OutboxClaim.alertLevel(urgent: true), 2)
        XCTAssertEqual(OutboxClaim.alertLevel(urgent: false), 1)
        XCTAssertEqual(OutboxClaim.alertLevel(urgent: nil), 1)
        XCTAssertEqual(OutboxClaim.alertLevel(urgent: "yes"), 1)
    }
}
