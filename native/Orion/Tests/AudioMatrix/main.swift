//
//  Gate 1 — the audio observation matrix.
//
//  THIS IS AN EXPERIMENT, NOT A FIX. It exists to find out whether a claim is
//  true, and "the baseline is fine" is a valid and welcome answer.
//
//  The claim, written in SpeechOutput.swift:50-64 and used there to justify
//  tearing the engine down 1.5 s after every reply: a running AVAudioEngine
//  pins the shared output device to 24 kHz mono and drags the rest of the Mac
//  down with it. If that is true, Nick cannot have binaural audio and a talking
//  assistant at the same time without one wrecking the other. If it is false,
//  the 1.5 s release timer is solving nothing and the real design is free.
//
//  What is actually measured, at six points through each run, is the DEVICE —
//  nominal sample rate and output channel count straight from CoreAudio, which
//  is shared by every process on the machine. The engine's own opinion of its
//  format is recorded alongside, because where the two disagree is informative.
//
//  Three candidates, per the plan:
//
//    A — what ships today. player -> mainMixerNode at a hardcoded 24 kHz mono
//        format (SpeechOutput.swift:244), mixer tap at nil format.
//        NOTE: the plan calls A "the current implicit connection". That is not
//        what the code does. The connection is explicit and the format is
//        hardcoded. A models the real graph, not the described one.
//    B — player -> outputNode directly, at the file's own format.
//    C — player -> mainMixerNode at nil, mainMixerNode -> outputNode at the
//        hardware format, plus configuration-change handling.
//
//  Throughout every candidate, two things Nick actually cares about are live:
//  a 48 kHz STEREO fixture playing from a SEPARATE engine — standing in for the
//  binaural clip, and for "the rest of the Mac" the claim is about — and
//  microphone capture with a tap, standing in for the wake word. Neither is
//  decoration: the pass criterion is that the wake word keeps working AND audio
//  sounds normal, at the same time.
//
//    ./Tests/run-audio-matrix.sh [--candidate A|B|C] [--seconds N]
//
//  Exits non-zero only if a candidate leaves the device degraded after it is
//  done. A candidate that degrades the device WHILE running is reported loudly
//  but is not by itself a failure — that is the finding, not a bug in the test.
//

import Foundation
import AVFoundation

// MARK: - Options

struct Options {
    var candidates: [String] = ["A", "B", "C"]
    var playSeconds: Double = 3.0
    var captureWakeWord = true
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = Array(CommandLine.arguments.dropFirst())
    while let argument = arguments.first {
        arguments.removeFirst()
        switch argument {
        case "--candidate":
            guard let value = arguments.first else { break }
            arguments.removeFirst()
            options.candidates = [value.uppercased()]
        case "--seconds":
            guard let value = arguments.first, let seconds = Double(value) else { break }
            arguments.removeFirst()
            options.playSeconds = seconds
        case "--no-capture":
            options.captureWakeWord = false
        default:
            break
        }
    }
    return options
}

// MARK: - Signal generation

/// 440 Hz in the left ear, 880 Hz in the right, at the device's own rate.
///
/// Two different frequencies rather than a panned single tone: if the graph
/// collapses the stream to mono, the two sum into one buffer and the per-channel
/// peaks stop being distinguishable. Identical tones would survive a collapse
/// looking exactly the same.
func stereoFixture(rate: Double, seconds: Double) -> AVAudioPCMBuffer? {
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                     sampleRate: rate,
                                     channels: 2,
                                     interleaved: false) else { return nil }
    let frames = AVAudioFrameCount(rate * seconds)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
          let channels = buffer.floatChannelData else { return nil }
    buffer.frameLength = frames

    for frame in 0..<Int(frames) {
        let t = Double(frame) / rate
        channels[0][frame] = Float(sin(2 * .pi * 440 * t) * 0.25)
        channels[1][frame] = Float(sin(2 * .pi * 880 * t) * 0.25)
    }
    return buffer
}

/// A stand-in for a TTS chunk: 24 kHz mono float32, exactly the format
/// SpeechOutput hardcodes at line 43-46.
func speechFixture(seconds: Double) -> AVAudioPCMBuffer? {
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                     sampleRate: 24000,
                                     channels: 1,
                                     interleaved: false) else { return nil }
    let frames = AVAudioFrameCount(24000 * seconds)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
          let channels = buffer.floatChannelData else { return nil }
    buffer.frameLength = frames

    // Roughly voice-shaped: a 180 Hz carrier under a 4 Hz syllable envelope. The
    // shape does not affect the device measurement; it makes the run audible as
    // speech-like rather than as a test tone, which matters when Nick listens.
    for frame in 0..<Int(frames) {
        let t = Double(frame) / 24000
        let envelope = 0.5 * (1 - cos(2 * .pi * 4 * t))
        channels[0][frame] = Float(sin(2 * .pi * 180 * t) * 0.2 * envelope)
    }
    return buffer
}

