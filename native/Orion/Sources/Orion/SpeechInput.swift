import AVFoundation
import Foundation
import Speech

/*
 Microphone in, text out.

 `SFSpeechRecognizer` with an audio-buffer request, forced on-device where the
 installed locale supports it: lower latency, and nothing about what is said in
 this room leaves the machine. Orion is local-first and that is not a detail.

 The same `AVAudioEngine` input tap feeds two consumers — the recogniser and the
 hologram's level meter — so the sphere reacts to the voice that is actually
 being transcribed rather than to a second, separately-opened microphone.

 Callbacks are always delivered on the main thread.
 */
final class SpeechInput {

    var onPartial: ((String) -> Void)?
    var onFinal: ((String) -> Void)?
    var onLevel: ((Double) -> Void)?
    var onError: ((String) -> Void)?

    private(set) var isRunning = false

    private let engine = AVAudioEngine()
    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    private var latestText = ""
    private var awaitingFinal = false
    private var finalTimer: Timer?
    private var startGeneration = 0

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer()
    }

    // MARK: Permissions

    static var speechAuthorized: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    static var speechDenied: Bool {
        let status = SFSpeechRecognizer.authorizationStatus()
        return status == .denied || status == .restricted
    }

    static var microphoneAuthorized: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    static var microphoneDenied: Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        return status == .denied || status == .restricted
    }

    /// Asks for both permissions in the order the user will understand them.
    /// Denial produces a real message, never a silent no-op.
    func requestPermissions(_ completion: @escaping (Bool, String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    completion(false, "Orion needs Speech Recognition access to hear you. Turn it on in System Settings ▸ Privacy & Security ▸ Speech Recognition.")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        if granted {
                            completion(true, nil)
                        } else {
                            completion(false, "Orion needs Microphone access to hear you. Turn it on in System Settings ▸ Privacy & Security ▸ Microphone.")
                        }
                    }
                }
            }
        }
    }

    // MARK: Lifecycle

    func start() {
        guard !isRunning else { return }
        cancelPendingFinal()
        // A new press supersedes any utterance still waiting to be finalised.
        awaitingFinal = false

        guard let recognizer = recognizer else {
            onError?("Speech recognition is not available on this Mac.")
            return
        }
        guard recognizer.isAvailable else {
            onError?("Speech recognition is temporarily unavailable. Try again in a moment.")
            return
        }

        // Fast path: on every press after the first, both permissions are
        // already decided, so we skip the async round trip entirely.
        if SpeechInput.speechAuthorized && SpeechInput.microphoneAuthorized {
            begin(recognizer)
            return
        }

        startGeneration += 1
        let generation = startGeneration
        requestPermissions { [weak self] granted, message in
            guard let self, self.startGeneration == generation else { return }
            if granted {
                self.begin(recognizer)
            } else {
                self.onError?(message ?? "Orion could not get permission to listen.")
            }
        }
    }

    private func begin(_ recognizer: SFSpeechRecognizer) {
        guard !isRunning else { return }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // On-device keeps the audio local and removes the network round trip,
        // which is most of the interim-result latency.
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            onError?("No microphone input is available right now.")
            self.request = nil
            return
        }

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            // `request` is captured strongly on purpose: the tap owns it for as
            // long as it is installed, so there is nothing to race against.
            request.append(buffer)
            let level = orionNormalisedLevel(buffer)
            DispatchQueue.main.async {
                self?.onLevel?(level)
            }
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            self.request = nil
            onError?("Could not start the microphone: \(error.localizedDescription)")
            return
        }

        isRunning = true
        latestText = ""
        awaitingFinal = false

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if !text.isEmpty {
                        self.latestText = text
                        self.onPartial?(text)
                    }
                    if result.isFinal {
                        self.deliverFinal()
                    }
                    return
                }
                if error != nil {
                    // The task ends with an error on a clean `endAudio` too, so
                    // this is the normal path as often as it is the sad one.
                    if self.awaitingFinal {
                        self.deliverFinal()
                    } else if self.isRunning {
                        self.stopEngine()
                        self.isRunning = false
                        self.onError?("Dictation stopped unexpectedly. Hold Right Option and try again.")
                    }
                }
            }
        }
    }

    /// Release of push-to-talk: close the audio stream and give the recogniser a
    /// brief moment to promote the last partial to a final result.
    func stop() {
        guard isRunning else { return }
        isRunning = false
        awaitingFinal = true

        stopEngine()
        request?.endAudio()
        onLevel?(0)

        finalTimer?.invalidate()
        finalTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: false) { [weak self] _ in
            DispatchQueue.main.async { self?.deliverFinal() }
        }
    }

    /// Hard stop with no result — used when the panel closes or the app quits.
    func abort() {
        cancelPendingFinal()
        awaitingFinal = false
        isRunning = false
        stopEngine()
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        latestText = ""
        onLevel?(0)
    }

    private func stopEngine() {
        if engine.isRunning {
            engine.stop()
        }
        engine.inputNode.removeTap(onBus: 0)
    }

    private func cancelPendingFinal() {
        finalTimer?.invalidate()
        finalTimer = nil
    }

    private func deliverFinal() {
        guard awaitingFinal else { return }
        awaitingFinal = false
        cancelPendingFinal()

        let text = latestText.trimmingCharacters(in: .whitespacesAndNewlines)
        latestText = ""
        task?.finish()
        task = nil
        request = nil

        onFinal?(text)
    }
}
