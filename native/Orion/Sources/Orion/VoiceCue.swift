import AVFoundation
import Foundation

/*
 The instant acknowledgement (2026-10-23, Nick: "even if its a more intense question he should say hmmm let me
 think about that... or something like that").

 When he stops talking, ORION waits `VoiceCuePolicy.hold` (1.2 s). If the reply is already there it is simply
 spoken, with no cue in front of it. If not, a short canned phrase matched to the kind of request plays at once:
 "Let me look." for a lookup, "On it." for a calendar change, "Hmm, let me think about that." for a question that
 needs thought. No model is called for it. The phrases are rendered once by the TTS daemon (file mode, the same
 voice he hears for replies) into a small on-disk cache and played from there, so the cue starts in a few ms.

 A cue never talks over him: it is not started while the microphone hears speech, and his speech stops it
 (see `AppState.handleSpokenBargeIn`).
 */

enum CueKind: String, CaseIterable, Equatable {
    case lookup
    case change
    case think
    case generic
}

enum VoiceCuePolicy {
    /// How long to wait for the reply before saying anything. A reply that arrives within this is spoken bare.
    static let hold: TimeInterval = 1.2
    /// After this long from the end of his speech a cue is stale (he is mid-way through the next thought).
    static let staleAfter: TimeInterval = 4.0
    /// How recently the mic must have heard him for a cue to wait.
    static let quietFor: TimeInterval = 0.6

    static let phrases: [CueKind: [String]] = [
        .lookup: ["Let me look.", "Let me check.", "One sec, checking.", "Let me see."],
        .change: ["On it.", "Okay, on it.", "Sure, one sec.", "Got it, one sec."],
        .think: ["Hmm, let me think about that.", "Good question, give me a sec.", "Hmm, let me think.", "Let me think that through."],
        .generic: ["Mm, one sec.", "One moment.", "Give me a sec.", "Mm, one second."],
    ]

    static var allPhrases: [String] { CueKind.allCases.flatMap { phrases[$0] ?? [] } }

    private static let changeWords = #"\b(move|moving|add|put|schedule|reschedule|replan|cancel|delete|remove|push|shift|book|block|set|remind|change|make it|swap|clear|undo|start|stop)\b"#
    private static let thinkWords = #"\b(why|should i|should we|what do you think|how do i|how should|how can i|help me|plan|figure out|advice|explain|compare|better|best way|worth it|thoughts on|opinion)\b"#
    private static let lookupWords = #"\b(what|what's|whats|when|where|who|which|how many|how much|how long|do i have|is there|are there|check|look up|read|find|show|tell me|any)\b"#

    /// The kind of request, from his words alone. A change wins over a lookup ("check and move gym" is a change);
    /// a question that asks for judgement wins over both.
    static func kind(for text: String) -> CueKind {
        let lower = text.lowercased()
        func has(_ pattern: String) -> Bool { lower.range(of: pattern, options: .regularExpression) != nil }
        if has(thinkWords) { return .think }
        if has(changeWords) { return .change }
        if has(lookupWords) || lower.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("?") { return .lookup }
        return .generic
    }

    /// A phrase of this kind, never the one said last time. `seed` picks among the rest (tests pin it).
    static func phrase(for kind: CueKind, avoiding last: String?, seed: Int) -> String {
        let all = phrases[kind] ?? phrases[.generic]!
        let choices = all.filter { $0 != last }
        let pool = choices.isEmpty ? all : choices
        return pool[abs(seed) % pool.count]
    }

    enum Action: Equatable {
        case wait
        case play
        case skip
    }

    /// The cue decision, called on every tick of a voice turn. `elapsed` is from the end of his speech.
    /// - reply already here, or a cue already played: skip (never a cue in front of a ready answer).
    /// - before `hold`: wait.
    /// - he is talking: wait (the cue never talks over him), until it goes stale.
    static func decide(elapsed: TimeInterval, replyReady: Bool, alreadyPlayed: Bool, heardSpeechAgo: TimeInterval?) -> Action {
        if replyReady || alreadyPlayed { return .skip }
        if elapsed < hold { return .wait }
        if elapsed >= staleAfter { return .skip }
        if let ago = heardSpeechAgo, ago < quietFor { return .wait }
        return .play
    }
}

/// Callbacks waiting for a cue to end. Natural end fires them; an interruption (his voice, Escape) cancels them
/// without firing — review HIGH 1: stopping a cue must never start the answer over him.
final class CueWaiters {
    private var pending: [Int: () -> Void] = [:]
    private var nextID = 0

    var isEmpty: Bool { pending.isEmpty }

