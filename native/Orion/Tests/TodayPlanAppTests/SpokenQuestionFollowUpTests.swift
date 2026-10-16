import XCTest
@testable import Orion

final class SpokenQuestionFollowUpTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let q = "Sure, what would you like to add before your first class?"

    func testQuestionDetectionIgnoresQuotesAndEmoji() {
        XCTAssertTrue(SpokenQuestionFollowUp.isQuestion("Ready? \u{1F642}"))
        XCTAssertTrue(SpokenQuestionFollowUp.isQuestion("He said \"go?\""))
        XCTAssertFalse(SpokenQuestionFollowUp.isQuestion("Done."))
    }

    func testAtTheMacRepeatsAloudOnceAtTwentySeconds() {
        var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0)
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(19), idle: 3, locked: false), .none)
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(20), idle: 3, locked: false), .repeatAloud(q))
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(60), idle: 3, locked: false), .none)
    }

    /// Review 8: keyboard/mouse idle is not "away" (hands-free voice chat); locked, display asleep or not home is.
    func testOnlyReallyAwayGoesToThePhoneAndOnlyOnce() {
        let away: [(locked: Bool, asleep: Bool, home: Bool?)] = [(true, false, nil), (false, true, nil), (false, false, false)]
        for a in away {
            var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0)
            XCTAssertEqual(p.tick(now: t0.addingTimeInterval(21), idle: 3, locked: a.locked, displayAsleep: a.asleep, atHome: a.home), .sendToPhone(q))
            XCTAssertEqual(p.tick(now: t0.addingTimeInterval(80), idle: 3, locked: a.locked, displayAsleep: a.asleep, atHome: a.home), .none)
        }
        for idle in [300.0, 3600.0, nil] as [TimeInterval?] {
            var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0)
            XCTAssertEqual(p.tick(now: t0.addingTimeInterval(21), idle: idle, locked: false, displayAsleep: false, atHome: true), .repeatAloud(q), "idle \(String(describing: idle)) at home")
        }
        var unknown = SpokenQuestionFollowUp(); unknown.arm(text: q, at: t0)
        XCTAssertEqual(unknown.tick(now: t0.addingTimeInterval(21), idle: 900, locked: false), .repeatAloud(q), "home unknown is not away")
    }

    func testOnlyAQuestionWhoseAnswerIsNeededIsArmed() {
        for yes in ["Sure, what would you like to add before your first class?", "Which one do you mean?", "What time should I put it?", "Do you want me to move gym?"] {
            XCTAssertTrue(SpokenQuestionFollowUp.needsAnswer(yes), yes)
        }
        for no in ["Done. Anything else?", "That moved it. Does that help?", "Makes sense, right?", "It's 3 PM.", "How are you doing today?", "Okay?"] {
            XCTAssertFalse(SpokenQuestionFollowUp.needsAnswer(no), no)
        }
    }

    func testAwarenessSaysWhetherHeIsHomeAndStaleOrUnknownIsNil() {
        let now = ISO8601DateFormatter().date(from: "2026-10-16T14:00:00Z")!
        func json(_ state: String, _ at: String, source: String = "sample", place: String? = nil) -> Data {
            Data(#"{"location":{"state":"\#(state)","at":"\#(at)","source":"\#(source)","placeId":\#(place.map { "\"" + $0 + "\"" } ?? "null")}}"#.utf8)
        }
        XCTAssertEqual(AwarenessHome.atHome(from: json("home", "2026-10-16T13:55:00Z"), now: now), true)
        XCTAssertEqual(AwarenessHome.atHome(from: json("elsewhere", "2026-10-16T13:55:00Z"), now: now), false)
        XCTAssertNil(AwarenessHome.atHome(from: json("home", "2026-10-16T12:00:00Z"), now: now), "a sample is good for 20 min")
        XCTAssertEqual(AwarenessHome.atHome(from: json("home", "2026-10-16T08:00:00Z", source: "region"), now: now), true, "a region fix for 12 h")
        XCTAssertNil(AwarenessHome.atHome(from: json("unknown", "2026-10-16T13:59:00Z"), now: now))
        XCTAssertNil(AwarenessHome.atHome(from: Data("{}".utf8), now: now))
    }

    func testAnAnswerDisarms() {
        var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0)
        p.answered()
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(30), idle: 1, locked: false), .none)
    }

    func testTheRepeatItselfDoesNotArmAnotherRound() {
        var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0)
        _ = p.tick(now: t0.addingTimeInterval(20), idle: 1, locked: false)
        p.arm(text: "Nick? " + q, at: t0.addingTimeInterval(21))
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(90), idle: 1, locked: false), .none)
        p.arm(text: "A different question?", at: t0.addingTimeInterval(100))
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(121), idle: 1, locked: false), .repeatAloud("A different question?"))
    }

    func testTheClockRunsFromWhenSpeechEnded() {
        var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0)
        p.speechEnded(at: t0.addingTimeInterval(8))
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(20), idle: 1, locked: false), .none)
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(28), idle: 1, locked: false), .repeatAloud(q))
    }

    // MARK: Driver, with an injected scheduler and clock

    private final class Fake: QuestionScheduler {
        var pending: [(after: TimeInterval, fire: () -> Void, id: Int)] = []
        var cancelled = Set<Int>(); private var next = 0
        func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> () -> Void {
            next += 1; let id = next
            pending.append((seconds, fire, id))
            return { [self] in cancelled.insert(id) }
        }
        /// Fire whatever is live, like the timer would.
        func fireLive() { let live = pending.filter { !cancelled.contains($0.id) }; pending = []; live.forEach { $0.fire() } }
    }

    private func driver(_ f: Fake, clock: @escaping () -> Date, idle: TimeInterval?, home: Bool? = nil, busy: @escaping () -> Bool = { false },
                        aloud: @escaping (String) -> Void, phone: @escaping (String) -> Void) -> SpokenQuestionDriver {
        SpokenQuestionDriver(scheduler: f, now: clock, idle: { idle }, locked: { false }, atHome: { home }, busy: busy, onRepeatAloud: aloud, onSendToPhone: phone)
    }

    func testDriverRepeatsAloudOnceWithNickPrefixAndNeverTwice() {
        let f = Fake(); var now = t0; var spoken: [String] = []; var phone: [String] = []
        let d = driver(f, clock: { now }, idle: 2, aloud: { spoken.append($0) }, phone: { phone.append($0) })
        d.arm(text: q)
        XCTAssertEqual(f.pending.last?.after, 20)
        now = t0.addingTimeInterval(20); f.fireLive()
        XCTAssertEqual(spoken, ["Nick? " + q]); XCTAssertTrue(phone.isEmpty)
        d.arm(text: "Nick? " + q)           // the repeat is spoken, which would re-arm
        now = t0.addingTimeInterval(60); f.fireLive()
        XCTAssertEqual(spoken.count, 1)
    }

    func testDriverSendsToThePhoneOnlyWhenReallyAway() {
        let f = Fake(); var now = t0; var spoken: [String] = []; var phone: [String] = []
        let d = driver(f, clock: { now }, idle: 2, home: false, aloud: { spoken.append($0) }, phone: { phone.append($0) })
        d.arm(text: q)
        now = t0.addingTimeInterval(20); f.fireLive()
        XCTAssertEqual(phone, [q]); XCTAssertTrue(spoken.isEmpty)
    }

    func testDriverKeepsAskingAloudWhenHeIsIdleAtTheMacHandsFree() {
        let f = Fake(); var now = t0; var spoken: [String] = []; var phone: [String] = []
        let d = driver(f, clock: { now }, idle: 300, aloud: { spoken.append($0) }, phone: { phone.append($0) })
        d.arm(text: q)
        now = t0.addingTimeInterval(20); f.fireLive()
        XCTAssertEqual(spoken, ["Nick? " + q]); XCTAssertTrue(phone.isEmpty)
    }

    func testDriverAnswerCancelsTheTimer() {
        let f = Fake(); var now = t0; var count = 0
        let d = driver(f, clock: { now }, idle: 2, aloud: { _ in count += 1 }, phone: { _ in count += 1 })
        d.arm(text: q); d.answered()
        now = t0.addingTimeInterval(25); f.fireLive()
        XCTAssertEqual(count, 0)
    }

    func testDriverWaitsWhileHeIsMidSentence() {
        let f = Fake(); var now = t0; var spoken: [String] = []; var busy = true
        let d = driver(f, clock: { now }, idle: 2, busy: { busy }, aloud: { spoken.append($0) }, phone: { _ in })
        d.arm(text: q)
        now = t0.addingTimeInterval(20); f.fireLive()
        XCTAssertTrue(spoken.isEmpty)
        XCTAssertEqual(f.pending.last?.after, SpokenQuestionDriver.busyRetry)
        busy = false; now = t0.addingTimeInterval(23); f.fireLive()
        XCTAssertEqual(spoken.count, 1)
    }

    func testPhoneCommandIsByNameAndMissingBinarySafe() {
        let cmd = SpokenQuestionDriver.phoneCommand(text: q, node: "/n", scriptsDir: "/s", exists: { _ in true })
        XCTAssertEqual(cmd?.arguments.first, "/s/orion-reach")
        XCTAssertTrue(cmd!.arguments.contains("--no-queue"))
        XCTAssertEqual(cmd!.arguments[cmd!.arguments.firstIndex(of: "--channel")! + 1], "phone")
        XCTAssertEqual(cmd!.arguments[cmd!.arguments.firstIndex(of: "--ask")! + 1], "{\"type\":\"voice-repeat\"}")
        XCTAssertNil(SpokenQuestionDriver.phoneCommand(text: q, node: "/n", scriptsDir: "/s", exists: { $0 != "/s/orion-reach" }))
    }
}
