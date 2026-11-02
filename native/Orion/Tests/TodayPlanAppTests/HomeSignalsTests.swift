import XCTest
@testable import Orion

/// Wave 12 U4: reading the files the new Home draws on, the status capsule, and the card spread's geometry.
@MainActor
final class HomeSignalsTests: XCTestCase {
    private let zone = TimeZone(identifier: "Europe/London")!
    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = zone; return c }
    private func at(_ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: 1, hour: hour, minute: minute))!
    }

    // MARK: Pending question

    private let outreach = """
    {"id":"reach-a","at":"2026-11-01T20:48:17.387Z","text":"Gym didn't happen. Want 22 min tonight?","channel":"mac-bubble","ask":{"type":"mismatch","title":"Gym"}}
    {"id":"reach-b","at":"2026-11-01T20:48:19.851Z","text":"Quick one - what was 1:11 to 3:11?","channel":"mac-bubble","ask":{"type":"fill-blank","askId":"ask-1"}}
    {"id":"reach-c","at":"2026-11-01T20:50:00.000Z","text":"Leave in 13 min.","channel":"mac-bubble"}
    """

    func testLatestUnansweredAskIsThePendingQuestion() {
        let question = HomeSignalsReader.pendingQuestion(outreach: outreach, inboundTurns: "", now: at(21))
        XCTAssertEqual(question?.id, "reach-b")
        XCTAssertEqual(question?.text, "Quick one - what was 1:11 to 3:11?")
    }

    func testAQuestionHeAnsweredOrThatIsStaleIsNotPending() {
        let answered = #"{"at":"2026-11-01T20:55:00.000Z"}"#
        XCTAssertNil(HomeSignalsReader.pendingQuestion(outreach: outreach, inboundTurns: answered, now: at(21)))
        XCTAssertNil(HomeSignalsReader.pendingQuestion(outreach: outreach, inboundTurns: "", now: at(23, 59)))
        XCTAssertNil(HomeSignalsReader.pendingQuestion(outreach: "not json\n", inboundTurns: "", now: at(21)))
    }

    func testHeldAsksAreNotPending() {
        let held = #"{"id":"h","at":"2026-11-01T20:48:17.387Z","text":"Held?","channel":"hold","ask":{"type":"blank"}}"#
        XCTAssertNil(HomeSignalsReader.pendingQuestion(outreach: held, inboundTurns: "", now: at(21)))
    }

    // MARK: Knowledge

    func testKnowledgeCountsFactsAndFindsTheSelfName() {
        let graph = Data("""
        {"nodes":[{"id":"person:self","type":"person","label":"Nick","facts":[{"text":"a"},{"text":"b"}]},
                  {"id":"course:cs","type":"course","label":"CS2100","facts":[{"text":"c"}]},
                  {"id":"place:x","type":"place","label":"Gym"}]}
        """.utf8)
        let summary = HomeSignalsReader.knowledge(graph)
        XCTAssertEqual(summary?.factCount, 3)
        XCTAssertEqual(summary?.selfName, "Nick")
        XCTAssertNil(HomeSignalsReader.knowledge(Data("{}".utf8)))
        XCTAssertNil(HomeSignalsReader.knowledge(Data("garbage".utf8)))
    }

    // MARK: Leave by

    func testLeaveByIsReadFromTodaysMorningViewOnly() {
        let today = Data(#"{"generatedAt":"2026-11-01T07:43:00.972Z","leaveBy":"2:45"}"#.utf8)
        XCTAssertEqual(HomeSignalsReader.leaveBy(morningView: today, now: at(9), calendar: calendar), at(14, 45))
        XCTAssertEqual(HomeSignalsReader.leaveBy(morningView: Data(#"{"generatedAt":"2026-11-01T07:43:00.972Z","leaveBy":"8:15"}"#.utf8),
                                                 now: at(7, 50), calendar: calendar), at(8, 15))
        let yesterday = Data(#"{"generatedAt":"2026-10-31T07:43:00.972Z","leaveBy":"2:45"}"#.utf8)
        XCTAssertNil(HomeSignalsReader.leaveBy(morningView: yesterday, now: at(9), calendar: calendar))
        let none = Data(#"{"generatedAt":"2026-11-01T07:43:00.972Z","leaveBy":null}"#.utf8)
        XCTAssertNil(HomeSignalsReader.leaveBy(morningView: none, now: at(9), calendar: calendar))
    }

    // MARK: Status capsule

    func testStatusCapsuleOnlyWhenSomethingIsWrong() {
        XCTAssertEqual(HomeStatus.issues(gatewayUp: true, overdue: 0, phoneLinkAlive: true), [])
        XCTAssertEqual(HomeStatus.issues(gatewayUp: true, overdue: 0, phoneLinkAlive: nil), [], "no link set up is not a fault")
        XCTAssertEqual(HomeStatus.issues(gatewayUp: false, overdue: 3, phoneLinkAlive: false),
                       [HomeStatus.Issue(text: "GATEWAY DOWN", severe: true), HomeStatus.Issue(text: "3 OVERDUE", severe: false),
                        HomeStatus.Issue(text: "PHONE LINK OFFLINE", severe: false)])
    }

    // MARK: Spread geometry

    func testSpreadIsDeterministicTiltedAndNeverAnEqualGrid() {
        let slots = HomeSpreadGeometry.slots(count: 6, columns: 3)
        XCTAssertEqual(slots, HomeSpreadGeometry.slots(count: 6, columns: 3))
        XCTAssertTrue(slots.allSatisfy { abs($0.rotation) <= 1.5 })
        XCTAssertGreaterThan(Set(slots.map(\.widthFactor)).count, 1, "card widths must vary")
        XCTAssertGreaterThan(Set(slots.map(\.rotation)).count, 3)
        XCTAssertEqual(slots.map(\.row), [0, 0, 0, 1, 1, 1])
        XCTAssertEqual(HomeSpreadGeometry.columns(count: 4, width: 1400), 2, "four cards sit two over two")
        XCTAssertEqual(HomeSpreadGeometry.columns(count: 5, width: 1400), 3)
        XCTAssertEqual(HomeSpreadGeometry.columns(count: 5, width: 900), 2)
        XCTAssertEqual(HomeSpreadGeometry.columns(count: 1, width: 1400), 1)
    }
}
