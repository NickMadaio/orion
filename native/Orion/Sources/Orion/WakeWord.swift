import AVFoundation
import Foundation
import Speech

/*
 "Orion." — the only word this file is listening for.

 Four rules, enforced by the shape of this file rather than by convention:

 1. NOTHING LEAVES THE MACHINE. `SFSpeechRecognizer` with
    `requiresOnDeviceRecognition = true`, set unconditionally rather than "if
    supported": if this Mac cannot recognise on-device, the wake word refuses to
    run at all instead of quietly uploading the room. Nothing in this file
    imports, references or can reach `DeepgramStream`, and it never reads
    `VoiceSettings.stt`. Deepgram — when it is the chosen ear — is for the
    utterance AFTER the wake word, and `SpeechInput` is the object that owns
    that. The separation is structural: there is no code path from here to a
    network provider to disable.

 2. THERE IS NO SECOND MICROPHONE. This class cannot open one; it has no
    `AVAudioEngine` and no capture session. It is handed buffers by the single
    input tap `SpeechInput` already runs, which remains the only microphone
    session Orion ever has.

 3. IT IS DEAF WHILE ORION IS BUSY. `AppState` suspends it for every phase
    except `.idle`, and re-arming is delayed by `rearmDelay` afterwards. So
    Orion's own voice — and the room's echo of it — is never even transcribed,
    let alone matched. It cannot wake itself.

 4. SILENCE COSTS ALMOST NOTHING. No recogniser exists until the input RMS
    crosses a floor. Most of the day, this class does a floating-point compare
    per buffer and stops.

 Recognition runs in short rolling windows. `SFSpeechRecognizer` degrades over a
 long continuous session and Apple caps how long one may run, so a window is
 retired on `isFinal`, on error, on silence, and on a timer — always by standing
 the replacement up FIRST, so no buffer can fall between two windows. Exactly one
 task is alive at a time, and every callback is generation-checked, so a retired
 task cannot resurrect itself.
 */

// MARK: - Matching

/// What was heard after the wake word, in the same breath.
struct WakeHit {
    var command: String
}

enum WakeWord {

    /// The wake word as a human says it.
    static let phrase = "Orion"

    /// Fed to `contextualStrings` so the recogniser is biased towards hearing a
    /// name it would otherwise have no reason to expect.
    static let contextualStrings = ["Orion", "Hey Orion", "OK Orion"]

    /// What `SFSpeechRecognizer` ACTUALLY writes down when someone says "Orion".
    ///
    /// It is not a dictionary word, so the recogniser reaches for the nearest
    /// name it does know. These are the shapes it produces in practice, with
    /// apostrophes and spaces already stripped ("O'Ryan" → `oryan`, "oh Ryan" →
    /// `ohryan`). The list only has to cover the SHAPES — a candidate counts if
    /// it is within a short edit distance of any one of them, so near-misses of
    /// these near-misses are caught too, and the sensitivity preference is what
    /// decides how near is near enough.
    ///
    /// Every entry is at least five characters on purpose: `minimumLength`
    /// rejects anything shorter, which is what keeps ordinary words like "on",
    /// "or" and "Ryan" from ever being considered.
    static let acceptedVariants: [String] = [
        "orion",    // the real thing
        "oreon",
        "orian",
        "orien",
        "oryon",
        "oryan",    // "O'Ryan"
        "arion",
        "aurion",
        "aurian",
        "ohryan"    // "oh Ryan", rejoined
    ]

    /// A candidate shorter than this is never the wake word, whatever the
    /// sensitivity. Guards the short common words that would otherwise land one
    /// edit away from a variant.
    static let minimumLength = 5

    /// Finds the wake word anywhere in `text` and returns whatever followed it.
    ///
    /// `tolerance` is a fraction of the matched variant's length; see
    /// `WakeSensitivity`.
    static func find(in text: String, tolerance: Double) -> WakeHit? {
        // Split once, normalise in parallel, so index `i` means the same word in
        // both arrays and the tail can be rebuilt with its original punctuation
        // and capitalisation intact.
        let raw = text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !raw.isEmpty else { return nil }
        let tokens = raw.map(normalise)

        for i in tokens.indices {
            var end: Int?
            if matches(tokens[i], tolerance: tolerance) {
                end = i
            } else if i + 1 < tokens.count,
                      matches(tokens[i] + tokens[i + 1], tolerance: tolerance) {
                // The recogniser sometimes splits it: "oh Ryan", "O Ryan".
                end = i + 1
            }
            guard let end else { continue }
            let tail = end + 1 < raw.count
                ? raw[(end + 1)...].joined(separator: " ")
                : ""
            return WakeHit(command: tidy(tail))
        }
        return nil
    }

