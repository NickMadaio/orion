//
//  Rain, waves and wind, made rather than downloaded.
//
//  Synthesised on purpose. The binaural bed plays clip FILES, and the failure
//  mode of that design is already in this codebase — "The Binaural track is
//  unavailable" — because a folder can be empty, a file can be moved, and a
//  break that starts in silence because an asset went missing is a break that
//  quietly stopped working. Filtered noise cannot go missing. It ships as about
//  a hundred lines, weighs nothing, and sounds like weather.
//
//  Everything here runs on the audio render thread, which has exactly one rule:
//  no allocation, no locks, no Swift runtime calls that might do either. So the
//  oscillator state lives in one heap block allocated up front and mutated
//  through a pointer, and the random numbers come from an inline xorshift
//  rather than from `arc4random`.
//
//  The output format is READ FROM THE DEVICE rather than assumed. Something else
//  in this app pins the shared output to 24 kHz mono, and a source node
//  configured for 48 kHz stereo against that device does not error — it just
//  produces nothing, silently, which is the worst possible way for this to fail.
//

import AVFoundation
import Foundation

enum Ambience: String, CaseIterable, Identifiable, Sendable {
    case none, rain, waves, wind

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: return "Silence"
        case .rain: return "Rain"
        case .waves: return "Waves"
        case .wind: return "Wind"
        }
    }

    /// How much of the noise survives the low-pass, 0...1. Lower is further
    /// away and heavier; higher is closer and brighter.
    var cutoff: Float {
        switch self {
        case .none: return 0
        case .rain: return 0.42
        case .waves: return 0.05
        case .wind: return 0.14
        }
    }

    /// Seconds per swell, and how deep the swell goes.
    var swell: (period: Float, depth: Float) {
        switch self {
        case .none: return (1, 0)
        case .rain: return (11, 0.12)
        case .waves: return (9.5, 0.55)
        case .wind: return (6.5, 0.34)
        }
    }
}

final class AmbientSound {

    private struct State {
        var lowpass: Float = 0
        var lowpass2: Float = 0
        var phase: Float = 0
        var gain: Float = 0
        var targetGain: Float = 0
        var cutoff: Float = 0.2
        var swellRate: Float = 0
        var swellDepth: Float = 0
        var seed: UInt32 = 0x1234_5678
        var sampleRate: Float = 48_000
    }

    private let engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private let state = UnsafeMutablePointer<State>.allocate(capacity: 1)

    /// Quiet. This plays under a screen whose job is to be restful, and ambience
    /// that announces itself is just noise with better marketing.
    var volume: Float = 0.18 {
        didSet { if playing != .none { state.pointee.targetGain = volume } }
    }

    private(set) var playing: Ambience = .none
    var onLog: ((String) -> Void)?

    init() { state.initialize(to: State()) }

    deinit {
        engine.stop()
        state.deinitialize(count: 1)
        state.deallocate()
    }

    // MARK: Control

    func start(_ ambience: Ambience) {
        guard ambience != .none else { return stop() }

        state.pointee.cutoff = ambience.cutoff
        let swell = ambience.swell
        state.pointee.swellDepth = swell.depth

        if playing != .none {
            // Already running — cross into the new weather rather than
            // restarting the engine, which clicks.
            state.pointee.swellRate = 1 / max(0.001, swell.period)
            playing = ambience
            return
        }

        // The DEVICE's rate and channel count, but always in the standard
        // deinterleaved float32 layout.
        //
        // Taking the device format verbatim is what segfaulted the first
        // version: hardware formats can be interleaved, and a render block that
        // writes `out[frame]` into each buffer is writing past the end of a
        // buffer that holds both channels braided together. Asking for the
        // standard format keeps the rate (which is the part that must match the
        // device — see the note at the top of this file) and lets the engine do
        // the conversion it is there to do.
        let device = engine.outputNode.outputFormat(forBus: 0)
        guard device.sampleRate > 0, device.channelCount > 0,
              let format = AVAudioFormat(standardFormatWithSampleRate: device.sampleRate,
                                         channels: device.channelCount)
        else {
            onLog?("[ambient] no usable output format — staying silent")
            return
        }
        state.pointee.sampleRate = Float(format.sampleRate)
        state.pointee.swellRate = 1 / max(0.001, swell.period)
        state.pointee.gain = 0
        state.pointee.targetGain = volume

        let pointer = state
        let node = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let s = pointer

            for frame in 0..<Int(frameCount) {
                // xorshift32 — cheap, deterministic, allocation-free.
                s.pointee.seed ^= s.pointee.seed << 13
                s.pointee.seed ^= s.pointee.seed >> 17
                s.pointee.seed ^= s.pointee.seed << 5
                let white = Float(Int32(bitPattern: s.pointee.seed)) / Float(Int32.max)

                // Two one-pole passes: one filter sounds like static, two sound
                // like something outside.
                s.pointee.lowpass += s.pointee.cutoff * (white - s.pointee.lowpass)
                s.pointee.lowpass2 += s.pointee.cutoff * (s.pointee.lowpass - s.pointee.lowpass2)

                // The swell.
                s.pointee.phase += s.pointee.swellRate / s.pointee.sampleRate
                if s.pointee.phase > 1 { s.pointee.phase -= 1 }
                let swell = 1 - s.pointee.swellDepth
                    + s.pointee.swellDepth * (0.5 + 0.5 * sin(2 * .pi * s.pointee.phase))

                // Gain glide, so starting and stopping fade instead of click.
                s.pointee.gain += (s.pointee.targetGain - s.pointee.gain) * 0.0006

                // Heavier filtering costs amplitude; put it back so the voices
                // sit at comparable loudness.
                let makeup: Float = 1 + (0.5 - min(0.5, s.pointee.cutoff)) * 6
                let sample = s.pointee.lowpass2 * makeup * swell * s.pointee.gain

                for buffer in buffers {
                    guard let data = buffer.mData else { continue }
                    data.assumingMemoryBound(to: Float.self)[frame] = sample
                }
            }
            return noErr
        }

        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        source = node

        do {
            try engine.start()
            playing = ambience
            onLog?("[ambient] \(ambience.rawValue) at \(Int(format.sampleRate))Hz "
                   + "\(format.channelCount)ch")
        } catch {
            onLog?("[ambient] could not start — \(error.localizedDescription)")
            engine.detach(node)
            source = nil
        }
    }

    /// Fade out, then tear down. The delay is the fade — stopping the engine
    /// underneath a non-zero gain is an audible pop at the end of every break.
    func stop() {
        guard playing != .none else { return }
        playing = .none
        state.pointee.targetGain = 0

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self, self.playing == .none else { return }
            self.engine.stop()
            if let source = self.source { self.engine.detach(source) }
            self.source = nil
            self.onLog?("[ambient] stopped")
        }
    }
}
