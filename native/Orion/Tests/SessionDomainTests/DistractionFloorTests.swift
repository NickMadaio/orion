//
//  The floor under the reasoning.
//
//  These are not tests that the feature works. They are tests that it CANNOT do
//  the one thing Nick will not forgive, which is close something holding work he
//  has not saved. Every case here is a refusal, and the refusals have to hold
//  when the signal is missing as firmly as when it says "dirty" — an app whose
//  state could not be read is not a clean app.
//

import XCTest
@testable import SessionDomain

final class DistractionFloorTests: XCTestCase {

    /// The baseline: something running, idle, readable and plainly not in use.
    private func app(
        _ bundleID: String = "com.example.trivia",
        name: String = "Trivia",
        frontmost: Bool = false,
        hidden: Bool = false,
        background: Bool = false,
        system: Bool = false,
        documents: DocumentState = .clean,
        windows: Int? = 1,
        lastActive: TimeInterval? = 3600,
        launched: TimeInterval? = 7200,
        editsDocuments: Bool = false
    ) -> AppFacts {
        AppFacts(bundleID: bundleID, name: name, isFrontmost: frontmost, isHidden: hidden,
                 isBackgroundOnly: background, isSystemComponent: system,
                 documents: documents, readableWindows: windows,
                 secondsSinceLastActive: lastActive, secondsSinceLaunch: launched,
                 editsDocuments: editsDocuments)
    }

    // MARK: The one that matters

    func testAnAppWithUnsavedChangesIsRefused() {
        let verdict = DistractionFloor.screen(app(documents: .edited))

        XCTAssertEqual(verdict, .blocked("it has unsaved changes"))
        XCTAssertFalse(verdict.isEligible,
                       "no focus session is worth somebody's unsaved document")
    }

    /// The subtler half of the same rule, and the one a careless implementation
    /// gets wrong: "could not tell" is not "clean".
    func testAnAppWhoseStateCouldNotBeReadIsRefused() {
        let verdict = DistractionFloor.screen(app(documents: .unknown, windows: nil))

        XCTAssertFalse(verdict.isEligible)
        XCTAssertEqual(verdict.reason, "Orion could not read whether it has unsaved work")
    }

    /// Unsaved beats everything else about the app, including being an obvious
    /// distraction that has not been touched in hours.
    func testUnsavedChangesOutrankEverySignalThatWouldAllowIt() {
        let obviousDistraction = app("com.example.game", name: "Game",
                                     documents: .edited, lastActive: 60 * 60 * 8)

        XCTAssertFalse(DistractionFloor.screen(obviousDistraction).isEligible)
    }

    // MARK: The never list

    func testOrionCannotBeClosedByReasoning() {
        XCTAssertFalse(DistractionFloor.screen(app("com.nickmadaio.orion.app", name: "Orion")).isEligible,
                       "an assistant that can quit itself cannot be asked to stop")
    }

    func testTheMachineAndTheCredentialsAreRefused() {
        for bundleID in ["com.apple.finder", "com.apple.loginwindow",
                         "com.1password.1password", "com.apple.SecurityAgent"] {
            XCTAssertFalse(DistractionFloor.screen(app(bundleID)).isEligible, bundleID)
        }
    }

    /// Quitting these does not close a window, it kills a build, a shell or a
    /// recording — and no save sheet appears to stop it.
    func testTerminalsEditorsAndRecordersAreRefused() {
        for bundleID in ["com.apple.Terminal", "com.googlecode.iterm2",
                         "com.microsoft.VSCode", "com.apple.dt.Xcode",
                         "com.apple.QuickTimePlayerX", "us.zoom.xos"] {
            XCTAssertFalse(DistractionFloor.screen(app(bundleID)).isEligible, bundleID)
        }
    }

    // MARK: In use

    func testTheAppInFrontIsNeverClosed() {
        XCTAssertEqual(DistractionFloor.screen(app(frontmost: true)).reason,
                       "it is the app you are using right now")
    }

    func testSomethingUsedInTheLastTwoMinutesIsLeftAlone() {
        XCTAssertFalse(DistractionFloor.screen(app(lastActive: 30)).isEligible)
        XCTAssertTrue(DistractionFloor.screen(app(lastActive: 300)).isEligible)
    }

    /// Never seen active is the strongest "not part of this task" signal there
    /// is, and it must not be confused with "active just now".
    func testNeverHavingBeenSwitchedToIsNotRecentUse() {
        XCTAssertTrue(DistractionFloor.screen(app(lastActive: nil)).isEligible)
    }

    // MARK: Not applications at all

    func testBackgroundProcessesAndSystemComponentsAreRefused() {
        XCTAssertFalse(DistractionFloor.screen(app(background: true)).isEligible)
        XCTAssertFalse(DistractionFloor.screen(app(system: true)).isEligible)
    }

    func testAnAppWithNoBundleIdentifierIsRefused() {
        XCTAssertFalse(DistractionFloor.screen(app("  ")).isEligible)
    }

    // MARK: What survives

    /// Messages lives in /System/Applications and is the archetypal
    /// distraction. "Shipped by Apple" must not mean "part of macOS".
    func testAnAppleAppThatIsNotSystemMachineryCanBeConsidered() {
        XCTAssertTrue(DistractionFloor.screen(app("com.apple.MobileSMS", name: "Messages")).isEligible)
    }

    func testPartitionKeepsAReasonForEveryRefusal() {
        let result = DistractionFloor.partition([
            app("com.example.clean"),
            app("com.example.dirty", documents: .edited),
            app("com.nickmadaio.orion.app")
        ])

        XCTAssertEqual(result.eligible.map(\.bundleID), ["com.example.clean"])
        XCTAssertEqual(result.blocked.count, 2)
        for (_, reason) in result.blocked {
            XCTAssertFalse(reason.isEmpty, "a refusal Nick cannot read is not an audit trail")
        }
    }
}
