import XCTest
@testable import ActivityKit

final class PrivacyTests: XCTestCase {
    func testWindowTitlesAreKeptForGamesOnly() {
        XCTAssertEqual(ActivityPrivacy.window(category: .game, title: "Minecraft 1.21"), "Minecraft 1.21")
        for c in [ActivityCategory.browser, .work, .study, .chat, .media, .social, .system, .other] {
            XCTAssertNil(ActivityPrivacy.window(category: c, title: "Re: my medical results - Mail"), "\(c)")
        }
        XCTAssertNil(ActivityPrivacy.window(category: .game, title: ""))
        XCTAssertNil(ActivityPrivacy.window(category: .game, title: nil))
    }

    func testOnlyTheDomainSurvivesAPage() {
        let page = ActivityPrivacy.domain(url: "https://www.youtube.com/watch?v=SECRET&list=x", mode: "normal")
        XCTAssertEqual(page, "youtube.com")
        XCTAssertEqual(ActivityPrivacy.domain(url: "https://docs.google.com/document/d/ID/edit?token=abc", mode: nil), "docs.google.com")
    }

    func testPrivateWindowsHaveNoDomain() {
        XCTAssertNil(ActivityPrivacy.domain(url: "https://www.reddit.com/r/x", mode: "incognito"))
        XCTAssertNil(ActivityPrivacy.domain(url: "https://www.reddit.com/r/x", mode: "Incognito"))
        XCTAssertNil(ActivityPrivacy.domain(url: "https://www.reddit.com/r/x", mode: "private"))
        XCTAssertNil(ActivityPrivacy.domain(url: "https://www.reddit.com/r/x", mode: "true"))
    }
}

/// The main thread must never wait on an app: work that hangs is abandoned at the deadline.
final class TimeoutGateTests: XCTestCase {
    func testCompletesWithTheValueWhenWorkIsFast() {
        let done = expectation(description: "done")
        TimeoutGate.run(timeout: 2, work: { 42 }, completion: { XCTAssertEqual($0, 42); done.fulfill() })
        wait(for: [done], timeout: 3)
    }

    func testCompletesWithNilAtTheDeadlineWhileTheWorkIsStillHung() {
        let done = expectation(description: "timed out")
        let started = Date()
        TimeoutGate.run(timeout: 0.2, work: { Thread.sleep(forTimeInterval: 2); return 1 }, completion: { value in
            XCTAssertNil(value)
            XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
            done.fulfill()
        })
        wait(for: [done], timeout: 1.5)
    }

    func testCompletionRunsOnceAndOnTheMainQueue() {
        let done = expectation(description: "once")
        var calls = 0
        TimeoutGate.run(timeout: 0.1, work: { Thread.sleep(forTimeInterval: 0.3); return 1 }, completion: { _ in
            XCTAssertTrue(Thread.isMainThread); calls += 1
        })
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { XCTAssertEqual(calls, 1); done.fulfill() }
        wait(for: [done], timeout: 2)
    }
}
