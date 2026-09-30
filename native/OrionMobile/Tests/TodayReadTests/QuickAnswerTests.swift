import XCTest
@testable import MobileCore

final class QuickAnswerTests: XCTestCase {
    private let calendar: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; return c }()
    private var now: Date { calendar.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 19, minute: 59))! }

    func testTheClockQuestionsAnswerInstantly() {
        XCTAssertEqual(QuickAnswer.reply(to: "What time is it right now?", now: now, calendar: calendar), "It's 7:59 PM.")
        XCTAssertEqual(QuickAnswer.reply(to: "what's the time", now: now, calendar: calendar), "It's 7:59 PM.")
        XCTAssertEqual(QuickAnswer.reply(to: "Orion, what time is it?", now: now, calendar: calendar), "It's 7:59 PM.")
        XCTAssertNotNil(QuickAnswer.reply(to: "What day is it?", now: now, calendar: calendar))
        XCTAssertEqual(QuickAnswer.reply(to: "And what time is it?", now: now, calendar: calendar), "It's 7:59 PM.")
        XCTAssertEqual(QuickAnswer.reply(to: "Okay so what's the time", now: now, calendar: calendar), "It's 7:59 PM.")
        XCTAssertNotNil(QuickAnswer.reply(to: "What's today's date?", now: now, calendar: calendar))
    }

    func testAnythingMoreStillGoesToOrion() {
        XCTAssertNil(QuickAnswer.reply(to: "what time is my class", now: now, calendar: calendar))
        XCTAssertNil(QuickAnswer.reply(to: "what time should I go to bed", now: now, calendar: calendar))
        XCTAssertNil(QuickAnswer.reply(to: "what's the time in New York", now: now, calendar: calendar))
    }
}