    @discardableResult
    func add(_ callback: @escaping () -> Void) -> Int {
        nextID += 1
        pending[nextID] = callback
        return nextID
    }

    /// The cue played to its end: everyone waiting goes on.
    func finishedNaturally() {
        let callbacks = pending.sorted { $0.key < $1.key }.map(\.value)
        pending = [:]
        callbacks.forEach { $0() }
    }

    /// He interrupted: nobody waiting goes on.
    func interrupted() { pending = [:] }

    /// One waiter's own time limit: fires it if it is still pending. Returns whether it fired.
    func contains(_ id: Int) -> Bool { pending[id] != nil }

    @discardableResult
    func expire(_ id: Int) -> Bool {
        guard let callback = pending.removeValue(forKey: id) else { return false }
        callback()
        return true
    }
}

/// A reply that landed while a cue or update was playing (review HIGH 1). Immutable: each step returns the next hold.
struct VoiceReplyHold: Equatable {
    /// The turn whose reply has landed (updates for it must never start after this).
    let landedGeneration: Int?
    /// The reply text waiting for the cue to end, if any.
    let heldText: String?

    static let empty = VoiceReplyHold(landedGeneration: nil, heldText: nil)

    enum Action: Equatable {
        case speakNow
        case waitForCue
    }

    func landed(generation: Int, text: String, cuePlaying: Bool) -> (Action, VoiceReplyHold) {
        cuePlaying
            ? (.waitForCue, VoiceReplyHold(landedGeneration: generation, heldText: text))
            : (.speakNow, VoiceReplyHold(landedGeneration: generation, heldText: nil))
    }

    func hasLanded(_ generation: Int) -> Bool { landedGeneration == generation }

    /// The cue ended on its own (or its wait ran out): the held reply is spoken.
    func cueEnded() -> (String?, VoiceReplyHold) {
        (heldText, VoiceReplyHold(landedGeneration: landedGeneration, heldText: nil))
    }

    /// He spoke or pressed Escape: the held reply stays in the bubble only (and is kept for "continue").
    func interrupted() -> (String?, VoiceReplyHold) {
        (heldText, VoiceReplyHold(landedGeneration: landedGeneration, heldText: nil))
    }
}

/// Voice turns handed off at 45 s whose answers are still due (review HIGH 2: back-to-back handoffs each get theirs).
struct HandoffLedger: Equatable {
    let pending: Set<Int>
    static let empty = HandoffLedger(pending: [])
    func adding(_ generation: Int) -> HandoffLedger { HandoffLedger(pending: pending.union([generation])) }
    /// True exactly once per handed-off turn.
    func claiming(_ generation: Int) -> (Bool, HandoffLedger) {
        pending.contains(generation) ? (true, HandoffLedger(pending: pending.subtracting([generation]))) : (false, self)
    }
}

/// Whether he is talking, from recognised words only (review HIGH 4). Raw mic level is not speech: a kitchen at
/// 0.4-0.87 would otherwise hold back the cue, every update and the handoff. ORION's own phrase, while it plays and
/// just after, is not him.
struct VoiceActivity: Equatable {
    let lastWordsAt: Date?
    static let none = VoiceActivity(lastWordsAt: nil)
    static let ownEchoTail: TimeInterval = 0.5
    static let window: TimeInterval = 5

    func heardWords(at: Date, cuePlaying: Bool, cueEndedAt: Date) -> VoiceActivity {
        if cuePlaying || at.timeIntervalSince(cueEndedAt) < VoiceActivity.ownEchoTail { return self }
        return VoiceActivity(lastWordsAt: at)
    }

    /// Seconds since he last spoke, nil when not in the last few seconds.
    func heardSpeechAgo(now: Date) -> TimeInterval? {
        guard let lastWordsAt else { return nil }
        let ago = now.timeIntervalSince(lastWordsAt)
        return ago >= 0 && ago < VoiceActivity.window ? ago : nil
    }
}

/// One attempt of the launch render: whether to try again once it settles (a failure, or a phrase it had to skip
/// because it was already being rendered on demand). Main thread only.
final class RenderRound {
    private var left: Set<String> = []
    private var failed = false
    private var skipped = false

    /// Returns true when nothing could be taken this round (all already rendering): try again later.
    func begin(taken: [String], wanted: [String]) -> Bool {
        left = Set(taken)
        skipped = Set(taken).count < Set(wanted).count
        return taken.isEmpty
    }

    /// Returns true when this was the last phrase of the round and the round needs another go.
    func finish(_ text: String, ok: Bool) -> Bool {
        guard left.remove(text) != nil else { return false }
        if !ok { failed = true }
        return left.isEmpty && (failed || skipped)
    }
}

