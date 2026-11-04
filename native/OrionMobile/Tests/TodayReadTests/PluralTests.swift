import XCTest
@testable import MobileCore

final class PluralTests: XCTestCase {
    func testOneIsSingular() {
        XCTAssertEqual(Plural.count(1, "minute"), "1 minute")
        XCTAssertEqual(Plural.count(0, "minute"), "0 minutes")
        XCTAssertEqual(Plural.count(2, "hour"), "2 hours")
        XCTAssertEqual(Plural.count(1, "task"), "1 task")
    }

    func testHomeNextCardSaysOneMinute() {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSince1970: 1_788_948_000)
        let glance = OrionGlance(generatedAt: now, source: "iphone", blocks: [
            .init(id: "b", title: "Essay outline", start: now.addingTimeInterval(60), end: now.addingTimeInterval(3600), kind: "orion", fixed: false)])
        let home = PhoneHomeBuilder.build(.init(now: now, calendar: calendar, name: "Nick", glance: glance, snapshot: nil, messages: []))
        XCTAssertEqual(home.next?.title, "Essay outline starts in 1 minute.")
    }

    func testAnHourIsNotHours() {
        XCTAssertEqual(HealthReadout.lines(.init(date: "2026-11-03", sleepHours: 1.0)), ["You slept 1.0 hour."])
    }
}