// MARK: - The observation log

final class Observations {
    private(set) var rows: [(stage: String, reading: DeviceReading?,
                             input: DeviceReading?, engine: String)] = []
    private let baseline: DeviceReading?

    init(baseline: DeviceReading?) {
        self.baseline = baseline
    }

    func record(_ stage: String, engine: String = "") {
        rows.append((stage, HALDevice.defaultOutput(), HALDevice.defaultInput(), engine))
    }

    func table() -> String {
        var lines: [String] = []
        for row in rows {
            let device = row.reading.map {
                String(format: "%6.0f Hz %d ch", $0.nominalSampleRate, $0.outputChannels)
            } ?? " (unreadable)"
            let input = row.input.map {
                String(format: "%6.0f Hz %d ch", $0.nominalSampleRate, $0.outputChannels)
            } ?? " (unreadable)"
            let flag = degraded(row.reading) ? " <-- MOVED" : "          "
            lines.append("    \(row.stage.padding(toLength: 20, withPad: " ", startingAt: 0))"
                         + "\(device)\(flag)  \(input)   \(row.engine)")
        }
        return lines.joined(separator: "\n")
    }

    func degraded(_ reading: DeviceReading?) -> Bool {
        guard let baseline, let reading else { return false }
        return DeviceReading.degraded(from: baseline, to: reading)
    }

    /// The one that decides the exit code: did the device come back?
    var endedDegraded: Bool { degraded(rows.last?.reading) }

    var everDegraded: Bool { rows.contains { degraded($0.reading) } }
}

// MARK: - Wake-word capture

/// Microphone capture with a tap, mirroring SpeechInput.swift:316-338 — the
/// input node at its own format, 1024-frame buffers, level computed per buffer.
/// Not a copy of the wake-word recogniser; the point is only that capture is
/// genuinely running and delivering buffers while the output graph is under
/// test, because that is Nick's stated requirement.
final class CaptureProbe {
    private let engine = AVAudioEngine()
    private(set) var buffersSeen = 0
    private(set) var peakLevel: Float = 0
    private(set) var failure: String?
    private(set) var inputFormat: String = "not started"

    func start() -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        guard status == .authorized else {
            failure = "microphone not authorised for this process (status \(status.rawValue)) — "
                    + "capture NOT live for this run"
            return false
        }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            failure = "input node reported a zero format — capture NOT live"
            return false
        }
        inputFormat = "\(Int(format.sampleRate)) Hz \(format.channelCount) ch"

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self, let channel = buffer.floatChannelData?[0] else { return }
            var peak: Float = 0
            for frame in 0..<Int(buffer.frameLength) {
                peak = max(peak, abs(channel[frame]))
            }
            DispatchQueue.main.async {
                self.buffersSeen += 1
                self.peakLevel = max(self.peakLevel, peak)
            }
        }

        do {
            engine.prepare()
            try engine.start()
            return true
        } catch {
            failure = "capture engine failed to start: \(error.localizedDescription)"
            engine.inputNode.removeTap(onBus: 0)
            return false
        }
    }

    func stop() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }
}

// MARK: - The stereo neighbour

/// A second, entirely separate AVAudioEngine playing 48 kHz stereo.
///
/// Separate on purpose. The claim under test is that Orion's engine degrades the
/// device for EVERYTHING, so the victim has to be something Orion does not own.
/// This models both the binaural clip and any other app making noise.
final class StereoNeighbour {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private(set) var format: String = "not started"
    private(set) var failure: String?

    func start(rate: Double, seconds: Double) -> Bool {
        guard let fixture = stereoFixture(rate: rate, seconds: seconds) else {
            failure = "could not build the stereo fixture at \(rate) Hz"
            return false
        }
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: fixture.format)
        format = "\(Int(fixture.format.sampleRate)) Hz \(fixture.format.channelCount) ch"

        do {
            engine.prepare()
            try engine.start()
            player.scheduleBuffer(fixture, at: nil, options: .loops, completionHandler: nil)
            player.play()
            return true
        } catch {
            failure = "stereo neighbour failed to start: \(error.localizedDescription)"
            return false
        }
    }

    /// What the neighbour's own output looks like now — the thing that would
    /// change if the device collapsed underneath it.
    func liveFormat() -> String {
        guard engine.isRunning else { return "(stopped)" }
        let output = engine.outputNode.outputFormat(forBus: 0)
        return "\(Int(output.sampleRate)) Hz \(output.channelCount) ch"
    }

    func stop() {
        player.stop()
        if engine.isRunning { engine.stop() }
    }
}

