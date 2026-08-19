//
//  Reasoning about what to close, and the floor it cannot reach past.
//
//  The tests that matter here are the adversarial ones. A model that says
//  "close everything", a model that invents bundle identifiers, a model that is
//  not running at all — none of them may result in a quit that a pure policy
//  had already refused. The reasoning can only ever narrow the set it is given.
//

import XCTest
import AppKit
@testable import SessionDomain
@testable import SessionService

// MARK: - Doubles

private final class FakeApps: RunningAppsReading {
    var running: [AppFacts] = []
    func facts(now: Date) -> [AppFacts] { running }
}

private final class FakeReasoner: DistractionReasoning {
    var reply = "[]"
    var failure: Error?
    private(set) var prompts: [String] = []

    func answer(_ prompt: String) throws -> String {
        prompts.append(prompt)
        if let failure { throw failure }
        return reply
    }
}

private final class FakeDocuments: DocumentStateSensing {
    var state: DocumentState = .clean
    func documentState(pid: pid_t) -> (state: DocumentState, readableWindows: Int?) {
        (state, 1)
    }
}

private struct Boom: Error, LocalizedError {
    var errorDescription: String? { "Ollama is not answering" }
}

final class DistractionReviewTests: XCTestCase {

    private var directory: URL!
    private var apps: FakeApps!
    private var reasoner: FakeReasoner!
    private var documents: FakeDocuments!
    private var quittable: QuittableApps!
    private var closer: DistractionCloser!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-distraction-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        apps = FakeApps()
        reasoner = FakeReasoner()
        documents = FakeDocuments()
        quittable = QuittableApps(url: directory.appendingPathComponent("quittable-apps.json"),
                                  documents: documents)
        closer = DistractionCloser(apps: apps, quittable: quittable, reasoner: reasoner)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func app(_ bundleID: String, name: String,
                     documents: DocumentState = .clean,
                     frontmost: Bool = false,
                     lastActive: TimeInterval? = 3600) -> AppFacts {
        AppFacts(bundleID: bundleID, name: name, isFrontmost: frontmost, isHidden: false,
                 isBackgroundOnly: false, isSystemComponent: false, documents: documents,
                 readableWindows: 1, secondsSinceLastActive: lastActive,
                 secondsSinceLaunch: 7200, editsDocuments: false)
    }

    // MARK: What the model is even shown

    /// The blocked apps are not "recommended against" to the model. It never
    /// sees them, so it cannot argue about them.
    func testAppsRefusedByTheFloorAreNeverPutInFrontOfTheModel() {
        apps.running = [
            app("com.example.music", name: "Music"),
            app("com.example.editor", name: "Editor", documents: .edited),
            app("com.nickmadaio.orion.app", name: "Orion")
        ]

        _ = closer.review(task: "write the deploy notes")

        let prompt = reasoner.prompts.first ?? ""
        XCTAssertTrue(prompt.contains("com.example.music"))
        XCTAssertFalse(prompt.contains("com.example.editor"))
        XCTAssertFalse(prompt.contains("com.nickmadaio.orion.app"))
    }

    func testTheStatedTaskIsWhatTheQuestionIsAsked_against() {
        apps.running = [app("com.example.music", name: "Music")]

        _ = closer.review(task: "rewrite the audio coordinator")

        XCTAssertTrue((reasoner.prompts.first ?? "").contains("rewrite the audio coordinator"),
                      "“isn't being used for my task” is unanswerable without the task")
    }

    // MARK: The model cannot widen the set

    func testAModelThatSaysCloseEverythingStillCannotTouchABlockedApp() {
        apps.running = [
            app("com.example.editor", name: "Editor", documents: .edited),
            app("com.nickmadaio.orion.app", name: "Orion"),
            app("com.example.music", name: "Music")
        ]
        reasoner.reply = """
        [{"bundle":"com.example.editor","close":true,"reason":"unrelated"},
         {"bundle":"com.nickmadaio.orion.app","close":true,"reason":"unrelated"},
         {"bundle":"com.example.music","close":true,"reason":"a music player"}]
        """

        let review = closer.review(task: "write")

        XCTAssertEqual(review.toClose.map(\.bundleID), ["com.example.music"])
        let editor = review.decisions.first { $0.bundleID == "com.example.editor" }
        XCTAssertEqual(editor?.source, .floor)
        XCTAssertEqual(editor?.reason, "it has unsaved changes")
    }

