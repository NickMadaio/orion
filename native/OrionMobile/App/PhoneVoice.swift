import AVFoundation
import MobileCore
import Speech
import SwiftUI

/*
 Talking to ORION by voice on the phone (2026-09-29).

 Nick: "i should be able to talk to orion through my phone via voice, not just
 text." Tap the mic, speak, pause: what he said is sent as a normal chat
 message, ORION's answer is read aloud, and it listens again -- a conversation,
 not a dictation box. Tap again to end.

 Recognition runs on the phone (on-device when the model is present), so
 nothing but the final sentence leaves it, and that goes the same way typed
 messages do. The answer is spoken by the phone's own voice, so it works
 whatever the Mac is doing.

 Turn-taking is deliberately simple and forgiving, because interrupting Nick is
 the complaint about the Mac: it waits for 1.6 seconds of silence after he has
 said something before it treats the turn as finished, and it never listens
 while it is speaking (no talking over, no hearing itself).
*/
@MainActor
final class PhoneVoice: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    enum Phase: Equatable { case off, listening, sending, waiting, speaking, unavailable(String) }

    @Published private(set) var phase: Phase = .off
    @Published private(set) var heard = ""
    @Published private(set) var level: Float = 0
    /// Why the last conversation ended, when it ended on its own or by "stop".
    @Published private(set) var endedBecause: String?

    /// The hard limits (6 Oct 2026): idle, 15 minutes, 30 turns, noise only.
    /// Nil whenever no conversation is live — nothing may listen or send then.
    private var sessionGuard: VoiceSessionGuard?
    private var guardTimer: Timer?

    /// Silence after speech that ends Nick's turn.
    private let endOfTurn: TimeInterval = 1.6
    /// The phone's own language (Nick's accent), not a fixed British one.
    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private let speaker = AVSpeechSynthesizer()
    private var send: ((String) -> Void)?
    private var awaitingReplyTo: String?
    /// Replies that landed before we knew which message was ours (the phone can
    /// answer instantly when the Mac is away, before `sent(id:)` is called).
    private var earlyReplies: [String: String] = [:]
    private var waitTimer: Timer?
    /// Recognition failures in a row with nothing heard; stops a tight retry loop.
    private var failures = 0
    private var startGeneration = UUID()
    /// Fall back to server recognition when the on-device model is missing.
    private var onDeviceFailed = false

    var active: Bool { phase != .off && !isUnavailable }
    private var isUnavailable: Bool { if case .unavailable = phase { return true }; return false }

    override init() {
        super.init()
        speaker.delegate = self
    }

    /// Start a voice conversation. `send` posts a chat message and returns its id.
    func start(send: @escaping (String) -> Void) async {
        let generation = UUID()
        startGeneration = generation
        self.send = send
        let permitted = await authorized()
        guard startGeneration == generation else { return }
        guard permitted else {
            phase = .unavailable("Allow Microphone and Speech Recognition for ORION in Settings to talk to him.")
            return
        }
        sessionGuard = VoiceSessionGuard(startedAt: Date())
        endedBecause = nil
        guardTimer?.invalidate()
        guardTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.enforceLimits() }
        }
        listen()
    }

    /// Ends the conversation and says why.
    func end(_ reason: VoiceStopReason) {
        let limits = sessionGuard?.limits ?? VoiceSessionLimits()
        let wasLive = sessionGuard != nil
        stop()
        if wasLive { endedBecause = VoiceSessionGuard.message(for: reason, limits: limits) }
    }

    /// Waiting for ORION or hearing him is not idleness; only the lifetime can
    /// end a conversation then.
    private func enforceLimits() {
        guard let current = sessionGuard else { return }
        let now = Date()
        let busy = phase == .sending || phase == .waiting || phase == .speaking
        let checked = busy ? current.markingActivity(at: now) : current
        sessionGuard = checked
        if let reason = checked.check(now: now) { end(reason) }
    }

    func stop() {
        guardTimer?.invalidate()
        guardTimer = nil
        sessionGuard = nil
        send = nil
        startGeneration = UUID()
        silenceTimer?.invalidate()
        waitTimer?.invalidate()
        earlyReplies = [:]
        failures = 0
        endRecognition()
        speaker.stopSpeaking(at: .immediate)
        awaitingReplyTo = nil
        phase = .off
        heard = ""
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Called by the conversation when a reply lands; speaks it if we are waiting for one.
    func replyArrived(id: String, text: String) {
        guard active else { return }
        guard awaitingReplyTo == id else {
            if phase == .sending { earlyReplies[id] = text }
            return
        }
        awaitingReplyTo = nil
        waitTimer?.invalidate()
        speak(text)
    }

    /// The conversation tells us which message our words became, so we know which reply to read.
    func sent(id: String) {
        guard phase == .sending else { return }
        awaitingReplyTo = id
        phase = .waiting
        if let early = earlyReplies.removeValue(forKey: id) { replyArrived(id: id, text: early); return }
        // Never wait forever: say so, and keep the conversation going.
        waitTimer?.invalidate()
        waitTimer = Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.phase == .waiting else { return }
                self.awaitingReplyTo = nil
                self.speak("That's taking a while. The answer will show up in the chat when it comes.")
            }
        }
    }

    // MARK: - Listening

    private func listen() {
        endRecognition()
        heard = ""
        do {
            let session = AVAudioSession.sharedInstance()
            // .default, not .voiceChat: voice-chat processing makes the spoken answers quiet.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer?.supportsOnDeviceRecognition == true && !onDeviceFailed { request.requiresOnDeviceRecognition = true }
            request.addsPunctuation = true
            self.request = request
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                request.append(buffer)
                let level = Self.rms(buffer)
                Task { @MainActor in self?.level = level }
            }
            engine.prepare()
            try engine.start()
            task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in self?.recognized(result, error) }
            }
            phase = .listening
        } catch {
            phase = .unavailable("The microphone could not start.")
        }
    }

    private func recognized(_ result: SFSpeechRecognitionResult?, _ error: Error?) {
        guard phase == .listening else { return }
        if let result {
            heard = result.bestTranscription.formattedString
            if !heard.trimmingCharacters(in: .whitespaces).isEmpty {
                sessionGuard = sessionGuard?.markingActivity(at: Date())
            }
            // Every new word restarts the end-of-turn clock.
            silenceTimer?.invalidate()
            if !heard.trimmingCharacters(in: .whitespaces).isEmpty {
                silenceTimer = Timer.scheduledTimer(withTimeInterval: endOfTurn, repeats: false) { [weak self] _ in
                    Task { @MainActor in self?.finishTurn() }
                }
            }
            failures = 0
            if result.isFinal { finishTurn() }
        } else if error != nil {
            if !heard.trimmingCharacters(in: .whitespaces).isEmpty { finishTurn(); return }
            // Recognition gives up after long silence; keep the conversation open —
            // but not in a tight loop when it cannot start at all.
            failures += 1
            if failures == 2 { onDeviceFailed = true }
            if failures >= 4 {
                endRecognition()
                phase = .unavailable("Speech recognition keeps failing on this iPhone. Check Settings ▸ General ▸ Keyboard ▸ Dictation, then try again.")
                return
            }
            let delay = Double(failures) * 0.8
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(delay))
                self.enforceLimits()
                if self.phase == .listening, self.sessionGuard != nil { self.listen() }
            }
        }
    }

    private func finishTurn() {
        guard phase == .listening else { return }
        silenceTimer?.invalidate()
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        endRecognition()
        guard let current = sessionGuard else { stop(); return }
        let (next, verdict) = current.judging(text, at: Date())
        sessionGuard = next
        switch verdict {
        case .send(let message):
            phase = .sending
            send?(message)
        case .discard:
            listen()
        case .stop(let reason):
            end(reason)
        }
    }

    private func endRecognition() {
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        level = 0
    }

    // MARK: - Speaking

    private func speak(_ text: String) {
        phase = .speaking
        let utterance = AVSpeechUtterance(string: Self.spoken(text))
        utterance.voice = Self.bestVoice()
        utterance.rate = 0.52
        utterance.pitchMultiplier = 0.95
        speaker.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            // Never re-listen after the conversation ended (the runaway).
            guard self.phase == .speaking, self.sessionGuard != nil else { return }
            self.sessionGuard = self.sessionGuard?.markingActivity(at: Date())
            self.listen()
        }
    }

    /// Markdown and links read badly aloud; say the words.
    static func spoken(_ text: String) -> String {
        var value = text
        for mark in ["**", "__", "`", "#", "> "] { value = value.replacingOccurrences(of: mark, with: "") }
        value = value.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
        value = value.replacingOccurrences(of: #"https?://\S+"#, with: "a link", options: .regularExpression)
        value = value.replacingOccurrences(of: #"(?m)^\s*[-•*]\s+"#, with: "", options: .regularExpression)
        return value
    }

    /// The best installed English voice: premium, then enhanced, then default.
    static func bestVoice() -> AVSpeechSynthesisVoice? {
        let english = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        let preferred = ["en-GB", "en-US"]
        for quality in [AVSpeechSynthesisVoiceQuality.premium, .enhanced] {
            for language in preferred {
                if let voice = english.first(where: { $0.quality == quality && $0.language == language }) { return voice }
            }
        }
        return AVSpeechSynthesisVoice(language: "en-GB")
    }

    // MARK: - Helpers

    private func authorized() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    nonisolated static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += data[index] * data[index] }
        return min(1, sqrt(sum / Float(buffer.frameLength)) * 12)
    }
}

