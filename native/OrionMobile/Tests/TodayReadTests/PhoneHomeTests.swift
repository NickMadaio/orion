import XCTest
@testable import MobileCore

/// The phone Home: the Mac's snapshot, the phone's glance and the thread folded into a few cards.
final class PhoneHomeTests: XCTestCase {
    private let calendar: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; return c }()
    private func at(_ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: 2, hour: hour, minute: minute))!
    }
    private var now: Date { at(19, 10) }

    private func block(_ id: String, _ title: String, _ start: Date, _ end: Date, kind: String = "event", fixed: Bool = true,
                       location: String? = nil) -> OrionGlance.Block {
        .init(id: id, title: title, start: start, end: end, kind: kind, fixed: fixed, location: location)
    }

    private func snapshot(approvals: [LinkSnapshot.Approval] = [], early: EarlyFinishContext? = nil,
                          tracking: LinkSnapshot.Tracking? = nil, health: [LinkSnapshot.HealthDay]? = nil,
                          age: TimeInterval = 20) -> LinkSnapshot {
        LinkSnapshot(generatedAt: now.addingTimeInterval(-age), mac: .init(name: "Mac"), approvals: approvals,
                     health: health, tracking: tracking, earlyFinish: early)
    }

    private func build(glance: OrionGlance? = nil, snapshot: LinkSnapshot? = nil, messages: [PhoneHomeMessage] = [],
                       water: Int? = nil, lockedUntil: Date? = nil) -> PhoneHome {
        PhoneHomeBuilder.build(.init(now: now, calendar: calendar, name: "Nick", glance: glance, snapshot: snapshot,
                                     messages: messages, water: water, phoneLockedUntil: lockedUntil))
    }

    // MARK: Greeting

    func testGreetsByNameAndCountsWhatNeedsHim() {
        let approval = LinkSnapshot.Approval(id: "A-1", action: "terminal_run", summary: "terminal_run: ls", context: "List the folders",
                                             expiresAt: now.addingTimeInterval(600))
        let ask = PhoneHomeMessage(id: "m1", askID: "ask-1", mine: "", orion: "gym tonight or tomorrow?", sentAt: now.addingTimeInterval(-300))
        let home = build(snapshot: snapshot(approvals: [approval]), messages: [ask])
        XCTAssertEqual(home.greeting, "Good evening, Nick.")
        XCTAssertEqual(home.subline, "2 THINGS NEED YOU")
    }

    func testAQuietDaySublineIsTheDate() {
        let home = build(glance: OrionGlance(generatedAt: now, source: "iphone"))
        XCTAssertEqual(home.subline, "MONDAY 2 NOVEMBER")
        XCTAssertEqual(PhoneHomeBuilder.greeting(at: at(2), calendar: calendar, name: nil), "Up late.")
        XCTAssertEqual(PhoneHomeBuilder.greeting(at: at(8), calendar: calendar, name: "Nick"), "Good morning, Nick.")
    }

    // MARK: What's next

    func testNextNamesTheNextBlockWithWhatIsOnNow() {
        let glance = OrionGlance(generatedAt: now, source: "iphone", blocks: [
            block("b1", "Essay outline", at(18, 30), at(19, 30), kind: "orion", fixed: false),
            block("b2", "CS2100 Lab", at(19, 40), at(21), kind: "class", location: "Room 4.02"),
            block("b3", "Gym", at(21, 30), at(22, 30)),
        ])
        let next = try! XCTUnwrap(build(glance: glance).next)
        XCTAssertEqual(next.kicker, ["IN 30 MIN", "CS2100", "ROOM 4.02"])
        XCTAssertEqual(next.title, "CS2100 Lab starts in 30 minutes.")
        XCTAssertEqual(next.now, "Now: Essay outline, until 7:30 PM.")
        XCTAssertEqual(next.after, "Then Gym at 9:30 PM.")
    }

    func testOnlySomethingOnNow() {
        let glance = OrionGlance(generatedAt: now, source: "iphone", blocks: [block("b1", "Seminar", at(19), at(20, 30), kind: "class")])
        let next = try! XCTUnwrap(build(glance: glance).next)
        XCTAssertEqual(next.kicker, ["NOW", "SEMINAR"])
        XCTAssertEqual(next.title, "You're in Seminar until 8:30 PM.")
        XCTAssertNil(next.now)
        XCTAssertEqual(next.after, "Nothing else after that today.")
    }

    func testAFarOffBlockShowsItsTime() {
        let glance = OrionGlance(generatedAt: now, source: "iphone", blocks: [block("b1", "Dinner with Sam", at(23), at(23, 45))])
        let next = try! XCTUnwrap(build(glance: glance).next)
        XCTAssertEqual(next.kicker.first, "AT 11:00 PM")
        XCTAssertEqual(next.title, "Dinner with Sam is at 11:00 PM.")
    }

    func testAnEmptyDaySaysSoAndPointsAtTomorrow() {
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: at(9))!
        let glance = OrionGlance(generatedAt: now, source: "iphone",
                                 tomorrow: [block("t1", "ECON1001 Lecture", tomorrow, tomorrow.addingTimeInterval(3600))])
        let next = try! XCTUnwrap(build(glance: glance).next)
        XCTAssertEqual(next.kicker, ["WHAT'S NEXT"])
        XCTAssertEqual(next.title, "Nothing else on today.")
        XCTAssertEqual(next.after, "Tomorrow starts with ECON1001 Lecture at 9:00 AM.")
    }

    func testNoDayAtAllIsNoCard() {
        XCTAssertNil(build().next)
    }

    // MARK: From ORION

    func testTheAskIsTheMessageAReplyWouldAnswer() {
        let old = PhoneHomeMessage(id: "m0", askID: "ask-0", mine: "", orion: "Morning. Plans?", sentAt: now.addingTimeInterval(-3 * 3600))
        let answered = PhoneHomeMessage(id: "m1", askID: "ask-1", mine: "", orion: "Want the essay first?", sentAt: now.addingTimeInterval(-1800))
        let reply = PhoneHomeMessage(id: "m2", askID: nil, mine: "ya essay first", orion: "Done.", sentAt: now.addingTimeInterval(-1700))
        let open = PhoneHomeMessage(id: "m3", askID: "ask-2", mine: "", orion: "Seminar's in 20. Move the Hale reply to tonight?",
                                    sentAt: now.addingTimeInterval(-120))
        let ask = try! XCTUnwrap(build(messages: [old, answered, reply, open]).ask)
        XCTAssertEqual(ask.id, "ask-2")
        XCTAssertEqual(ask.text, "Seminar's in 20. Move the Hale reply to tonight?")
        XCTAssertEqual(ask.kicker, ["ORION ASKED", "2 MIN AGO"])
        XCTAssertEqual(ask.options, ["Yes", "No"])
    }

    func testAnAnsweredOrStaleAskIsGone() {
        let answered = PhoneHomeMessage(id: "m1", askID: "ask-1", mine: "", orion: "Gym or library?", sentAt: now.addingTimeInterval(-600))
        let reply = PhoneHomeMessage(id: "m2", askID: nil, mine: "library", orion: nil, sentAt: now.addingTimeInterval(-500))
        XCTAssertNil(build(messages: [answered, reply]).ask)
        let stale = PhoneHomeMessage(id: "m3", askID: "ask-3", mine: "", orion: "Still on?", sentAt: now.addingTimeInterval(-4 * 3600))
        XCTAssertNil(build(messages: [stale]).ask)
    }

    func testQuickAnswersOnlyWhenTheQuestionOffersThem() {
        XCTAssertEqual(AskOptions.from("gym, library or nothing?"), ["Gym", "Library", "Nothing"])
        XCTAssertEqual(AskOptions.from("You've got a free hour. Gym or library?"), ["Gym", "Library"])
        XCTAssertEqual(AskOptions.from("Do you want me to move it to tonight?"), ["Yes", "No"])
        XCTAssertEqual(AskOptions.from("should i push the essay to 9"), [])
        XCTAssertEqual(AskOptions.from("Should I push the essay to 9?"), ["Yes", "No"])
        XCTAssertEqual(AskOptions.from("What are you planning to get done before the seminar?"), [])
        XCTAssertEqual(AskOptions.from("Heads up: seminar in 20 minutes."), [])
        XCTAssertEqual(AskOptions.from("Do you want to move the reply to this evening or leave it for tomorrow morning?"), ["Yes", "No"])
    }

    // MARK: Approvals

    func testLiveApprovalsAreListedWithTheirClock() {
        let live = LinkSnapshot.Approval(id: "A-7F3K", action: "terminal_run", summary: "terminal_run: ls ~/Projects",
                                         context: "List the project folders", expiresAt: now.addingTimeInterval(540))
        let gone = LinkSnapshot.Approval(id: "A-OLD", action: "terminal_run", summary: "x", context: "", expiresAt: now.addingTimeInterval(-5))
        let approvals = build(snapshot: snapshot(approvals: [live, gone])).approvals
        XCTAssertEqual(approvals.map(\.id), ["A-7F3K"])
        XCTAssertEqual(approvals.first?.kicker, ["NEEDS APPROVAL", "EXPIRES IN 9 MIN"])
        XCTAssertEqual(approvals.first?.title, "List the project folders")
        XCTAssertEqual(approvals.first?.detail, "terminal_run: ls ~/Projects")
    }

    func testAStaleMacShowsNoApprovals() {
        let live = LinkSnapshot.Approval(id: "A-1", action: "a", summary: "s", context: "c", expiresAt: now.addingTimeInterval(3600))
        XCTAssertTrue(build(snapshot: snapshot(approvals: [live], age: 20 * 60)).approvals.isEmpty)
    }

    // MARK: Done early

    func testDoneEarlyNamesWhatItWouldEnd() {
        let block = build(snapshot: snapshot(early: .init(kind: "block", title: "Essay outline"))).doneEarly
        XCTAssertEqual(block.title, "Done with Essay outline early?")
        XCTAssertEqual(block.kicker, ["DONE EARLY", "ESSAY OUTLINE"])
        let lecture = build(snapshot: snapshot(early: .init(kind: "after-class", classTitle: "Seminar"))).doneEarly
        XCTAssertEqual(lecture.title, "Out of Seminar early?")
        let nothing = build().doneEarly
        XCTAssertEqual(nothing.title, "Finished something early?")
        XCTAssertEqual(nothing.hint, DoneEarly.accessibilityHint(for: nil))
    }

    // MARK: Glance

    func testGlanceRowShowsWaterSleepAndFocus() {
        let tracking = LinkSnapshot.Tracking(day: "2026-11-02", waterBottles: 4, waterGoal: 9, calories: 0, calorieGoal: 0, protein: 0,
                                             proteinGoal: 0, meals: [], supplements: [])
        let health = [LinkSnapshot.HealthDay(date: "2026-11-01", sleepHours: 6.2), LinkSnapshot.HealthDay(date: "2026-11-02", sleepHours: 7.5)]
        let glance = OrionGlance(generatedAt: now, source: "iphone",
                                 blocks: [block("b1", "Essay outline", at(19), at(20), kind: "orion", fixed: false)])
        let items = build(glance: glance, snapshot: snapshot(tracking: tracking, health: health)).glance
        XCTAssertEqual(items.map(\.kind), [.water, .sleep, .focus])
        XCTAssertEqual(items.map(\.value), ["4/9", "7.5h", "Essay outline"])
    }

    func testWaterTapsShowBeforeTheMacCountsThem() {
        let tracking = LinkSnapshot.Tracking(day: "2026-11-02", waterBottles: 4, waterGoal: 9, calories: 0, calorieGoal: 0, protein: 0,
                                             proteinGoal: 0, meals: [], supplements: [])
        XCTAssertEqual(build(snapshot: snapshot(tracking: tracking), water: 5).glance.first?.value, "5/9")
        XCTAssertEqual(build(snapshot: snapshot(tracking: tracking), water: 3).glance.first?.value, "4/9")
    }

    func testFocusPrefersThePhoneLockThenFreeTime() {
        let glance = OrionGlance(generatedAt: now, source: "iphone")
        XCTAssertEqual(build(glance: glance, lockedUntil: at(20, 40)).glance.last?.value, "apps locked till 8:40 PM")
        XCTAssertEqual(build(glance: glance).glance.last?.value, "free now")
    }

    func testNothingKnownIsNoGlance() {
        let home = build()
        XCTAssertTrue(home.glance.isEmpty)
        XCTAssertNil(home.ask)
        XCTAssertTrue(home.approvals.isEmpty)
    }

    // MARK: One "next" for every card

    /// What's next and Done early read the same next block, so they can never disagree.
    func testWhatsNextAndDoneEarlyAgreeOnTheNextBlock() {
        let busy = OrionGlance(generatedAt: now, source: "iphone", blocks: [
            block("b1", "Essay outline", at(18, 30), at(19, 30), kind: "orion", fixed: false),
            block("b2", "CS2100 Lab", at(19, 40), at(21), kind: "class", location: "Room 4.02"),
        ])
        let between = OrionGlance(generatedAt: now, source: "iphone", blocks: [
            block("b0", "Seminar", at(17), at(18, 30), kind: "class"),
            block("b2", "CS Lab", at(20, 10), at(21, 30), kind: "class", location: "Lab 2"),
        ])
        let empty = OrionGlance(generatedAt: now, source: "iphone")
        let cases: [(String, OrionGlance?, String?)] = [
            ("busy", busy, "Next up: CS2100 Lab at 7:40 PM, Room 4.02."),
            ("between", between, "Next up: CS Lab at 8:10 PM, Lab 2."),
            ("empty", empty, nil),
            ("unknown", nil, nil),
        ]
        for (name, glance, expected) in cases {
            let home = build(glance: glance, snapshot: snapshot(early: .init(kind: "none")))
            XCTAssertEqual(home.doneEarly.nextLine, expected, name)
            let block = PhoneHomeBuilder.nextBlock(in: glance, at: now)
            if let block {
                XCTAssertTrue(home.next?.title.contains(block.title) == true, "\(name): What's next names \(block.title)")
                XCTAssertTrue(home.doneEarly.nextLine?.contains(block.title) == true, "\(name): Done early names \(block.title)")
                XCTAssertNotEqual(home.next?.title, "Nothing else on today.", name)
            } else {
                XCTAssertNil(home.doneEarly.nextLine, name)
                if glance != nil { XCTAssertEqual(home.next?.title, "Nothing else on today.", name) }
            }
        }
        XCTAssertEqual(build(glance: between).next?.kicker, ["IN 1H", "CS LAB", "LAB 2"])
    }
}
