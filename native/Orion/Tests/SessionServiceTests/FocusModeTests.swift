//
//  One Shortcut, any Focus mode.
//
//  Two things are being tested and they are different in kind. The parser is
//  about being FORGIVING: the mode name comes out of speech through a small
//  model, so "DND", "Do Not Disturb" and "do-not-disturb" have to be one mode.
//  The control is about being STRICT: a mode Orion does not know, or a Shortcut
//  that is not there, must fail loudly and before anything runs — because a
//  session that quietly failed to change Focus is trusted and then interrupted.
//

import XCTest
@testable import SessionService

private final class FakeShortcuts: ShortcutRunning {
    var installed: [String]? = []
    var status: Int32 = 0
    var launchFailure: String?
    private(set) var runs: [(name: String, input: String)] = []

    func names() -> [String]? { installed }

    func run(_ name: String, input: String) -> ShortcutRun {
        runs.append((name, input))
        return ShortcutRun(status: status, launchFailure: launchFailure)
    }
}

final class FocusModeTests: XCTestCase {

    private var shortcuts: FakeShortcuts!
    private var defaults: UserDefaults!
    private var control: FocusModeControl!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        shortcuts = FakeShortcuts()
        suiteName = "orion.focus.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        control = FocusModeControl(runner: shortcuts, defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: The parser

    func testTheSameModeSurvivesEveryWayItMightBeSaid() {
        for spoken in ["Do Not Disturb", "do not disturb", "DND", "dnd",
                       "do-not-disturb", "  Do   Not  Disturb  ", "donotdisturb"] {
            XCTAssertEqual(FocusModeParser.mode(spoken)?.canonical, "do not disturb", spoken)
        }
    }

    func testTheWordsPeopleAddAroundTheNameAreIgnored() {
        for spoken in ["Work", "work mode", "the work focus", "focus work", "WORK"] {
            XCTAssertEqual(FocusModeParser.mode(spoken)?.canonical, "work", spoken)
        }
    }

    func testSynonymsLandOnTheRealMode() {
        XCTAssertEqual(FocusModeParser.mode("gym")?.canonical, "fitness")
        XCTAssertEqual(FocusModeParser.mode("bedtime")?.canonical, "sleep")
        XCTAssertEqual(FocusModeParser.mode("meditation")?.canonical, "mindfulness")
    }

    /// The important negative. A guessed mode is a shortcut run that matches no
    /// branch, does nothing, and reports success.
    func testAModeNobodyHasIsNotInvented() {
        XCTAssertNil(FocusModeParser.mode("hyperfocus"))
        XCTAssertNil(FocusModeParser.mode(""))
        XCTAssertNil(FocusModeParser.mode("   "))
    }

    func testAModeNickMadeHimselfIsAcceptedOnceHeSaysSo() {
        XCTAssertNil(FocusModeParser.mode("deep study"))
        XCTAssertEqual(FocusModeParser.mode("Deep Study", custom: ["deep study"])?.canonical,
                       "deep study")
    }

    func testTheIntentIsForgivingToo() {
        for word in ["on", "enable", "start", "Turn On", "activate"] {
            XCTAssertEqual(FocusIntent(spoken: word), .on, word)
        }
        for word in ["off", "disable", "stop", "END", "clear"] {
            XCTAssertEqual(FocusIntent(spoken: word), .off, word)
        }
        XCTAssertNil(FocusIntent(spoken: "maybe"))
    }

    // MARK: The contract

    func testTheInputIsStateThenMode() {
        let mode = FocusModeParser.mode("Work")!
        XCTAssertEqual(FocusModeControl.input(mode: mode, intent: .on), "on work")
        XCTAssertEqual(FocusModeControl.input(mode: mode, intent: .off), "off work")
        XCTAssertEqual(
            FocusModeControl.input(mode: FocusModeParser.mode("DND")!, intent: .on),
            "on do not disturb"
        )
    }

    // MARK: Configuration

    func testTheShortcutNameDefaultsAndIsConfigurable() {
        XCTAssertEqual(control.shortcutName, "ORION Focus Toggle")

        defaults.set("My Focus Thing", forKey: FocusModeControl.Key.shortcutName)
        XCTAssertEqual(control.shortcutName, "My Focus Thing")

        // Blank is not a name — fall back rather than run "".
        defaults.set("   ", forKey: FocusModeControl.Key.shortcutName)
        XCTAssertEqual(control.shortcutName, "ORION Focus Toggle")
    }