/// Plays short pre-rendered phrases (cues and progress updates) outside `SpeechOutput`, so a cue never ends the
/// speaking phase or opens the ear for a follow-up. Main thread only.
final class VoiceCuePlayer: NSObject, AVAudioPlayerDelegate {

    /// What is playing right now ("" when nothing is); the barge-in echo check reads it.
    private(set) var currentText = ""
    private(set) var lastText = ""
    private(set) var lastEndedAt = Date.distantPast
    var isPlaying: Bool { player?.isPlaying ?? false }

    private var player: AVAudioPlayer?
    private let waiters = CueWaiters()
    private let renderQueue = DispatchQueue(label: "com.nickmadaio.orion.voice-cue-render", qos: .utility)
    private var rendering = Set<String>()

    private let cacheDir: URL
    private let provider: () -> String
    /// Renders one phrase to a file; runs on the render queue. The daemon by default; tests pass their own.
    private let renderer: (_ text: String, _ url: URL, _ provider: String) -> Bool

    init(cacheDir: URL = VoiceCuePlayer.defaultCacheDir, socketPath: String = TTSClient.socketPath,
         provider: @escaping () -> String = { VoiceSettings.tts.daemonProvider },
         renderer: ((String, URL, String) -> Bool)? = nil) {
        self.cacheDir = cacheDir
        self.provider = provider
        self.renderer = renderer ?? { text, url, voice in VoiceCuePlayer.render(text: text, to: url, provider: voice, socketPath: socketPath) }
    }

