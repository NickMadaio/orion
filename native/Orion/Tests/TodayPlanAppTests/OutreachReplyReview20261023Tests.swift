import XCTest
@testable import Orion

/// Review 2026-10-23 (HIGH 4): the tapped reply id was never cleared, so hours later any message was "the answer" to it.
final class OutreachReplyReview20261023Tests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func row(_ id: String, _ text: String, minutesAgo: Double, why: String? = nil, ask: OutreachAsk? = nil) -> OutreachRow {
        OutreachRow(id: id, text: text, at: now.addingTimeInterval(-minutesAgo * 60), held: false, ask: ask, why: why)
    }
    private let gymAsk = OutreachAsk(askId: "g", type: "mismatch", windowStart: "20:15", windowEnd: "21:45", title: "Gym")

    override func tearDown() { OutreachReplyTo.clear() }

    func testTheTappedIdIsTakenOnceAndLapsesAfterThirtyMinutes() {
        OutreachReplyTo.set("reach-1", now: now)
        XCTAssertEqual(OutreachReplyTo.take(now: now.addingTimeInterval(60)), "reach-1")
        XCTAssertNil(OutreachReplyTo.take(now: now.addingTimeInterval(120)), "used once")
        OutreachReplyTo.set("reach-2", now: now)
        XCTAssertNil(OutreachReplyTo.peek(now: now.addingTimeInterval(31 * 60)), "30-minute TTL")
        OutreachReplyTo.set("reach-3", now: now)
        OutreachReplyTo.clear()
        XCTAssertNil(OutreachReplyTo.peek(now: now), "a new chat clears it")
    }

    func testATappedLineHeSpokeAfterIsNotTheAnswer() {
        let tracker = OutreachTracker()
        let gym = row("gym", "It's been 30 min. Gym, now. Phone down.", minutesAgo: 10, ask: gymAsk)
        _ = tracker.prefix(rows: [], now: now.addingTimeInterval(-5 * 60))   // he said something 5 min ago, after it was sent
        XCTAssertEqual(tracker.prefix(rows: [gym], now: now, replyTo: "gym"), "", "spoken since: not the answer, tapped or not")
    }

    func testANewerBedtimeLineWinsOverTheOlderTappedOne() {
        let gym = row("gym", "It's been 30 min. Gym, now. Phone down.", minutesAgo: 20, ask: gymAsk)
        let bed = row("bed", "It's 12:02 AM, bedtime. Sleep now and you get 8h 58m before your alarm.", minutesAgo: 1, why: "proactive: bed-now")
        let label = OutreachTracker().prefix(rows: [gym, bed], now: now, replyTo: "gym")
        XCTAssertTrue(label.contains("It's 12:02 AM, bedtime"), label)
        // a line that only MENTIONS bedtime is not a bedtime line
        let mention = row("m", "Quick one: what time is bedtime tonight?", minutesAgo: 1, why: "curiosity: blank")
        XCTAssertFalse(mention.isBedtime)
        XCTAssertTrue(OutreachTracker().prefix(rows: [gym, mention], now: now, replyTo: "gym").contains("Gym, now"))
    }
}
