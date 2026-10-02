import AVFoundation
import Foundation
import MobileCore

/*
 Deepgram streaming speech-to-text.

 AUDIO ONLY. This socket carries microphone bytes up and transcript text down.
 It never carries a request to a model and never touches the gateway; what the
 user said goes to `GatewayClient` exactly as it always has, after this class has
 turned it into a string.

 Flux v2 supplies semantic turn detection. TurnInfo updates carry the current
 transcript; EndOfTurn is authoritative. Apple recognition remains the local
 fallback when authentication, transport or audio conversion fails.

 Audio contract, chosen deliberately:
   • linear16 (int16 little-endian), mono, 16 000 Hz.
   • 16 kHz because Deepgram's models are trained for it, it is the standard ASR
     rate, and it is a third of the uplink bytes of the 48 kHz the Mac's input
     node hands us — on a slow uplink that difference is real latency. Nothing
     above 8 kHz of audio bandwidth carries information the model uses.
   • The conversion happens here, from the SAME buffers the existing input tap
     already produces. Orion opens exactly one microphone session, ever.

 The API key travels in the handshake, never in the URL. Two forms are tried,
 both documented by Deepgram: the `Authorization: Token …` header first, and the
 `Sec-WebSocket-Protocol: token, …` subprotocol as a fallback for the case where
 URLSession declines to send a custom Authorization header.
 */

enum DeepgramConfig {
    /// The rate we send at, and therefore the rate we tell Deepgram to expect.
    static let sampleRate: Double = 16000
    /// Resolved from the role contract; the constant remains the fallback so a
    /// missing contract cannot cost Orion its ears.
    static let model = ModelContract.model(role: "stt", fallback: fallbackModel)

    /// What `stt` was before the contract existed.
    static let fallbackModel = "flux-general-en"
    static let language = "en-US"
    /// Milliseconds of silence before Deepgram calls the utterance finished.
    ///
    /// Read live from `VoiceTuning` rather than fixed here. It was 300, which
    /// is shorter than the pause a person leaves mid-sentence, so Orion
    /// answered half-questions. The value is now a preference because the right
    /// number depends on how the speaker talks, and the only way to find it is
    /// to change it while talking. See `VoiceTuning.endpointingMs`.
    static var endpointingMs: Int { VoiceTuning.endpointingMs }
    /// Backstop for the case where endpointing does not fire. Deepgram's floor
    /// is 1000ms and values below it buy nothing. Always kept behind
    /// `endpointingMs` so it cannot pre-empt the primary signal.
    static var utteranceEndMs: Int { VoiceTuning.resolvedUtteranceEndMs }
    /// How long to wait for the socket to open before giving up on the cloud
    /// ear and handing this utterance to Apple's recogniser.
    static let openTimeout: TimeInterval = 1.5

    static func url() -> URL? {
        return FluxConfig().url()
    }
}

/// Converts the mic tap's native float buffers to the one format Deepgram is
/// told to expect. Kept separate from the socket so it can be reasoned about —
/// and, on a Mac with a toolchain, exercised — on its own.
final class LinearPCMConverter {

    private let target: AVAudioFormat
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?

    init?(sampleRate: Double = DeepgramConfig.sampleRate) {
        guard let target = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                         sampleRate: sampleRate,
                                         channels: 1,
                                         interleaved: true) else { return nil }
        self.target = target
    }

    /// int16 little-endian mono bytes, or nil if the buffer cannot be converted.
    func data(from buffer: AVAudioPCMBuffer) -> Data? {
        guard buffer.frameLength > 0 else { return nil }

        // The input device can change mid-session (headphones, a dock). Rebuild
        // the converter when the format underneath us moves rather than
        // producing garbage or crashing.
        if converter == nil || sourceFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: target)
            sourceFormat = buffer.format
        }
        guard let converter else { return nil }

        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
            return nil
        }

        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if supplied {
                // `.noDataNow`, NOT `.endOfStream`.
                //
                // This converter is cached across buffers so the resampler
                // keeps its state. Reporting `.endOfStream` retires it after
                // the very first buffer: every later call then produces zero
                // frames, `data(from:)` returns nil, and the audio is dropped
                // in silence. Deepgram stayed connected and heard nothing.
                //
                // `.noDataNow` means "that is all I have this instant" and
                // leaves the converter alive for the next buffer.
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        // With `.noDataNow`, a call can legitimately produce zero frames while
        // the resampler accumulates. That is not a failure — returning nil
        // there would look identical to the bug above.
        guard status != .error, conversionError == nil else { return nil }
        guard output.frameLength > 0 else { return Data() }
        guard let channel = output.int16ChannelData else { return nil }
        return Data(bytes: channel[0], count: Int(output.frameLength) * MemoryLayout<Int16>.size)
    }
}