    func testInventedBundleIdentifiersAreDropped() {
        apps.running = [app("com.example.music", name: "Music")]
        reasoner.reply = """
        [{"bundle":"com.hallucinated.app","close":true,"reason":"nope"}]
        """

        let review = closer.review(task: "write")

        XCTAssertTrue(review.toClose.isEmpty)
    }

    /// Silence is not permission.
    func testAnAppTheModelDidNotMentionIsKept() {
        apps.running = [app("com.example.music", name: "Music"),
                        app("com.example.news", name: "News")]
        reasoner.reply = #"[{"bundle":"com.example.music","close":true,"reason":"music"}]"#

        let review = closer.review(task: "write")

        XCTAssertEqual(review.toClose.map(\.bundleID), ["com.example.music"])
        XCTAssertEqual(review.decisions.first { $0.bundleID == "com.example.news" }?.source,
                       .unmentioned)
    }

    // MARK: When the reasoning is not there

    func testNothingIsClosedWhenTheModelIsUnreachable() {
        apps.running = [app("com.example.music", name: "Music")]
        reasoner.failure = Boom()

        let review = closer.review(task: "write")

        XCTAssertTrue(review.toClose.isEmpty)
        XCTAssertNotNil(review.unavailable)
        XCTAssertTrue(review.unavailable!.contains("Ollama"))
    }

    func testNothingIsClosedWhenTheAnswerCannotBeRead() {
        apps.running = [app("com.example.music", name: "Music")]
        reasoner.reply = "I think you should probably close Music, honestly."

        let review = closer.review(task: "write")

        XCTAssertTrue(review.toClose.isEmpty)
        XCTAssertNotNil(review.unavailable)
    }

    func testNothingIsClosedWithNoReasonerAtAll() {
        let noBrain = DistractionCloser(apps: apps, quittable: quittable, reasoner: nil)
        apps.running = [app("com.example.music", name: "Music")]

        let review = noBrain.review(task: "write")

        XCTAssertTrue(review.toClose.isEmpty)
        XCTAssertNotNil(review.unavailable)
    }

    // MARK: Parsing what a small model actually returns

    func testTheParserSurvivesFencesProseAndStringBooleans() {
        let known = [app("com.example.music", name: "Music"),
                     app("com.example.news", name: "News")]
        let raw = """
        Sure! Here is the JSON:
        ```json
        [{"bundle": "com.example.music", "close": "true", "reason": "music player"},
         {"bundle": "com.example.news", "close": 0, "reason": "might be research"}]
        ```
        """

        let decisions = DistractionPrompt.parse(raw, known: known)

        XCTAssertEqual(decisions.count, 2)
        XCTAssertTrue(decisions[0].close)
        XCTAssertFalse(decisions[1].close)
    }

    func testAnythingAmbiguousInTheAnswerMeansKeep() {
        let known = [app("com.example.music", name: "Music")]
        let raw = #"[{"bundle":"com.example.music","close":"probably","reason":"unsure"}]"#

        XCTAssertFalse(DistractionPrompt.parse(raw, known: known)[0].close)
    }

    func testEveryDecisionCarriesAReasonForTheLog() {
        apps.running = [app("com.example.music", name: "Music"),
                        app("com.example.editor", name: "Editor", documents: .edited)]
        reasoner.reply = #"[{"bundle":"com.example.music","close":true,"reason":"a music player"}]"#

        for decision in closer.review(task: "write").decisions {
            XCTAssertFalse(decision.reason.isEmpty, decision.name)
            XCTAssertTrue(decision.logLine.contains(decision.name))
        }
    }

    // MARK: The floor at the moment of quitting

    /// The proof the whole feature rests on: the last gate before
    /// `terminate()`, exercised directly so it does not depend on which apps
    /// happen to be open on the machine running the tests.
    func testAQuitIsRefusedWhenTheAppHoldsUnsavedWork() {
        documents.state = .edited

        XCTAssertEqual(quittable.unsavedRefusal(pids: [4242], label: "Editor"),
                       .holdsUnsavedWork("Editor"))
    }

    /// And the same for a signal that simply could not be read. "Could not tell"
    /// is not "clean", and collapsing the two is how an hour of work is lost.
    func testAQuitIsRefusedWhenTheStateCannotBeRead() {
        documents.state = .unknown

        XCTAssertEqual(quittable.unsavedRefusal(pids: [4242], label: "Editor"),
                       .unreadable("Editor"))
    }

    func testACleanAppIsTheOnlyThingThatGetsPastTheGate() {
        documents.state = .clean

        XCTAssertNil(quittable.unsavedRefusal(pids: [4242], label: "Music"))
    }