    static var defaultCacheDir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Orion/voice-cues", isDirectory: true)
    }

    /// The cache file for a phrase in the current voice. Stable across launches (FNV-1a, not `hashValue`).
    func fileURL(for text: String) -> URL {
        cacheDir.appendingPathComponent("\(provider())-\(VoiceCuePlayer.stableHash(text)).wav")
    }

    static func stableHash(_ text: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return String(hash, radix: 16)
    }

    /// Smallest file that can hold a WAV header and any audio at all.
    static let minimumBytes = 64

    /// Cheap, main-thread check: the file is there and big enough. Whether it decodes is checked off the main
    /// thread by `prepare` (re-review LOW), and `play` deletes a file AVAudioPlayer cannot open.
    func isRendered(_ text: String) -> Bool {
        VoiceCuePlayer.looksPresent(fileURL(for: text))
    }

    private static func looksPresent(_ url: URL) -> Bool {
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        return size >= minimumBytes
    }

    /// Render-queue check: present, big enough and decodes. A bad file is deleted so it is rendered again (MEDIUM 7).
    private static func isGood(_ url: URL) -> Bool {
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        if looksPresent(url), let file = try? AVAudioFile(forReading: url), file.length > 0 { return true }
        try? FileManager.default.removeItem(at: url)
        OrionLog.write("[cue] removed a damaged cached phrase — it will be rendered again")
        return false
    }

    /// Checks each phrase's file off the main thread (decode included) and renders the missing or damaged ones,
    /// one at a time. A phrase already being rendered is skipped. Returns the phrases this call took; `rendered`
    /// fires on the main thread once for each of them, with whether it is now cached.
    @discardableResult
    func prepare(_ texts: [String], rendered: ((String, Bool) -> Void)? = nil) -> [String] {
        let taken = Array(NSOrderedSet(array: texts.filter { !rendering.contains($0) })) as? [String] ?? []
        guard !taken.isEmpty else { return [] }
        taken.forEach { rendering.insert($0) }
        let jobs = taken.map { ($0, fileURL(for: $0)) }
        let dir = cacheDir
        let voice = provider()
        let render = renderer
        renderQueue.async { [weak self] in
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for (text, url) in jobs {
                let ok = VoiceCuePlayer.isGood(url) || (render(text, url, voice) && VoiceCuePlayer.looksPresent(url))
                DispatchQueue.main.async {
                    self?.rendering.remove(text)
                    rendered?(text, ok)
                }
            }
        }
        return taken
    }

    /// The launch render, retried while the TTS daemon is not up yet (MEDIUM 7). Stops once everything is cached
    /// or after `attempts` tries. A phrase already being rendered on demand does not stall it: that phrase is
    /// simply looked at again on the next attempt (re-review LOW). `onAttempt` is for tests.
    func prepareUntilReady(_ texts: [String], retryEvery: TimeInterval = 60, attempts: Int = 10, onAttempt: ((Int, Int) -> Void)? = nil) {
        attemptRender(texts, number: 1, checkAll: true, retryEvery: retryEvery, attempts: attempts, onAttempt: onAttempt)
    }

    private func attemptRender(_ texts: [String], number: Int, checkAll: Bool, retryEvery: TimeInterval, attempts: Int,
                               onAttempt: ((Int, Int) -> Void)?) {
        let missing = texts.filter { !isRendered($0) }
        onAttempt?(number, missing.count)
        // The first pass checks every file (decode included, off main); later passes only what still looks missing.
        let wanted = checkAll ? texts : missing
        guard !wanted.isEmpty, number <= attempts else { return }
        let next = { [weak self] in
            DispatchQueue.main.asyncAfter(deadline: .now() + retryEvery) {
                self?.attemptRender(texts, number: number + 1, checkAll: false, retryEvery: retryEvery, attempts: attempts, onAttempt: onAttempt)
            }
        }
        let round = RenderRound()
        let taken = prepare(wanted) { text, ok in
            if round.finish(text, ok: ok) { next() }
        }
        // Callbacks arrive on a later main-queue turn, so the round is set up before any of them.
        if round.begin(taken: taken, wanted: wanted) { next() }
    }

    /// For an update or the handoff: play now if cached, else render it first and play it if it is still wanted
    /// within `within` seconds. A cue uses `play` instead: a late "one sec" is worse than none.
    func playSoon(_ text: String, within: TimeInterval, stillWanted: @escaping () -> Bool) {
        if play(text) { return }
        let asked = Date()
        prepare([text]) { [weak self] done, ok in
            guard let self, ok, done == text, stillWanted(), Date().timeIntervalSince(asked) <= within else { return }
            self.play(text)
        }
    }

    /// Daemon file mode: one request, one `{"ok": true, "output": ...}` frame. Written to a temp name and moved
    /// into place, so a half-written file is never played. Returns whether the phrase is now cached.
    private static func render(text: String, to url: URL, provider: String, socketPath: String) -> Bool {
        let temp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).\(getpid()).tmp.wav")
        do {
            let connection = try UnixSocketConnection(path: socketPath, timeout: 20)
            defer { connection.closeSocket() }
            try connection.send(json: ["op": "synth", "text": text, "output": temp.path, "provider": provider])
            guard let frame = try connection.readFrame(), frame["ok"] as? Bool == true,
                  FileManager.default.fileExists(atPath: temp.path) else {
                try? FileManager.default.removeItem(at: temp)
                return false
            }
            try? FileManager.default.removeItem(at: url)
            try FileManager.default.moveItem(at: temp, to: url)
            return true
        } catch {
            try? FileManager.default.removeItem(at: temp)
            OrionLog.write("[cue] could not render a phrase — \(error.localizedDescription)")
            return false
        }
    }

    /// Plays a cached phrase now. Returns false when it is not cached (and starts rendering it for next time):
    /// a cue that would arrive late is worse than none.
    @discardableResult
    func play(_ text: String) -> Bool {
        guard isRendered(text) else {
            prepare([text])
            return false
        }
        let url = fileURL(for: text)
        if player != nil { cut() }
        guard let next = try? AVAudioPlayer(contentsOf: url) else {
            try? FileManager.default.removeItem(at: url)
            prepare([text])
            return false
        }
        next.delegate = self
        next.prepareToPlay()
        guard next.play() else { return false }
        player = next
        currentText = text
        lastText = text
        OrionLog.write("[cue] \"\(text)\"")
        return true
    }

    /// Barge-in or Escape: silence now, and whatever was waiting for the cue to end is cancelled, never started.
    func stop() {
        waiters.interrupted()
        cut()
    }

    /// Calls `then` when the phrase ends on its own, or after `atMost` seconds (the phrase is cut for the reply).
    /// Never called if `stop()` interrupts first.
    func whenQuiet(atMost: TimeInterval, then: @escaping () -> Void) {
        guard isPlaying else { return then() }
        let id = waiters.add(then)
        DispatchQueue.main.asyncAfter(deadline: .now() + atMost) { [weak self] in
            guard let self else { return }
            // Its own limit: cut the phrase only if this waiter is still the one pending.
            guard self.waiters.contains(id) else { return }
            self.cut()
            self.waiters.expire(id)
        }
    }

    /// Ends playback without firing or cancelling waiters.
    private func cut() {
        guard let current = player else { return }
        current.stop()
        player = nil
        currentText = ""
        lastEndedAt = Date()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.player === player else { return }
            self.player = nil
            self.currentText = ""
            self.lastEndedAt = Date()
            self.waiters.finishedNaturally()
        }
    }
}