    /// Lowercased letters only: drops the punctuation the recogniser sprinkles
    /// in ("Orion," → `orion`) and the apostrophes in its guesses.
    static func normalise(_ word: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in word.lowercased().unicodeScalars where CharacterSet.letters.contains(scalar) {
            out.append(scalar)
        }
        return String(out)
    }

    static func matches(_ token: String, tolerance: Double) -> Bool {
        guard token.count >= minimumLength else { return false }
        let candidate = Array(token)
        for variant in acceptedVariants {
            let target = Array(variant)
            // A length gap this big is a different word, not a mishearing.
            guard abs(candidate.count - target.count) <= 2 else { continue }
            let allowed = Int((Double(target.count) * tolerance).rounded(.down))
            if editDistance(candidate, target, cap: allowed) <= allowed { return true }
        }
        return false
    }

    /// Levenshtein, two rows, with an early exit once every alignment in flight
    /// already costs more than `cap`.
    static func editDistance(_ a: [Character], _ b: [Character], cap: Int) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var previous = Array(0...b.count)
        var current = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            current[0] = i
            var rowMin = current[0]
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                current[j] = min(previous[j] + 1,
                                 min(current[j - 1] + 1, previous[j - 1] + cost))
                rowMin = min(rowMin, current[j])
            }
            if rowMin > cap { return rowMin }
            swap(&previous, &current)
        }
        return previous[b.count]
    }

    /// Trims the comma out of "Orion, what's on my calendar" and refuses tails
    /// too short to be a request.
    private static func tidy(_ tail: String) -> String {
        var text = tail.trimmingCharacters(in: .whitespacesAndNewlines)
        while let first = text.first, first == "," || first == "." || first == "—" || first == "-" {
            text.removeFirst()
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return text.count >= 2 ? text : ""
    }
}

// MARK: - Listener

final class WakeWordListener {

    /// Fires on the main thread when the wake word is heard. The payload is
    /// whatever followed it in the same recognition result, or nil.
    var onWake: ((String?) -> Void)?
    /// Something the user has to know before this can work.
    var onUnavailable: ((String) -> Void)?

    private(set) var isActive = false

    /// Set from `WakeSensitivity`.
    var tolerance: Double = WakeSensitivity.balanced.tolerance

    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// Bumped whenever a window is stood up or torn down. Every callback checks
    /// it, so a retired task can neither fire the wake word nor close a window
    /// that has already been replaced.
    private var generation = 0

    private var suspended = false
    private var armedAt = Date.distantPast
    private var lastFire = Date.distantPast
    private var windowOpenedAt = Date.distantPast
    private var lastLoudAt = Date.distantPast

    private var preroll: [AVAudioPCMBuffer] = []
    private var sweeper: Timer?