    /// The same refusal, reached through the real `quit` against an app that is
    /// genuinely running. Skipped rather than faked when the machine has
    /// nothing suitable open — and it can never quit anything, because the
    /// sensor it is given always objects.
    func testTheRefusalHoldsThroughTheRealQuitPath() throws {
        let candidate = NSWorkspace.shared.runningApplications.first { app in
            guard let bundleID = app.bundleIdentifier else { return false }
            return app.activationPolicy == .regular
                && !QuittableApps.neverQuittable.contains(bundleID)
        }
        let bundleID = try XCTUnwrap(candidate?.bundleIdentifier,
                                     "no ordinary app is running to test against")
        documents.state = .edited

        XCTAssertEqual(
            quittable.quit(bundleID: bundleID, name: "Something",
                           authorizedBy: .reviewed(reason: "not part of the task")),
            .holdsUnsavedWork("Something")
        )
    }

    func testAReviewedQuitCannotReachTheNeverQuitList() {
        XCTAssertEqual(
            quittable.quit(bundleID: "com.nickmadaio.orion.app", name: "Orion",
                           authorizedBy: .reviewed(reason: "the model said so")),
            .notPermitted("Orion")
        )
    }

    /// The old path is untouched: reasoning did not become a way to skip the
    /// list for callers that still use it.
    func testTheUserListPathStillRefusesAnAppNobodyAdded() {
        XCTAssertEqual(quittable.quit(bundleID: "com.example.music", name: "Music"),
                       .notPermitted("Music"))
    }

    // MARK: A restart is not a session start

    private func startedEvent(_ ago: TimeInterval) -> LifecycleEvent {
        LifecycleEvent(id: UUID().uuidString,
                       stamp: ClockStamp(wall: Date().addingTimeInterval(-ago), uptime: nil),
                       kind: .started)
    }

    func testASessionThatJustBeganIsFresh() {
        XCTAssertTrue(SessionFreshness.startedJustNow(events: [startedEvent(5)], now: Date()))
    }

    /// The one that cost three of Nick's apps once: Orion relaunches into a
    /// session that has been running for hours and replays "session starting".
    func testASessionOrionWasRelaunchedIntoIsNotFresh() {
        XCTAssertFalse(SessionFreshness.startedJustNow(events: [startedEvent(3600)], now: Date()))
    }

    func testAnUnreadableSessionIsNeverTreatedAsFresh() {
        XCTAssertFalse(SessionFreshness.startedJustNow(events: nil, now: Date()))
        XCTAssertFalse(SessionFreshness.startedJustNow(events: [], now: Date()))
    }

    // MARK: The audit trail

    /// Ninety "Dock is part of macOS" lines is where an interesting line goes
    /// to hide. Anything held back because of WORK keeps its own line; the rest
    /// is counted.
    func testTheLogNamesEveryAppThatWasReasonedAboutOrHeldBackForWork() {
        apps.running = [
            app("com.example.music", name: "Music"),
            app("com.example.editor", name: "Editor", documents: .edited),
            app("com.example.electron", name: "Electron", documents: .unknown),
            app("com.nickmadaio.orion.app", name: "Orion"),
            app("com.apple.finder", name: "Finder")
        ]
        reasoner.reply = #"[{"bundle":"com.example.music","close":false,"reason":"might be for the task"}]"#
        var lines: [String] = []
        closer.onLog = { lines.append($0) }

        closer.closeDistractions(task: "write")

        let joined = lines.joined(separator: "\n")
        XCTAssertTrue(joined.contains("Music"), "reasoned about, so named")
        XCTAssertTrue(joined.contains("Editor"), "held back for unsaved work, so named")
        XCTAssertTrue(joined.contains("Electron"), "held back as unreadable, so named")
        XCTAssertTrue(joined.contains("never considered"), "the rest is counted, not listed")
        XCTAssertFalse(joined.contains("keep Finder"))
    }

    // MARK: Describing an app to the model

    func testAnAppIsDescribedWithTheSignalsThatWereActuallyObtained() {
        let line = DistractionPrompt.describe(app("com.example.music", name: "Music",
                                                  lastActive: nil))

        XCTAssertTrue(line.contains("Music"))
        XCTAssertTrue(line.contains("com.example.music"))
        XCTAssertTrue(line.contains("not switched to"),
                      "a nil must read as 'not seen', never as a made-up number")
    }
}