/// One streaming recognition session.
///
/// Callbacks are always delivered on the main thread, matching `SpeechInput`.
final class DeepgramStream {

    enum Failure: LocalizedError {
        case badURL
        case socket(String)

        var errorDescription: String? {
            switch self {
            case .badURL: return "Could not build the Deepgram stream URL."
            case .socket(let message): return message
            }
        }
    }

    /// Interim transcript — the live text, same role as an `SFSpeechRecognizer`
    /// partial.
    var onPartial: ((String) -> Void)?
    /// A finalised segment. Several may arrive for one utterance.
    var onSegment: ((String) -> Void)?
    /// Deepgram's VAD says the speaker stopped. This is the latency win.
    var onEndOfSpeech: (() -> Void)?
    /// Utterance-level confidence for the CURRENT result, when Deepgram
    /// supplies one. Fired before `onPartial` for the same result — see
    /// `handleResults` — so a caller that stores it and reads it back inside
    /// `onPartial` sees the value for the same message. Not per-word; the
    /// closest thing the API gives without switching on `smart_format`'s
    /// word-level payload, and it is enough to serve as the "how sure was
    /// this ending" signal `AdaptiveEndpointModel` wants.
    var onConfidence: ((Double) -> Void)?
    /// The socket opened and is accepting audio.
    var onOpen: (() -> Void)?
    /// Anything that means "this session cannot serve" — the caller falls back.
    var onFailure: ((String) -> Void)?

    private(set) var isOpen = false
    /// Set by `finish()`. Once it is on, the next finalised result IS the end of
    /// the utterance — that is the whole point of sending `Finalize`, and
    /// waiting for a `speech_final` that may never come would give the latency
    /// straight back.
    private var finalizing = false
    private var finished = false
    private var failed = false
    private var attempt = 0

    /// Audio this socket declined to send, and when we last said so.
    private var refusedBuffers = 0
    private var lastRefusalLog = Date.distantPast
    private static let refusalLogInterval: TimeInterval = 2.0

    private let apiKey: String
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var openTimer: Timer?

    /// Finalised text so far, plus the newest interim on top. Deepgram sends a
    /// series of finalised segments for one held key, so the full utterance is
    /// their concatenation — not just the last one.
    private var settled: [String] = []
    private var interim = ""
    private var fluxTracker = FluxTurnTracker()

    init(apiKey: String) {
        self.apiKey = apiKey
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 15
        self.session = URLSession(configuration: configuration)
    }