    /// Input RMS, on the same 0…1 scale `orionNormalisedLevel` produces, that
    /// counts as "someone is talking in this room". Below it, nothing is
    /// transcribed at all.
    private static let openLevel: Double = 0.18
    /// Hysteresis: once a window is open it takes less to hold it open.
    private static let holdLevel: Double = 0.11
    /// Quiet this long ends a window.
    private static let hangover: TimeInterval = 1.1
    /// Hard ceiling on one recognition window. `SFSpeechRecognizer` gets worse
    /// the longer a single session runs, so windows are short and cheap.
    private static let windowLimit: TimeInterval = 9
    /// A second trigger this soon after the first is the same utterance
    /// arriving twice. Ignore it.
    private static let retriggerGuard: TimeInterval = 2.5
    /// Dead time after Orion stops being busy, so the tail of its own reply and
    /// the room's echo of it cannot wake it.
    private static let rearmDelay: TimeInterval = 0.9
    /// ~100 ms of audio kept ahead of the gate, so the first syllable of
    /// "Orion" is not clipped off the front of the window that hears it.
    private static let prerollLimit = 5

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer()
    }

    /// Whether this Mac can do the only kind of wake detection Orion will ship.
    var canRunLocally: Bool {
        guard let recognizer else { return false }
        return recognizer.supportsOnDeviceRecognition
    }

    // MARK: Lifecycle

    func start() {
        guard !isActive else { return }
        guard let recognizer, recognizer.supportsOnDeviceRecognition else {
            onUnavailable?("Wake word needs on-device speech recognition, which this Mac cannot do for the current language. Leaving it off — Orion will not stream always-on audio anywhere instead.")
            return
        }
        _ = recognizer
        isActive = true
        armedAt = Date().addingTimeInterval(WakeWordListener.rearmDelay)
        lastLoudAt = .distantPast
        // Buffers drive everything that happens inside a window; this only
        // exists to close one that has gone quiet, which by definition is not
        // producing buffers worth acting on.
        sweeper = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.sweep()
        }
    }

    func stop() {
        isActive = false
        sweeper?.invalidate()
        sweeper = nil
        closeWindow()
        preroll.removeAll(keepingCapacity: false)
    }

    /// Deaf while Orion is listening, thinking, speaking or erroring. Suspension
    /// tears the window down rather than merely ignoring results, so Orion's own
    /// voice is never transcribed at all.
    func setSuspended(_ value: Bool) {
        guard value != suspended else { return }
        suspended = value
        if value {
            closeWindow()
            preroll.removeAll(keepingCapacity: true)
        } else {
            armedAt = Date().addingTimeInterval(WakeWordListener.rearmDelay)
            lastLoudAt = .distantPast
        }
    }

    // MARK: Audio

    /// One buffer from the shared input tap, with its level. Main thread.
    ///
    /// This is the only way audio reaches this class, and it is a push from
    /// `SpeechInput`. There is no pull, no engine and no device here.
    func observe(_ buffer: AVAudioPCMBuffer, level: Double) {
        guard isActive, !suspended else { return }
        let now = Date()
        guard now >= armedAt else { return }

        guard let request else {
            // Closed. Keep a breath of audio in hand, and open only on real
            // energy — this branch is what makes an empty room free.
            preroll.append(buffer)
            if preroll.count > WakeWordListener.prerollLimit { preroll.removeFirst() }
            if level >= WakeWordListener.openLevel { openWindow() }
            return
        }

        if level >= WakeWordListener.holdLevel { lastLoudAt = now }
        request.append(buffer)
    }

    // MARK: Windows

    /// Stands up a fresh recognition window and retires the outgoing one, in
    /// that order, so a buffer arriving between the two always has somewhere to
    /// go.
    private func openWindow() {
        guard let recognizer, recognizer.isAvailable else { return }

        let fresh = SFSpeechAudioBufferRecognitionRequest()
        fresh.shouldReportPartialResults = true
        // Not "if supported" — unconditional, and `start()` refuses to run at
        // all where it is unsupported. A wake word that can fall back to a
        // server is a different product from the one this is.
        fresh.requiresOnDeviceRecognition = true
        fresh.contextualStrings = WakeWord.contextualStrings
        fresh.addsPunctuation = false
        // Short spoken phrase, not dictation.
        fresh.taskHint = .search

        generation &+= 1
        let mine = generation
        let outgoingRequest = request
        let outgoingTask = task

        request = fresh
        windowOpenedAt = Date()
        lastLoudAt = Date()

        task = recognizer.recognitionTask(with: fresh) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.generation == mine else { return }
                if let result {
                    self.consider(result.bestTranscription.formattedString)
                    // `consider` may have fired and torn everything down.
                    guard self.generation == mine, result.isFinal else { return }
                    self.rotate()
                    return
                }
                if error != nil {
                    // A window always ends in an error after `endAudio`, so this
                    // is the ordinary path at least as often as it is a failure.
                    self.closeWindow()
                }
            }
        }

        outgoingRequest?.endAudio()
        outgoingTask?.cancel()

        let carried = preroll
        preroll.removeAll(keepingCapacity: true)
        for buffer in carried { fresh.append(buffer) }
    }

    /// A window ended by itself. Roll into a new one if the user is still
    /// talking, otherwise go back to costing nothing.
    private func rotate() {
        guard isActive, !suspended else {
            closeWindow()
            return
        }
        if Date().timeIntervalSince(lastLoudAt) < WakeWordListener.hangover {
            openWindow()
        } else {
            closeWindow()
        }
    }

    private func closeWindow() {
        guard request != nil || task != nil else { return }
        generation &+= 1
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }

    /// Closes a window that has gone quiet, and rolls one that has run long.
    private func sweep() {
        guard isActive, !suspended, request != nil else { return }
        let now = Date()
        if now.timeIntervalSince(lastLoudAt) >= WakeWordListener.hangover {
            closeWindow()
            return
        }
        if now.timeIntervalSince(windowOpenedAt) >= WakeWordListener.windowLimit {
            openWindow()
        }
    }

    // MARK: Deciding

    private func consider(_ text: String) {
        guard !text.isEmpty else { return }
        let now = Date()
        guard now.timeIntervalSince(lastFire) > WakeWordListener.retriggerGuard else { return }
        guard let hit = WakeWord.find(in: text, tolerance: tolerance) else { return }

        lastFire = now
        // This window has done its job. Tearing it down here means the words
        // that follow belong to `SpeechInput`, and only one recogniser is ever
        // reading the microphone.
        closeWindow()
        preroll.removeAll(keepingCapacity: true)
        onWake?(hit.command.isEmpty ? nil : hit.command)
    }
}
