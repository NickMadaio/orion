//
//  What Orion actually says.
//
//  These are spoken aloud, so a grammatical slip is more obvious than it would
//  be on screen — and the two-minute dev fixture hits the singular case on
//  every single run.
//

import XCTest
@testable import SessionDomain
@testable import SessionService

final class AnnouncementTests: XCTestCase {

    private func say(_ announcement: Announcement) -> String {
        SessionEffects.sentence(for: announcement)
    }

    func testOneMinuteIsSingular() {
        XCTAssertEqual(say(.restBeginning(minutes: 1)), "Break — 1 minute.")
        XCTAssertEqual(say(.focusBeginning(blockNumber: 1, ofBlocks: 3, minutes: 1)),
                       "First block. 1 minute.")
    }

    func testEverythingElseIsPlural() {
        XCTAssertEqual(say(.restBeginning(minutes: 10)), "Break — 10 minutes.")
        XCTAssertEqual(say(.focusBeginning(blockNumber: 2, ofBlocks: 3, minutes: 50)),
                       "Block 2 of 3. 50 minutes.")
    }

    func testNoAnnouncementIsEmpty() {
        let all: [Announcement] = [
            .sessionStarted(task: "the thing", totalMinutes: 170),
            .focusBeginning(blockNumber: 1, ofBlocks: 3, minutes: 50),
            .restBeginning(minutes: 10),
            .restEnding,
            .sessionComplete(focusMinutes: 150),
            .sessionEndedEarly(focusMinutes: 40),
            .waitingForReturn,
            .paused,
            .resumed
        ]
        for announcement in all {
            XCTAssertFalse(say(announcement).isEmpty, "\(announcement) says nothing")
        }
    }

    func testTheDisengageLineSaysItIsStoppingSoSilenceReadsAsADecision() {
        let line = Enforcer.disengageLine(for: .wrongApp(name: "Messages"))
        XCTAssertTrue(line.contains("stop"), line)
    }
}
