import Foundation

/*
 Spoken progress during a slow voice turn, and the honest handoff (2026-10-23).

 Nick: "give small updates on his thinking", like ChatGPT or Claude trickling updates during a long task; and
 "minutes to respond vocally to something makes no sense".

 The plugin writes the stages a turn really went through to
 `~/.openclaw/orion-controlled/turn-progress/<session key>.json` (plugin `turn-progress.ts`). While a voice turn
 waits, `VoiceProgressPlan` decides when to say something:

   - the first update after `firstAfter` (9 s) with no reply, then every `interval` (13 s), at most `maxUpdates` (3);
   - each update names the newest stage not yet spoken ("Still on it — checking your calendar."), never one it
     already said and never one the plugin did not write. With no stage to report, one plain "Still working on it."
   - at `handoffAt` (45 s) with no answer: "This is taking longer than it should — I'll text you the answer when
     it's done." The turn keeps running; its answer goes to the bubble and the phone thread, not the speakers.

 Everything here is pure except `VoiceProgressFile.read`, so the timing rules are tested without a clock.
 */

struct ProgressStage: Equatable {
    let id: String
    let label: String
    let detail: String?

    /// What "never repeat a stage" compares: the stage and what it was about.
    var key: String { detail.map { "\(id):\($0.lowercased())" } ?? id }
}

struct ProgressSnapshot: Equatable {
    let startedAt: Date
    let stages: [ProgressStage]
    let done: Bool
}

enum VoiceProgressFile {
    /// The app's session ("orion-chat-<id>", "orion-app-v2") as the gateway names it, then the plugin's file name rule.
    /// Lowercased: the gateway lowercases session keys (`agent:main:orion-chat-9311fb49-…` for the app's
    /// `9311FB49-…` chat), and the plugin names the file from the gateway's key (review LOW).
    static func fileName(session: String) -> String {
        let lowered = session.lowercased()
        let full = lowered.hasPrefix("agent:") ? lowered : "agent:main:\(lowered)"
        let safe = String(full.unicodeScalars.map { scalar -> Character in
            let ok = CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || scalar == "." || scalar == "_" || scalar == "-"
            return ok ? Character(scalar) : "_"
        }).prefix(160)
        return (safe.isEmpty ? "unknown" : String(safe)) + ".json"
    }

    static func url(home: URL, session: String) -> URL {
        home.appendingPathComponent(".openclaw/orion-controlled/turn-progress", isDirectory: true)
            .appendingPathComponent(fileName(session: session))
    }

    /// The plugin's JSON, or nil when it is missing, unreadable, or from an earlier turn. The plugin's turn begins
    /// after the app sends (the CLI has to start first), so anything that began before this turn did — beyond a
    /// sub-second clock tolerance — is a previous turn's file (review LOW).
    static func parse(_ data: Data, notBefore: Date, skew: TimeInterval = 0.5) -> ProgressSnapshot? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let startedText = root["startedAt"] as? String,
              let started = isoDate(startedText),
              started.timeIntervalSince(notBefore) >= -skew
        else { return nil }
        let rows = root["stages"] as? [[String: Any]] ?? []
        let stages = rows.compactMap { row -> ProgressStage? in
            guard let id = row["stage"] as? String, let label = row["label"] as? String else { return nil }
            let detail = (row["detail"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return ProgressStage(id: id, label: label, detail: detail)
        }
        return ProgressSnapshot(startedAt: started, stages: stages, done: root["done"] as? Bool ?? false)
    }

    static func read(home: URL, session: String, notBefore: Date) -> ProgressSnapshot? {
        guard let data = try? Data(contentsOf: url(home: home, session: session)) else { return nil }
        return parse(data, notBefore: notBefore)
    }

    // Built once (review LOW): a formatter per read was the costliest part of a 4 Hz poll.
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let whole = ISO8601DateFormatter()
    private static let formatterLock = NSLock()

    private static func isoDate(_ text: String) -> Date? {
        formatterLock.lock(); defer { formatterLock.unlock() }
        return fractional.date(from: text) ?? whole.date(from: text)
    }
}

/// Reads the plugin's progress file off the main thread, once a second, and keeps the latest snapshot for the
/// companion's tick to read without touching the disk (review LOW).
final class VoiceProgressReader {
    private let queue = DispatchQueue(label: "com.nickmadaio.orion.voice-progress-read", qos: .utility)
    private let lock = NSLock()
    private var latest: ProgressSnapshot?
    private var timer: DispatchSourceTimer?

    var snapshot: ProgressSnapshot? {
        lock.lock(); defer { lock.unlock() }
        return latest
    }

