import XCTest
@testable import Orion

final class OutreachContextAskTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func row(_ id: String, minutesAgo: Double, ask: OutreachAsk? = nil) -> OutreachRow {
        OutreachRow(id: id, text: "What are you up to? I'll log it.", at: now.addingTimeInterval(-minutesAgo * 60), held: false, ask: ask)
    }
    private let blank = OutreachAsk(askId: "a1", type: "blank", windowStart: "14:00", windowEnd: nil, place: "away")

    func testAskRowsParseAndAskWindowIsNinetyMinutes() {
        let jsonl = #"{"id":"r1","text":"Where are you?","at":"2026-10-16T14:00:00Z","channel":"phone","why":"blank","ask":{"askId":"a1","type":"blank","window":{"date":"2026-10-16","start":"14:00","end":null},"place":"away"}}"#
        let rows = OutreachContext.parse(jsonl: jsonl)
        XCTAssertEqual(rows.first?.ask, blank)
        XCTAssertEqual(rows.first?.why, "blank")
        let tracker = OutreachTracker()
        XCTAssertFalse(tracker.prefix(rows: [row("r1", minutesAgo: 80, ask: blank)], now: now).isEmpty)
        XCTAssertEqual(OutreachTracker().prefix(rows: [row("r2", minutesAgo: 80)], now: now), "", "no ask: 25 min only")
        XCTAssertEqual(OutreachTracker().prefix(rows: [row("r3", minutesAgo: 95, ask: blank)], now: now), "")
    }

    func testMinutesWindowsRenderAsClockTimes() {
        let ask = OutreachContext.parseAsk(["type": "blank", "window": ["start": 840, "end": 960]])
        XCTAssertEqual(ask?.windowStart, "14:00"); XCTAssertEqual(ask?.windowEnd, "16:00")
    }

    func testTheLabelNamesTheAsk() {
        let label = OutreachContext.label(for: row("r1", minutesAgo: 38, ask: blank), now: now)
        XCTAssertTrue(label.contains("38 min ago you asked"))
        XCTAssertTrue(label.contains("blank ask about 14:00-now, he is away"))
        XCTAssertTrue(label.contains("log it"))
        let mismatch = OutreachAsk(askId: "a2", type: "mismatch", windowStart: "14:00", windowEnd: "16:00", title: "finish resume")
        XCTAssertTrue(OutreachContext.label(for: row("r2", minutesAgo: 5, ask: mismatch), now: now).contains("finish resume, planned 14:00-16:00, not started"))
    }

    func testAnExplicitReplyToBeatsTheLatestRowAndIsUsedOnce() {
        let tracker = OutreachTracker()
        let older = row("old", minutesAgo: 30, ask: blank)
        let newer = row("new", minutesAgo: 2)
        let first = tracker.prefix(rows: [older, newer], now: now, replyTo: "old")
        XCTAssertTrue(first.contains("30 min ago"))
        XCTAssertEqual(tracker.prefix(rows: [older, newer], now: now, replyTo: "old"), "", "only once")
    }

    func testReplyToOutsideItsWindowOrUnknownFallsBack() {
        XCTAssertEqual(OutreachTracker().prefix(rows: [row("x", minutesAgo: 100, ask: blank)], now: now, replyTo: "x"), "")
        XCTAssertTrue(OutreachTracker().prefix(rows: [row("y", minutesAgo: 3)], now: now, replyTo: "nope").contains("3 min ago"))
    }
}

/// Review 7: the asks the loop really sends (type home-gap / mismatch with a block title and minute windows) read as one contract.
final class OutreachAskContractTests: XCTestCase {
    func testTheRealPayloadsOfOrionProactiveAndOrionCheckin() {
        let jsonl = [
            #"{"id":"r1","text":"Nothing planned till 4 - what are you up to?","at":"2026-10-16T14:00:00Z","channel":"phone","ask":{"askId":"ask-1","type":"home-gap","kind":"blank","window":{"date":"2026-10-16","start":840,"end":null},"place":"home","cell":null}}"#,
            #"{"id":"r2","text":"Time to start: finish resume.","at":"2026-10-16T14:05:00Z","channel":"phone","ask":{"type":"mismatch","kind":"mismatch","blockId":"cal-3-resume","title":"finish resume","window":{"date":"2026-10-16","start":840,"end":960},"level":1}}"#,
            #"{"id":"r3","text":"older row","at":"2026-10-16T14:06:00Z","ask":{"type":"fill-blank","window":{"date":"2026-10-16","start":780,"end":900}}}"#,
        ].joined(separator: "\n")
        let rows = OutreachContext.parse(jsonl: jsonl)
        let now = ISO8601DateFormatter().date(from: "2026-10-16T14:10:00Z")!
        XCTAssertTrue(OutreachContext.label(for: rows[0], now: now).contains("(blank ask about 14:00-now, he is home)"))
        XCTAssertTrue(OutreachContext.label(for: rows[1], now: now).contains("(finish resume, planned 14:00-16:00, not started)"))
        XCTAssertTrue(OutreachContext.label(for: rows[2], now: now).contains("(blank ask about 13:00-15:00)"), "a row without kind still maps from its type")
    }
}
