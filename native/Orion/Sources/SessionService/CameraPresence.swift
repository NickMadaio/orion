//
//  Is he at the desk? Asked of the camera, briefly, and almost never.
//
//  This is the most invasive thing in the whole build and it is built to be
//  boring. Four constraints, all from the plan, none negotiable:
//
//    • SAMPLED, NOT STREAMED. The session opens the camera, takes one frame,
//      and closes it. ~1.5 s of capture per 90 s of session, which is under two
//      percent duty cycle. There is no continuous feed at any point.
//    • NOTHING IS KEPT. The frame becomes one number — a brightness-variance
//      estimate of whether a person-shaped thing is in front of the lens — and
//      is discarded in the same function. No image is written, buffered, sent,
//      or held past the call.
//    • THE GREEN LIGHT IS NOT SUPPRESSED, and could not be: the camera
//      indicator is wired to the sensor in hardware on every Mac that has one.
//      That is stated here because it is the actual guarantee — not a promise in
//      code, a property of the machine. If the light is on, the camera is on. If
//      Orion were ever lying about this, the light would say so.
//    • OFF BY DEFAULT, and it stays off until Nick turns it on.
//
//  What it is FOR is narrow, and worth being honest about: it distinguishes
//  "away from the desk" from "at the desk and thinking", which idle time alone
//  cannot. It does NOT tell Orion what he is doing, and it is not face
//  recognition — it cannot tell Nick from anyone else, and it is not supposed to.
//

import Foundation
import AVFoundation
import CoreImage

public enum PresenceReading: Equatable, Sendable {
    case present
    case absent
    /// Could not look. Never guessed at — an unavailable camera must not read
    /// as "he is not there", which would nag him for a permission problem.
    case unavailable(String)

    public var isPresent: Bool { self == .present }
}

public final class CameraPresence {

    /// How much of each interval the camera is actually on.
    public static let sampleDuration: TimeInterval = 1.5
    public static let sampleInterval: TimeInterval = 90

    /// Off until Nick turns it on. Deliberately not persisted here — the
    /// setting lives with the other preferences, and this object simply refuses
    /// to do anything until it is switched on.
    public private(set) var isEnabled = false

    public private(set) var lastReading: PresenceReading = .unavailable("not sampled yet")
    public private(set) var lastSampledAt: Date?

    /// The longest this may keep sampling without being told to start again.
    ///
    /// Belt and braces, and it exists because the braces already failed once: a
    /// caller decided a stale session was "live" and this object dutifully
    /// sampled the camera every ninety seconds for six days. It had no opinion
    /// about that, which was the problem — the most invasive thing in the app
    /// should not depend entirely on somebody else's boolean being right.
    ///
    /// Four hours is longer than any plausible session and far shorter than
    /// "forever", which is the only number that actually matters here.
    public static let maximumRun: TimeInterval = 4 * 3600

    /// When sampling must stop regardless of what anyone says. Set by the
    /// caller at start; a nil deadline means the cap applies from `start()`.
    public var deadline: Date?

    public var onLog: ((String) -> Void)?

    private let queue = DispatchQueue(label: "com.nickmadaio.orion.presence")
    private var timer: DispatchSourceTimer?
    private var onReading: ((PresenceReading) -> Void)?

    public init() {}

    deinit { stop() }

    // MARK: Consent