/// The mic button and the "listening / thinking / speaking" strip above the keyboard.
struct VoiceBar: View {
    @ObservedObject var voice: PhoneVoice

    var body: some View {
        switch voice.phase {
        case .off:
            if let why = voice.endedBecause {
                Text(why).font(.system(size: 13)).foregroundStyle(Phone.dim).padding(.horizontal, 16)
            }
        case .unavailable(let why):
            Text(why).font(.system(size: 13)).foregroundStyle(Phone.orange).padding(.horizontal, 16)
        default:
            HStack(spacing: 12) {
                VoiceOrb(level: voice.level, phase: voice.phase)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Phone.mono(10, .semibold)).tracking(1.2).foregroundStyle(Phone.accent)
                    Text(voice.heard.isEmpty ? hint : voice.heard)
                        .font(.system(size: 14)).foregroundStyle(voice.heard.isEmpty ? Phone.dim : Phone.text).lineLimit(2)
                }
                Spacer()
                Button("End") { voice.stop() }.font(.system(size: 14, weight: .semibold)).foregroundStyle(Phone.soft)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
    }

    private var title: String {
        switch voice.phase {
        case .listening: return "LISTENING"
        case .sending, .waiting: return "ORION IS THINKING"
        case .speaking: return "ORION"
        default: return ""
        }
    }
    private var hint: String {
        switch voice.phase {
        case .listening: return "Talk. Pause when you're done."
        case .speaking: return "Speaking… tap End to stop"
        default: return "Sent to your Mac…"
        }
    }
}

struct VoiceOrb: View {
    let level: Float
    let phase: PhoneVoice.Phase
    var body: some View {
        let tint: Color = phase == .listening ? Phone.accent : phase == .speaking ? Phone.violet : Phone.soft
        ZStack {
            Circle().fill(tint.opacity(0.18)).scaleEffect(1 + CGFloat(level) * 0.6)
            Circle().fill(tint.opacity(0.9)).frame(width: 14, height: 14)
        }
        .frame(width: 34, height: 34)
        .animation(.easeOut(duration: 0.12), value: level)
    }
}