    func start(read: @escaping () -> ProgressSnapshot?) {
        stop()
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now(), repeating: 1.0)
        source.setEventHandler { [weak self] in
            let value = read()
            guard let self else { return }
            self.lock.lock(); self.latest = value; self.lock.unlock()
        }
        timer = source
        source.resume()
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    deinit { timer?.cancel() }
}

enum VoiceProgressPhrases {
    /// The plugin's stage labels (`STAGE_LABELS` in turn-progress.ts), so their updates can be rendered ahead of time.
    static let knownLabels = [
        "working out what you need", "checking your calendar", "looking at tomorrow", "checking your to-dos",
        "checking what's due", "looking through my notes", "reading your messages", "checking your focus session",
        "making the change on your calendar",
        "putting the answer together", "double-checking the answer", "running a tool",
    ]
    /// Every fixed phrase an update or the handoff can say (a change with a named target is rendered when first needed).
    static var renderable: [String] {
        knownLabels.flatMap { label in openers.map { "\($0)\(label)." } } + [plain, handoff]
    }

    static let openers = ["Still on it — ", "Still going — ", "Bear with me — "]
    static let plain = "Still working on it."
    static let handoff = "This is taking longer than it should — I'll text you the answer when it's done."

    /// "checking your calendar", or for a change with a target, "making the change to Gym".
    static func describe(_ stage: ProgressStage) -> String {
        switch (stage.id, stage.detail) {
        case ("changing-calendar", let detail?): return "making the change to \(detail)"
        default: return stage.label
        }
    }

    static func line(for stage: ProgressStage, index: Int) -> String {
        openers[abs(index) % openers.count] + describe(stage) + "."
    }
}

/// The schedule of spoken updates for one voice turn. Immutable: `next` returns the action and the plan after it.
struct VoiceProgressPlan: Equatable {
    static let firstAfter: TimeInterval = 9
    static let interval: TimeInterval = 13
    static let maxUpdates = 3
    static let handoffAt: TimeInterval = 45
    /// The handoff waits for him to finish a sentence, but never past this (review HIGH 4).
    static let handoffHardLimit: TimeInterval = 50

    let spokenKeys: [String]
    let updates: Int
    let lastAt: TimeInterval?
    let plainUsed: Bool
    let handedOff: Bool

    static let start = VoiceProgressPlan(spokenKeys: [], updates: 0, lastAt: nil, plainUsed: false, handedOff: false)

    enum Action: Equatable {
        case none
        case update(text: String, stageKey: String?)
        case handoff(text: String)
    }

    /// When the next update may be spoken, from the end of his speech.
    var nextDue: TimeInterval {
        guard let lastAt else { return VoiceProgressPlan.firstAfter }
        return lastAt + VoiceProgressPlan.interval
    }

    /// One tick. `elapsed` is from the end of his speech; `stages` is what the plugin has written so far.
    /// `busy` is true while something is being said or he is talking: an update waits for its turn.
    func next(elapsed: TimeInterval, stages: [ProgressStage], replyReady: Bool, busy: Bool) -> (Action, VoiceProgressPlan) {
        if replyReady || handedOff { return (.none, self) }
        if elapsed >= VoiceProgressPlan.handoffAt {
            if busy && elapsed < VoiceProgressPlan.handoffHardLimit { return (.none, self) }
            let after = VoiceProgressPlan(spokenKeys: spokenKeys, updates: updates, lastAt: elapsed, plainUsed: plainUsed, handedOff: true)
            return (.handoff(text: VoiceProgressPhrases.handoff), after)
        }
        guard updates < VoiceProgressPlan.maxUpdates, elapsed >= nextDue, !busy else { return (.none, self) }
        // The newest stage he has not heard about. "understanding" is not news once anything else exists.
        if let stage = stages.reversed().first(where: { !spokenKeys.contains($0.key) && $0.id != "understanding" }) {
            let text = VoiceProgressPhrases.line(for: stage, index: updates)
            let after = VoiceProgressPlan(spokenKeys: spokenKeys + [stage.key], updates: updates + 1, lastAt: elapsed, plainUsed: plainUsed, handedOff: false)
            return (.update(text: text, stageKey: stage.key), after)
        }
        guard !plainUsed else { return (.none, self) }
        let after = VoiceProgressPlan(spokenKeys: spokenKeys, updates: updates + 1, lastAt: elapsed, plainUsed: true, handedOff: false)
        return (.update(text: VoiceProgressPhrases.plain, stageKey: nil), after)
    }
}

/// Drives one voice turn's cue, updates and handoff on a 0.25 s tick. The app gives it closures; it owns no audio
/// and no turn state of its own beyond the plan, so `AppState` stays the one place a turn is decided.
final class VoiceTurnCompanion {
    struct Hooks {
        /// The plugin's latest snapshot (read off the main thread by `VoiceProgressReader`).
        var progress: () -> ProgressSnapshot?
        /// Seconds since the mic last heard him speak, nil if not recently.
        var heardSpeechAgo: () -> TimeInterval?
        /// Something is playing (a cue or update).
        var isPlaying: () -> Bool
        /// Play the cue now; false if it could not start (not rendered yet: then there is no cue).
        var playCue: (String) -> Bool
        /// Say a progress update (rendered first if it has to be, dropped if that takes too long).
        var sayUpdate: (String) -> Void
        /// Show an update in the bubble.
        var show: (String) -> Void
        /// The 45 s handoff: speak it, then stop waiting aloud.
        var handOff: (String) -> Void
    }