// MARK: - Candidates

/// One candidate output graph, built and torn down around a measured run.
final class Candidate {
    let name: String
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var configurationChanges = 0
    private var observer: NSObjectProtocol?

    init(name: String) {
        self.name = name
    }

    /// Every candidate watches for configuration change. Only C acts on it;
    /// A and B count it so the report can say whether an unhandled change
    /// happened at all.
    private func watchConfiguration(handle: Bool) {
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.configurationChanges += 1
            guard handle, !self.engine.isRunning else { return }
            try? self.engine.start()
        }
    }

    func build(speech: AVAudioPCMBuffer) throws {
        engine.attach(player)

        switch name {
        case "A":
            // Exactly SpeechOutput.swift:241-252 as it ships.
            engine.connect(player, to: engine.mainMixerNode, format: speech.format)
            engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { _, _ in }
            watchConfiguration(handle: false)

        case "B":
            // Straight to the output node at the buffer's own format. Note this
            // graph can carry exactly one source: outputNode has a single input
            // bus, so a second player cannot join it. That is a real constraint
            // on B, not a limitation of the harness.
            engine.connect(player, to: engine.outputNode, format: speech.format)
            watchConfiguration(handle: false)

        case "C":
            // nil lets the mixer track whatever the device is doing; the mixer's
            // own connection to the output is stated explicitly at the hardware
            // format, and configuration changes are handled rather than counted.
            let hardware = engine.outputNode.outputFormat(forBus: 0)
            engine.connect(player, to: engine.mainMixerNode, format: nil)
            engine.connect(engine.mainMixerNode, to: engine.outputNode, format: hardware)
            watchConfiguration(handle: true)

        default:
            throw NSError(domain: "AudioMatrix", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "unknown candidate \(name)"
            ])
        }

        engine.prepare()
        try engine.start()
    }

    /// Set when the candidate could not take the 24 kHz mono chunk as-is.
    private(set) var conversionRequired: String?

    /// Schedule the speech chunk, converting first if the candidate's own graph
    /// will not accept it.
    ///
    /// This is where candidate C shows its price. Connecting the player with a
    /// nil format makes it adopt the hardware format, so scheduling a 24 kHz
    /// mono buffer on it raises an exception rather than being resampled by the
    /// mixer. C is still implementable — SpeechOutput.swift:286-306 already has
    /// the converter — but it moves resampling from the mixer to us, on every
    /// chunk, which is exactly the responsibility transfer the plan warned about.
    func play(_ speech: AVAudioPCMBuffer) {
        let wanted = player.outputFormat(forBus: 0)
        var buffer = speech

        if wanted.sampleRate != speech.format.sampleRate
            || wanted.channelCount != speech.format.channelCount {
            conversionRequired = "\(Int(speech.format.sampleRate))/\(speech.format.channelCount)"
                + " -> \(Int(wanted.sampleRate))/\(wanted.channelCount)"
            guard let converted = convert(speech, to: wanted) else {
                conversionRequired = (conversionRequired ?? "") + " FAILED"
                return
            }
            buffer = converted
        }

        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        player.play()
    }

    private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let converter = AVAudioConverter(from: buffer.format, to: format) else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            return nil
        }

        var delivered = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if delivered {
                status.pointee = .endOfStream
                return nil
            }
            delivered = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil ? output : nil
    }

    /// The engine's own account of itself, for comparison against the device.
    func formats() -> String {
        guard engine.isRunning else { return "engine stopped" }
        let output = engine.outputNode.outputFormat(forBus: 0)
        var text = "out \(Int(output.sampleRate))/\(output.channelCount)"
        if name != "B" {
            let mixer = engine.mainMixerNode.outputFormat(forBus: 0)
            text += "  mixer \(Int(mixer.sampleRate))/\(mixer.channelCount)"
        }
        if configurationChanges > 0 { text += "  cfgChanges \(configurationChanges)" }
        return text
    }

    func teardown() {
        player.stop()
        if name == "A", engine.isRunning { engine.mainMixerNode.removeTap(onBus: 0) }
        if engine.isRunning { engine.stop() }
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }
}

// MARK: - One run

func settle(_ seconds: Double) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