    /// Whether macOS will let us look, without asking.
    public static var authorization: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .video)
    }

    public static var isAuthorized: Bool { authorization == .authorized }

    /// Ask. Only ever called from a control Nick operates.
    public static func requestAccess(_ completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    /// What to show before it is switched on. The duty cycle is stated in
    /// numbers rather than adjectives, because "occasionally" is not something
    /// somebody can evaluate.
    public static var disclosure: String {
        "Orion can check whether you are at the desk by taking a single camera "
        + "frame every \(Int(sampleInterval)) seconds — about "
        + "\(String(format: "%.1f", sampleDuration)) seconds of camera time per sample, "
        + "under two percent of the session. No image is saved, buffered or sent; each "
        + "frame becomes one number and is discarded. The green camera light is wired to "
        + "the sensor in hardware, so it will be on whenever Orion is looking, and there "
        + "is no way for any app to prevent that. Off unless you turn it on."
    }

    // MARK: Running

    public func start(onReading: @escaping (PresenceReading) -> Void) {
        guard isEnabled else { return }
        guard Self.isAuthorized else {
            let reading = PresenceReading.unavailable(
                "Camera access has not been granted, so Orion cannot tell whether you are "
                + "at the desk."
            )
            lastReading = reading
            onReading(reading)
            return
        }

        self.onReading = onReading
        timer?.cancel()

        if deadline == nil { deadline = Date().addingTimeInterval(Self.maximumRun) }

        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now() + 1, repeating: Self.sampleInterval, leeway: .seconds(5))
        source.setEventHandler { [weak self] in self?.sampleOnce() }
        source.resume()
        timer = source

        onLog?("[presence] sampling every \(Int(Self.sampleInterval))s")
    }

    public func stop() {
        timer?.cancel()
        timer = nil
        onReading = nil
    }

    public func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        if !enabled {
            deadline = nil
            stop()
            lastReading = .unavailable("presence checking is off")
            onLog?("[presence] off")
        }
    }

    // MARK: One frame

    /// Open, grab, close. The session is torn down in the same call that built
    /// it, so the camera cannot be left running by any path through this code —
    /// including the error paths, which is why every exit runs through `finish`.
    private func sampleOnce() {
        // The cap, checked before the lens opens rather than after.
        if let deadline, Date() >= deadline {
            onLog?("[presence] stopping — ran past its \(Int(Self.maximumRun / 3600))-hour cap "
                   + "without being restarted")
            stop()
            lastReading = .unavailable("presence checking stopped — no session restarted it")
            return
        }
        guard isEnabled else { return }

        let session = AVCaptureSession()
        session.sessionPreset = .low   // the smallest frame that can answer this

        var finished = false
        func finish(_ reading: PresenceReading) {
            guard !finished else { return }
            finished = true
            if session.isRunning { session.stopRunning() }
            self.lastReading = reading
            self.lastSampledAt = Date()
            if let onReading = self.onReading {
                DispatchQueue.main.async { onReading(reading) }
            }
        }

        guard let device = AVCaptureDevice.default(for: .video) else {
            return finish(.unavailable("No camera on this Mac."))
        }
        guard let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            return finish(.unavailable("The camera could not be opened — it may be in use."))
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        let collector = FrameCollector { [weak self] reading in
            self?.queue.async { finish(reading) }
        }
        output.setSampleBufferDelegate(collector, queue: queue)
        guard session.canAddOutput(output) else {
            return finish(.unavailable("The camera produced no output."))
        }
        session.addOutput(output)

        session.startRunning()

        // The hard stop. Whatever happens, the camera is off after this — a
        // sampler that can be left running by a delegate that never fires is
        // exactly the thing this design exists to make impossible.
        queue.asyncAfter(deadline: .now() + Self.sampleDuration) {
            finish(collector.reading ?? .unavailable("No frame arrived in time."))
        }
    }
}

// MARK: - The one frame

/// Turns a frame into a single boolean-ish number and throws the frame away.
///
/// Deliberately crude: average luminance and its variance across a coarse grid.
/// A desk with nobody at it is flat and unchanging; a person in front of the
/// lens breaks that up. It cannot identify anybody, cannot read a screen, and is
/// not trying to — anything more capable would be a bigger promise to keep.
private final class FrameCollector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {

    private(set) var reading: PresenceReading?
    private let completion: (PresenceReading) -> Void
    private var reported = false

    init(completion: @escaping (PresenceReading) -> Void) {
        self.completion = completion
    }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard !reported, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        reported = true

        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddress(pixels) else {
            return completion(.unavailable("The frame could not be read."))
        }
        let width = CVPixelBufferGetWidth(pixels)
        let height = CVPixelBufferGetHeight(pixels)
        let stride = CVPixelBufferGetBytesPerRow(pixels)
        let bytes = base.assumingMemoryBound(to: UInt8.self)

        // A coarse grid, not the whole frame. Enough to tell "something is
        // there" from "flat wall", and far too little for anything else.
        var samples: [Double] = []
        let step = 16
        for y in Swift.stride(from: 0, to: height, by: step) {
            for x in Swift.stride(from: 0, to: width, by: step) {
                samples.append(Double(bytes[y * stride + x * 4 + 1]))  // green channel
            }
        }
        guard samples.count > 4 else {
            return completion(.unavailable("The frame was too small to judge."))
        }

        let mean = samples.reduce(0, +) / Double(samples.count)
        let variance = samples.reduce(0) { $0 + pow($1 - mean, 2) } / Double(samples.count)

        // The frame goes out of scope here and is never copied anywhere.
        let present = variance > 220 && mean > 12
        let result: PresenceReading = present ? .present : .absent
        self.reading = result
        completion(result)
    }
}