    private let message: String
    private let hooks: Hooks
    private let startedAt: Date
    private var cuePlayed = false
    private var cueSkipped = false
    private var plan = VoiceProgressPlan.start
    private var timer: Timer?
    private(set) var replyReady = false
    private static var lastCue: String?
    private static var seed = Int.random(in: 0..<1000)

    init(message: String, startedAt: Date = Date(), hooks: Hooks) {
        self.message = message
        self.startedAt = startedAt
        self.hooks = hooks
    }

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
    }

    /// The reply is in (or the turn ended any other way): no more cue, no more updates.
    func stop() {
        replyReady = true
        timer?.invalidate()
        timer = nil
    }

    deinit { timer?.invalidate() }

    func tick(now: Date = Date()) {
        guard !replyReady else { return }
        let elapsed = now.timeIntervalSince(startedAt)
        let ago = hooks.heardSpeechAgo()
        if !cuePlayed && !cueSkipped {
            switch VoiceCuePolicy.decide(elapsed: elapsed, replyReady: replyReady, alreadyPlayed: cuePlayed, heardSpeechAgo: ago) {
            case .wait: return
            case .skip: cueSkipped = true
            case .play:
                let kind = VoiceCuePolicy.kind(for: message)
                VoiceTurnCompanion.seed += 1
                let phrase = VoiceCuePolicy.phrase(for: kind, avoiding: VoiceTurnCompanion.lastCue, seed: VoiceTurnCompanion.seed)
                VoiceTurnCompanion.lastCue = phrase
                cuePlayed = true
                _ = hooks.playCue(phrase)
                return
            }
        }
        let snapshot = hooks.progress()
        // The plugin says the turn is finished: the reply is on its way, so no update is started now (review LOW).
        let finishing = snapshot?.done == true
        let busy = finishing || hooks.isPlaying() || (ago.map { $0 < VoiceCuePolicy.quietFor } ?? false)
        let (action, after) = plan.next(elapsed: elapsed, stages: snapshot?.stages ?? [], replyReady: replyReady, busy: busy)
        plan = after
        switch action {
        case .none: break
        case .update(let text, _):
            hooks.show(text)
            hooks.sayUpdate(text)
        case .handoff(let text):
            stop()
            hooks.handOff(text)
        }
    }
}

/// Where a handed-off answer goes: his phone thread via orion-reach, and the Mac bubble exactly once.
///
/// "I'll text you" is a promise, so the text is never dropped by the gate: no `--no-queue` (a hold is queued and
/// released when the hold ends) and no `--urgent` (an answer never pings through his sleep). `--valid-until` is two
/// hours out, so an answer held overnight is not released stale in the morning (re-review MEDIUM b).
///
/// A phone delivery also opens `orion://reach` on the Mac, which shows the bubble; so the app shows its own bubble only
/// when the phone send did not go out (held, refused, failed, or orion-reach missing) — re-review MEDIUM a.
enum VoiceHandoff {
    static let validFor: TimeInterval = 2 * 60 * 60

    static func phoneCommand(answer: String, node: String, scriptsDir: String, now: Date = Date(), exists: (String) -> Bool) -> PhaseCommand? {
        let reach = scriptsDir + "/orion-reach"
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, exists(node), exists(reach) else { return nil }
        let formatter = ISO8601DateFormatter()
        return PhaseCommand(executable: node, arguments: [
            reach, text, "--kind", "update", "--channel", "phone",
            "--valid-until", formatter.string(from: now.addingTimeInterval(validFor)),
            "--why", "the answer to a spoken question that ran long",
        ])
    }

    enum PhoneOutcome: Equatable {
        /// Sent: orion-reach also posts it to the Mac bubble, so the app must not.
        case sent
        /// Held, refused or failed: the app shows the bubble itself.
        case notSent
    }

    /// orion-reach's own verdict: exit 0 with "Held — …" is queued, not sent; exit 3/4 is not sent.
    static func outcome(exitCode: Int32?, stdout: String) -> PhoneOutcome {
        guard exitCode == 0 else { return .notSent }
        let said = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if said.hasPrefix("Held") || said.hasPrefix("Still held") || said.hasPrefix("NOT SENT") || said.hasPrefix("Already said") { return .notSent }
        return .sent
    }

    /// Runs the command and returns its exit code and output (nil exit when it could not start or ran past `timeout`).
    static func run(_ command: PhaseCommand, timeout: TimeInterval = 20) -> (Int32?, String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.arguments
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return (nil, "") }
        let box = DataBox()
        let drained = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            box.data = out.fileHandleForReading.readDataToEndOfFile()
            drained.signal()
        }
        guard drained.wait(timeout: .now() + timeout) == .success else {
            process.terminate()
            return (nil, "")
        }
        process.waitUntilExit()
        return (process.terminationStatus, String(data: box.data, encoding: .utf8) ?? "")
    }
}