    func testTheSessionModeDefaultsToDoNotDisturbAndIsConfigurable() {
        XCTAssertEqual(control.sessionMode.canonical, "do not disturb")

        defaults.set("Work", forKey: FocusModeControl.Key.mode)
        XCTAssertEqual(control.sessionMode.canonical, "work")

        // A mode nobody has must not become an input nothing matches.
        defaults.set("nonsense", forKey: FocusModeControl.Key.mode)
        XCTAssertEqual(control.sessionMode.canonical, "do not disturb")
    }

    func testCustomModesAreReadAsAList() {
        defaults.set("deep work, studio ,", forKey: FocusModeControl.Key.customModes)
        XCTAssertEqual(control.customModes, ["deep work", "studio"])
        XCTAssertTrue(control.knownModes.contains("deep work"))
    }

    // MARK: Running it

    func testItRunsOneShortcutWithTheModeAsInput() {
        shortcuts.installed = ["ORION Focus Toggle"]

        let outcome = control.set("Work", to: .on)

        XCTAssertEqual(outcome, .done)
        XCTAssertEqual(shortcuts.runs.count, 1)
        XCTAssertEqual(shortcuts.runs.first?.name, "ORION Focus Toggle")
        XCTAssertEqual(shortcuts.runs.first?.input, "on work")
    }

    func testAMissingShortcutIsReportedAndNothingIsRun() {
        shortcuts.installed = ["Some Other Shortcut"]

        let outcome = control.set("Work", to: .on)

        XCTAssertTrue(shortcuts.runs.isEmpty, "a missing shortcut must not be invoked")
        guard case .notConfigured(let why) = outcome else {
            return XCTFail("expected notConfigured, got \(outcome)")
        }
        XCTAssertTrue(why.contains("ORION Focus Toggle"))
    }

    func testAnUnknownModeIsRefusedBeforeTheShortcutIsTouched() {
        shortcuts.installed = ["ORION Focus Toggle"]

        let outcome = control.set("hyperfocus", to: .on)

        XCTAssertTrue(shortcuts.runs.isEmpty)
        guard case .notConfigured(let why) = outcome else {
            return XCTFail("expected notConfigured, got \(outcome)")
        }
        XCTAssertTrue(why.contains("hyperfocus"))
        XCTAssertTrue(why.contains("do not disturb"), "say what it does know")
    }

    func testANonzeroExitIsAFailureNotASilentSuccess() {
        shortcuts.installed = ["ORION Focus Toggle"]
        shortcuts.status = 1

        let outcome = control.set("Work", to: .on)

        guard case .failed(let why) = outcome else {
            return XCTFail("expected failed, got \(outcome)")
        }
        XCTAssertTrue(why.contains("1"))
    }

    func testAShortcutThatCouldNotBeStartedIsAFailure() {
        shortcuts.installed = ["ORION Focus Toggle"]
        shortcuts.launchFailure = "no such file"

        XCTAssertEqual(control.set("Work", to: .on), .failed("no such file"))
    }

    /// A broken diagnostic must not block a working setup: if the shortcut list
    /// cannot be read at all, try anyway rather than refusing.
    func testAnUnreadableShortcutListDoesNotBlockTheRun() {
        shortcuts.installed = nil

        XCTAssertEqual(control.set("Work", to: .on), .done)
        XCTAssertEqual(shortcuts.runs.first?.input, "on work")
        XCTAssertNil(control.exists("ORION Focus Toggle"),
                     "unknown is a real answer, distinct from absent")
    }

    func testTheSessionTurnsTheModeOnAndBackOff() {
        shortcuts.installed = ["ORION Focus Toggle"]
        defaults.set("work", forKey: FocusModeControl.Key.mode)

        XCTAssertEqual(control.enableForSession(), .done)
        XCTAssertEqual(control.disableForSession(), .done)
        XCTAssertEqual(shortcuts.runs.map(\.input), ["on work", "off work"])
    }

    func testIsConfiguredFollowsTheConfiguredName() {
        shortcuts.installed = ["My Focus Thing"]
        XCTAssertFalse(control.isConfigured())

        defaults.set("My Focus Thing", forKey: FocusModeControl.Key.shortcutName)
        XCTAssertTrue(control.isConfigured())
    }
}