@discardableResult
func run(candidate name: String, options: Options) -> Bool {
    print("\n=== CANDIDATE \(name) " + String(repeating: "=", count: 46))

    guard let baseline = HALDevice.defaultOutput() else {
        print("  CoreAudio would not name a default output device. Cannot measure; skipping.")
        return false
    }
    let log = Observations(baseline: baseline)
    print("  device        : \(baseline.summary)")
    print("  accepts 24 kHz: \(HALDevice.supports(rate: 24000, on: baseline.deviceID))")

    log.record("0 baseline")

    // The neighbour and the microphone come up first and stay up for the whole
    // candidate, because the question is what the candidate does TO them.
    let neighbour = StereoNeighbour()
    let neighbourLive = neighbour.start(rate: baseline.nominalSampleRate, seconds: 1.0)
    if let failure = neighbour.failure { print("  stereo        : \(failure)") }
    else { print("  stereo        : playing \(neighbour.format) on its own engine") }
    settle(0.4)
    log.record("1 stereo playing", engine: "neighbour \(neighbour.liveFormat())")

    let capture = CaptureProbe()
    var captureLive = false
    if options.captureWakeWord {
        captureLive = capture.start()
        if let failure = capture.failure { print("  capture       : \(failure)") }
        else { print("  capture       : live at \(capture.inputFormat)") }
    } else {
        print("  capture       : disabled by --no-capture")
    }
    settle(0.4)
    log.record("2 capture live", engine: "neighbour \(neighbour.liveFormat())")

    guard let speech = speechFixture(seconds: options.playSeconds) else {
        print("  could not build the 24 kHz speech fixture; skipping")
        neighbour.stop(); capture.stop()
        return false
    }

    let candidate = Candidate(name: name)
    do {
        try candidate.build(speech: speech)
    } catch {
        print("  BUILD FAILED  : \(error.localizedDescription)")
        neighbour.stop(); capture.stop()
        return false
    }
    settle(0.4)
    log.record("3 engine started", engine: candidate.formats())

    candidate.play(speech)
    settle(min(1.0, options.playSeconds / 2))
    log.record("4 speech playing", engine: candidate.formats())

    settle(options.playSeconds)
    log.record("5 speech done", engine: candidate.formats())

    candidate.teardown()
    settle(0.6)
    log.record("6 engine stopped", engine: "neighbour \(neighbour.liveFormat())")

    let buffers = capture.buffersSeen
    let peak = capture.peakLevel
    capture.stop()
    neighbour.stop()
    settle(0.4)
    log.record("7 all stopped")

    print("\n  stage               OUTPUT device          INPUT device    engine")
    print(log.table())

    print("")
    if captureLive {
        let verdict = buffers > 0 ? "kept delivering" : "STOPPED DELIVERING"
        print("  wake-word capture : \(verdict) — \(buffers) buffers, peak \(String(format: "%.3f", peak))")
    } else {
        print("  wake-word capture : NOT LIVE this run — this run does not test Nick's requirement")
    }
    if neighbourLive {
        print("  stereo neighbour  : ended at \(neighbour.liveFormat())")
    }
    if let conversion = candidate.conversionRequired {
        print("  chunk conversion  : REQUIRED by this graph — \(conversion)")
    } else {
        print("  chunk conversion  : none — the graph took 24 kHz mono as-is")
    }
    print("  device during run : \(log.everDegraded ? "MOVED at least once" : "held steady")")
    print("  device at the end : \(log.endedDegraded ? "STILL DEGRADED" : "back to baseline")")

    return !log.endedDegraded
}

// MARK: - Main

let options = parseOptions()

print(String(repeating: "=", count: 64))
print("Gate 1 — audio observation matrix")
print(String(repeating: "=", count: 64))

if let device = HALDevice.defaultOutput() {
    print("\nDefault output : \(device.summary)")
    let rates = device.availableSampleRates
        .map { $0.lowerBound == $0.upperBound
                 ? "\(Int($0.lowerBound))"
                 : "\(Int($0.lowerBound))-\(Int($0.upperBound))" }
        .joined(separator: ", ")
    print("Accepted rates : \(rates.isEmpty ? "(none reported)" : rates)")
    if !HALDevice.supports(rate: 24000, on: device.deviceID) {
        print("""

              NOTE: this device does not accept 24 kHz at all, so it cannot be
              pinned there. Any degradation seen below is something else.
              """)
    }

    if let input = HALDevice.defaultInput() {
        print("Default input  : \(input.summary)")
    }
    if HALDevice.inputAndOutputShareADevice() {
        print("""

              NOTE: input and output are THE SAME DEVICE. On a Bluetooth headset
              this is the condition that forces the link from A2DP into HFP when
              the microphone opens — stereo becomes mono, the rate collapses, and
              the music turns to mud. Watch the INPUT column at "capture live".
              If that is what happens, no output graph fixes it.
              """)
    }
} else {
    print("\nCoreAudio would not name a default output device.")
    exit(2)
}

var failures: [String] = []
for name in options.candidates {
    if !run(candidate: name, options: options) { failures.append(name) }
}

print("\n" + String(repeating: "=", count: 64))
if failures.isEmpty {
    print("All candidates returned the device to baseline.")
    exit(0)
}
print("Left the device degraded: \(failures.joined(separator: ", "))")
exit(1)