    var transcript: String {
        let parts = settled + (interim.isEmpty ? [] : [interim])
        return parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Lifecycle

    func connect() {
        guard let url = DeepgramConfig.url() else {
            fail(Failure.badURL.localizedDescription)
            return
        }
        open(url: url, attempt: 0)

        openTimer?.invalidate()
        openTimer = Timer.scheduledTimer(withTimeInterval: DeepgramConfig.openTimeout,
                                         repeats: false) { [weak self] _ in
            guard let self, !self.isOpen else { return }
            self.fail("Deepgram did not answer in \(Int(DeepgramConfig.openTimeout * 1000))ms")
        }
    }

    private func open(url: URL, attempt: Int) {
        self.attempt = attempt
        let task: URLSessionWebSocketTask
        if attempt == 0 {
            // Server-side form, as documented for the Listen WebSocket.
            var request = URLRequest(url: url)
            request.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
            task = session.webSocketTask(with: request)
        } else {
            // Client-side form: the key rides the subprotocol list instead, for
            // stacks that refuse to send a custom Authorization header.
            task = session.webSocketTask(with: url, protocols: ["token", apiKey])
        }
        self.task = task
        task.resume()
        receive()
        // Deepgram considers the connection live once it starts answering. A
        // zero-length ping confirms the handshake without sending audio.
        task.sendPing { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.retryOrFail(url: url, message: error.localizedDescription)
                    return
                }
                guard !self.failed, !self.finished else { return }
                if !self.isOpen {
                    self.isOpen = true
                    self.openTimer?.invalidate()
                    self.onOpen?()
                }
            }
        }
    }

    private func retryOrFail(url: URL, message: String) {
        // The first attempt authenticates with a header. If URLSession dropped
        // it, or Deepgram refused it, the subprotocol form is the documented
        // alternative — worth exactly one retry before the local ear takes over.
        if attempt == 0 && !isOpen && !finished {
            task?.cancel(with: .goingAway, reason: nil)
            open(url: url, attempt: 1)
            return
        }
        fail(message)
    }

    /// Push-to-talk released: flush what Deepgram is holding, then close.
    func finish() {
        guard !finished else { return }
        finished = true
        finalizing = true
        openTimer?.invalidate()
        // `Finalize` makes Deepgram emit everything it is still buffering
        // immediately instead of waiting for more audio. `CloseStream` then ends
        // the session cleanly so the last words are never dropped.
        send(control: ["type": "CloseStream"])
    }

    /// Hard stop, no result wanted.
    func abort() {
        finished = true
        openTimer?.invalidate()
        openTimer = nil
        onPartial = nil
        onSegment = nil
        onEndOfSpeech = nil
        onOpen = nil
        onFailure = nil
        onConfidence = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isOpen = false
    }

    // MARK: Sending

    /// Audio refused here used to vanish without trace, which made a dead socket
    /// indistinguishable from a silent room — `SpeechInput` had already counted
    /// the bytes as sent by the time this decided not to send them. The counter
    /// and the throttled line are what make that visible; the guard itself is
    /// correct and stays.
    func send(audio: Data) {
        guard isOpen, !finished, !failed, let task else {
            noteRefused()
            return
        }
        task.send(.data(audio)) { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async {
                self?.fail("Deepgram stopped accepting audio: \(error.localizedDescription)")
            }
        }
    }

    /// One line every couple of seconds, not one per buffer at 40+/sec.
    private func noteRefused() {
        refusedBuffers += 1
        let now = Date()
        guard now.timeIntervalSince(lastRefusalLog) >= DeepgramStream.refusalLogInterval else { return }
        lastRefusalLog = now
        // `finished` is the ordinary path — `finish()` sets it and the tap keeps
        // producing for a moment afterwards — so it is named rather than
        // alarming. The other two are faults.
        let why = finished ? "stream finished" : (failed ? "stream failed" : "socket not open")
        OrionLog.write("[deepgram] refused \(refusedBuffers) audio chunk(s) — \(why)")
    }

    private func send(control object: [String: Any]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        // Control messages are TEXT frames. Sending them as binary would be
        // interpreted as audio and stall transcription.
        task.send(.string(text)) { _ in }
    }

    // MARK: Receiving

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                DispatchQueue.main.async {
                    guard !self.finished else { return }
                    if let url = DeepgramConfig.url(), !self.isOpen {
                        self.retryOrFail(url: url, message: error.localizedDescription)
                    } else {
                        self.fail(error.localizedDescription)
                    }
                }
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handle(text)
                case .data(let data):
                    self.handle(String(data: data, encoding: .utf8) ?? "")
                @unknown default:
                    break
                }
                self.receive()
            }
        }
    }

    private func handle(_ raw: String) {
        guard let message = FluxTurns.parse(raw) else { return }
        DispatchQueue.main.async {
            guard !self.failed else { return }
            switch message {
            case .connected:
                if !self.isOpen { self.isOpen = true; self.openTimer?.invalidate(); self.onOpen?() }
            case .error(_, let description): self.fail(description)
            case .turn:
                let decision = self.fluxTracker.absorb(message)
                self.interim = self.fluxTracker.transcript
                if !self.interim.isEmpty { self.onPartial?(self.interim) }
                if case .finish(let text) = decision { self.onSegment?(text); self.onEndOfSpeech?() }
            default: break
            }
        }
    }

    private func fail(_ message: String) {
        guard !failed else { return }
        failed = true
        openTimer?.invalidate()
        openTimer = nil
        let handler = onFailure
        onFailure = nil
        task?.cancel(with: .goingAway, reason: nil)
        handler?(message)
    }
}
