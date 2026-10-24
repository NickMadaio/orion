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
    /// Input above this level counts as him speaking (same scale as `orionNormalisedLevel`; BargeInMonitor opens at 0.14).
    static let speechLevel: Double = 0.14
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

/// Plays short pre-rendered phrases (cues and progress updates) outside `SpeechOutput`, so a cue never ends the
/// speaking phase or opens the ear for a follow-up. Main thread only.
final class VoiceCuePlayer: NSObject, AVAudioPlayerDelegate {

    /// What is playing right now ("" when nothing is); the barge-in echo check reads it.
    private(set) var currentText = ""
    private(set) var lastText = ""
    private(set) var lastEndedAt = Date.distantPast
    var isPlaying: Bool { player?.isPlaying ?? false }

    private var player: AVAudioPlayer?
    private var finished: (() -> Void)?
    private var token = 0
    private let renderQueue = DispatchQueue(label: "com.nickmadaio.orion.voice-cue-render", qos: .utility)
    private var rendering = Set<String>()

    private let cacheDir: URL
    private let provider: () -> String

    init(cacheDir: URL = VoiceCuePlayer.defaultCacheDir, provider: @escaping () -> String = { VoiceSettings.tts.daemonProvider }) {
        self.cacheDir = cacheDir
        self.provider = provider
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

    func isRendered(_ text: String) -> Bool {
        FileManager.default.fileExists(atPath: fileURL(for: text).path)
    }

    /// Renders any phrase not yet cached, one at a time, off the main thread. Safe to call repeatedly.
    /// `rendered` fires on the main thread once per phrase this call rendered (or failed to).
    func prepare(_ texts: [String], rendered: ((String) -> Void)? = nil) {
        let missing = texts.filter { !isRendered($0) && !rendering.contains($0) }
        guard !missing.isEmpty else { return }
        missing.forEach { rendering.insert($0) }
        let jobs = missing.map { ($0, fileURL(for: $0)) }
        let dir = cacheDir
        let voice = provider()
        renderQueue.async { [weak self] in
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for (text, url) in jobs {
                VoiceCuePlayer.render(text: text, to: url, provider: voice)
                DispatchQueue.main.async {
                    self?.rendering.remove(text)
                    rendered?(text)
                }
            }
        }
    }

    /// For an update or the handoff: play now if cached, else render it first and play it if it is still wanted
    /// within `within` seconds. A cue uses `play` instead: a late "one sec" is worse than none.
    func playSoon(_ text: String, within: TimeInterval, stillWanted: @escaping () -> Bool) {
        if play(text) { return }
        let asked = Date()
        prepare([text]) { [weak self] done in
            guard let self, done == text, stillWanted(), Date().timeIntervalSince(asked) <= within else { return }
            self.play(text)
        }
    }

    /// Daemon file mode: one request, one `{"ok": true, "output": ...}` frame. Written to a temp name and moved
    /// into place, so a half-written file is never played.
    private static func render(text: String, to url: URL, provider: String) {
        let temp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).\(getpid()).tmp.wav")
        do {
            let connection = try UnixSocketConnection(path: TTSClient.socketPath, timeout: 20)
            defer { connection.closeSocket() }
            try connection.send(json: ["op": "synth", "text": text, "output": temp.path, "provider": provider])
            guard let frame = try connection.readFrame(), frame["ok"] as? Bool == true,
                  FileManager.default.fileExists(atPath: temp.path) else {
                try? FileManager.default.removeItem(at: temp)
                return
            }
            try? FileManager.default.removeItem(at: url)
            try FileManager.default.moveItem(at: temp, to: url)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            OrionLog.write("[cue] could not render a phrase — \(error.localizedDescription)")
        }
    }

    /// Plays a cached phrase now. Returns false (and starts rendering it for next time) when it is not cached yet:
    /// a cue that would arrive late is worse than none.
    @discardableResult
    func play(_ text: String, finished: (() -> Void)? = nil) -> Bool {
        let url = fileURL(for: text)
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        stop()
        guard let next = try? AVAudioPlayer(contentsOf: url) else { return false }
        token += 1
        next.delegate = self
        next.prepareToPlay()
        guard next.play() else { return false }
        player = next
        currentText = text
        lastText = text
        self.finished = finished
        OrionLog.write("[cue] \"\(text)\"")
        return true
    }

    /// Barge-in, or the reply taking over. Immediate.
    func stop() {
        guard let player else { return }
        player.stop()
        self.player = nil
        end()
    }

    /// Calls `then` once nothing is playing, or after `atMost` seconds (then the phrase is cut).
    func whenQuiet(atMost: TimeInterval, then: @escaping () -> Void) {
        guard isPlaying else { return then() }
        let mine = token
        var fired = false
        let once = { if !fired { fired = true; then() } }
        let previous = finished
        finished = { previous?(); once() }
        DispatchQueue.main.asyncAfter(deadline: .now() + atMost) { [weak self] in
            guard let self, !fired else { return }
            if self.token == mine { self.stop() }
            once()
        }
    }

    private func end() {
        currentText = ""
        lastEndedAt = Date()
        let callback = finished
        finished = nil
        callback?()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.player === player else { return }
            self.player = nil
            self.end()
        }
    }
}
