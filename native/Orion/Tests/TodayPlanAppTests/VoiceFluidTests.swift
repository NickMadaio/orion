import XCTest
@testable import Orion

/// 2026-10-23 voice latency (docs/audits/2026-10-23-voice-latency.md): the cue, the spoken progress and the 45 s handoff.
final class VoiceFluidTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func stage(_ id: String, _ label: String, _ detail: String? = nil) -> ProgressStage {
        ProgressStage(id: id, label: label, detail: detail)
    }

    // MARK: Cue timing

    func testNoCueWhenTheReplyArrivesWithinTheHold() {
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 0.5, replyReady: false, alreadyPlayed: false, heardSpeechAgo: nil), .wait)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.1, replyReady: true, alreadyPlayed: false, heardSpeechAgo: nil), .skip)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.19, replyReady: false, alreadyPlayed: false, heardSpeechAgo: nil), .wait)
    }

    func testCuePlaysOnceAtTheHoldWhenNoReply() {
        XCTAssertEqual(VoiceCuePolicy.hold, 1.2)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.2, replyReady: false, alreadyPlayed: false, heardSpeechAgo: nil), .play)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.5, replyReady: false, alreadyPlayed: true, heardSpeechAgo: nil), .skip)
    }

    func testCueNeverTalksOverHimAndGoesStale() {
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.5, replyReady: false, alreadyPlayed: false, heardSpeechAgo: 0.2), .wait)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.5, replyReady: false, alreadyPlayed: false, heardSpeechAgo: 1.0), .play)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 4.0, replyReady: false, alreadyPlayed: false, heardSpeechAgo: 0.1), .skip)
    }

    func testCueKindMatchesTheRequest() {
        XCTAssertEqual(VoiceCuePolicy.kind(for: "what's on tomorrow"), .lookup)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "do I have anything at 3"), .lookup)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "move gym to 6"), .change)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "reschedule my day after marketing, gym first"), .change)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "should I skip the lecture to finish my resume"), .think)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "help me plan my week"), .think)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "I'm meal prepping"), .generic)
    }

    func testCuePhrasesVaryAndNeverRepeatBackToBack() {
        var last: String?
        var seen = Set<String>()
        for seed in 0..<12 {
            let phrase = VoiceCuePolicy.phrase(for: .lookup, avoiding: last, seed: seed)
            XCTAssertNotEqual(phrase, last)
            XCTAssertTrue(VoiceCuePolicy.phrases[.lookup]!.contains(phrase))
            seen.insert(phrase)
            last = phrase
        }
        XCTAssertGreaterThan(seen.count, 2)
        XCTAssertTrue(VoiceCuePolicy.phrases[.think]!.contains("Hmm, let me think about that."))
        XCTAssertTrue(VoiceCuePolicy.phrases[.change]!.contains("On it."))
    }

    func testCueFileNamesAreStableAcrossLaunches() {
        XCTAssertEqual(VoiceCuePlayer.stableHash("On it."), VoiceCuePlayer.stableHash("On it."))
        XCTAssertNotEqual(VoiceCuePlayer.stableHash("On it."), VoiceCuePlayer.stableHash("Let me look."))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-test-\(UUID().uuidString)")
        let player = VoiceCuePlayer(cacheDir: dir, provider: { "elevenlabs" })
        XCTAssertTrue(player.fileURL(for: "On it.").lastPathComponent.hasPrefix("elevenlabs-"))
        XCTAssertFalse(player.isRendered("On it."))
        XCTAssertFalse(player.play("On it."), "an unrendered cue is skipped, never played late")
    }

    // MARK: Progress scheduling

    func testFirstUpdateBetweenEightAndTenSeconds() {
        let stages = [stage("understanding", "working out what you need"), stage("reading-calendar", "checking your calendar")]
        let plan = VoiceProgressPlan.start
        XCTAssertEqual(plan.next(elapsed: 8.9, stages: stages, replyReady: false, busy: false).0, .none)
        let (action, _) = plan.next(elapsed: 9.0, stages: stages, replyReady: false, busy: false)
        XCTAssertEqual(action, .update(text: "Still on it — checking your calendar.", stageKey: "reading-calendar"))
        XCTAssertGreaterThanOrEqual(VoiceProgressPlan.firstAfter, 8)
        XCTAssertLessThanOrEqual(VoiceProgressPlan.firstAfter, 10)
    }

    func testUpdatesAreSpacedCappedAndNeverRepeatAStage() {
        var stages = [stage("understanding", "u"), stage("reading-calendar", "checking your calendar")]
        var plan = VoiceProgressPlan.start
        var spoken: [String] = []
        var t: TimeInterval = 0
        while t < 44 {
            if t >= 15 && stages.count == 2 { stages.append(stage("checking-todos", "checking your to-dos")) }
            if t >= 25 && stages.count == 3 { stages.append(stage("changing-calendar", "making the change on your calendar", "Gym")) }
            let (action, next) = plan.next(elapsed: t, stages: stages, replyReady: false, busy: false)
            if case .update(let text, _) = action { spoken.append(text); XCTAssertTrue(t >= 9) }
            plan = next
            t += 0.5
        }
        XCTAssertEqual(spoken, [
            "Still on it — checking your calendar.",
            "Still going — checking your to-dos.",
            "Bear with me — making the change to Gym.",
        ])
        XCTAssertLessThanOrEqual(spoken.count, VoiceProgressPlan.maxUpdates)
        XCTAssertEqual(plan.spokenKeys, ["reading-calendar", "checking-todos", "changing-calendar:gym"])
        // Spacing: the second no sooner than interval after the first.
        XCTAssertGreaterThanOrEqual(VoiceProgressPlan.interval, 12)
        XCTAssertLessThanOrEqual(VoiceProgressPlan.interval, 15)
    }

    func testNoNewStageMeansOnePlainLineThenSilence() {
        let stages = [stage("reading-calendar", "checking your calendar")]
        var plan = VoiceProgressPlan.start
        var lines: [String] = []
        for step in 0..<88 {
            let (action, next) = plan.next(elapsed: Double(step) * 0.5, stages: stages, replyReady: false, busy: false)
            if case .update(let text, _) = action { lines.append(text) }
            plan = next
        }
        XCTAssertEqual(lines, ["Still on it — checking your calendar.", VoiceProgressPhrases.plain])
    }

    func testOnlyUnderstandingGivesThePlainLineNotAnInventedStage() {
        let (action, _) = VoiceProgressPlan.start.next(elapsed: 9, stages: [stage("understanding", "working out what you need")], replyReady: false, busy: false)
        XCTAssertEqual(action, .update(text: "Still working on it.", stageKey: nil))
    }

    func testUpdatesWaitWhileBusyAndStopWhenTheReplyIsReady() {
        let stages = [stage("reading-calendar", "checking your calendar")]
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 10, stages: stages, replyReady: false, busy: true).0, .none)
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 10, stages: stages, replyReady: true, busy: false).0, .none)
    }

    // MARK: The 45 s handoff

    func testHandoffAtFortyFiveSecondsOnce() {
        var plan = VoiceProgressPlan.start
        XCTAssertNotEqual(plan.next(elapsed: 44.9, stages: [], replyReady: false, busy: false).0, .handoff(text: VoiceProgressPhrases.handoff))
        let (action, after) = plan.next(elapsed: 45, stages: [], replyReady: false, busy: false)
        XCTAssertEqual(action, .handoff(text: "This is taking longer than it should — I'll text you the answer when it's done."))
        plan = after
        XCTAssertTrue(plan.handedOff)
        XCTAssertEqual(plan.next(elapsed: 60, stages: [], replyReady: false, busy: false).0, .none)
    }

    func testHandoffWaitsForHimToFinishTalking() {
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 46, stages: [], replyReady: false, busy: true).0, .none)
    }

    func testNoHandoffWhenTheReplyCameFirst() {
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 50, stages: [], replyReady: true, busy: false).0, .none)
    }

    // MARK: The companion end to end (fake hooks, pinned clock)

    private final class Recorder {
        var cues: [String] = []
        var updates: [String] = []
        var shown: [String] = []
        var handoffs: [String] = []
        var stages: [ProgressStage] = []
    }

    private func companion(_ message: String, _ r: Recorder) -> VoiceTurnCompanion {
        VoiceTurnCompanion(message: message, startedAt: t0, hooks: .init(
            stages: { r.stages },
            heardSpeechAgo: { nil },
            isPlaying: { false },
            playCue: { r.cues.append($0); return true },
            sayUpdate: { r.updates.append($0) },
            show: { r.shown.append($0) },
            handOff: { r.handoffs.append($0) }
        ))
    }

    func testCompanionSkipsTheCueForAQuickReply() {
        let r = Recorder()
        let c = companion("what's next", r)
        c.tick(now: t0.addingTimeInterval(0.6))
        c.stop()                                   // reply in at 0.8 s
        c.tick(now: t0.addingTimeInterval(1.3))
        c.tick(now: t0.addingTimeInterval(50))
        XCTAssertEqual(r.cues, [])
        XCTAssertEqual(r.updates, [])
        XCTAssertEqual(r.handoffs, [])
    }

    func testCompanionCueThenRealUpdatesThenHandoff() {
        let r = Recorder()
        let c = companion("move gym to after class", r)
        var t: TimeInterval = 0
        while t <= 46 {
            if t >= 3 && r.stages.isEmpty { r.stages = [stage("understanding", "u"), stage("reading-calendar", "checking your calendar")] }
            c.tick(now: t0.addingTimeInterval(t))
            t += 0.25
        }
        XCTAssertEqual(r.cues.count, 1)
        XCTAssertTrue(VoiceCuePolicy.phrases[.change]!.contains(r.cues[0]))
        XCTAssertEqual(r.updates.first, "Still on it — checking your calendar.")
        XCTAssertEqual(r.updates, r.shown)
        XCTAssertLessThanOrEqual(r.updates.count, VoiceProgressPlan.maxUpdates)
        XCTAssertEqual(r.handoffs, [VoiceProgressPhrases.handoff])
        XCTAssertTrue(c.replyReady, "after the handoff the companion is finished")
    }

    // MARK: The plugin's file

    func testProgressFileNameMatchesThePlugin() {
        XCTAssertEqual(VoiceProgressFile.fileName(session: "orion-chat-9311FB49-DD4C"), "agent_main_orion-chat-9311FB49-DD4C.json")
        XCTAssertEqual(VoiceProgressFile.fileName(session: "orion-app-v2"), "agent_main_orion-app-v2.json")
        XCTAssertEqual(VoiceProgressFile.fileName(session: "agent:main:x"), "agent_main_x.json")
    }

    func testProgressFileParsesAndIgnoresAnEarlierTurn() throws {
        let json = """
        {"v":1,"sessionKey":"agent:main:orion-chat-x","runId":"r","startedAt":"2027-01-15T08:00:01.000Z","updatedAt":"2027-01-15T08:00:05.000Z",
         "stages":[{"stage":"understanding","label":"working out what you need","at":"2027-01-15T08:00:01.000Z"},
                   {"stage":"changing-calendar","label":"making the change on your calendar","at":"2027-01-15T08:00:05.000Z","detail":"Gym"}],
         "done":false}
        """
        let data = Data(json.utf8)
        let turnStart = ISO8601DateFormatter().date(from: "2027-01-15T08:00:00Z")!
        let snap = try XCTUnwrap(VoiceProgressFile.parse(data, notBefore: turnStart))
        XCTAssertEqual(snap.stages.map(\.id), ["understanding", "changing-calendar"])
        XCTAssertEqual(snap.stages[1].detail, "Gym")
        XCTAssertEqual(VoiceProgressPhrases.line(for: snap.stages[1], index: 0), "Still on it — making the change to Gym.")
        XCTAssertNil(VoiceProgressFile.parse(data, notBefore: turnStart.addingTimeInterval(60)), "a file from an earlier turn is never read as this one's")
        XCTAssertNil(VoiceProgressFile.parse(Data("not json".utf8), notBefore: turnStart))
    }

    func testEveryFixedUpdateIsRenderableAhead() {
        XCTAssertTrue(VoiceProgressPhrases.renderable.contains("Still on it — checking your calendar."))
        XCTAssertTrue(VoiceProgressPhrases.renderable.contains(VoiceProgressPhrases.handoff))
        XCTAssertEqual(VoiceProgressPhrases.knownLabels.count, 11)
    }
}

final class VoiceHandoffTests: XCTestCase {
    func testHandedOffAnswerGoesToThePhoneThread() throws {
        let command = try XCTUnwrap(VoiceHandoff.phoneCommand(answer: " Done: Gym 6-7:30 PM. ", node: "/fake/node", scriptsDir: "/fake/scripts", exists: { _ in true }))
        XCTAssertEqual(command.executable, "/fake/node")
        XCTAssertEqual(command.arguments.prefix(2), ["/fake/scripts/orion-reach", "Done: Gym 6-7:30 PM."])
        XCTAssertTrue(command.arguments.contains("--channel"))
        XCTAssertEqual(command.arguments[command.arguments.firstIndex(of: "--channel")! + 1], "phone")
        XCTAssertEqual(command.arguments[command.arguments.firstIndex(of: "--kind")! + 1], "update")
    }

    func testNoPhoneCommandWithoutReachOrText() {
        XCTAssertNil(VoiceHandoff.phoneCommand(answer: "hi", node: "/n", scriptsDir: "/s", exists: { _ in false }))
        XCTAssertNil(VoiceHandoff.phoneCommand(answer: "  ", node: "/n", scriptsDir: "/s", exists: { _ in true }))
    }
}
