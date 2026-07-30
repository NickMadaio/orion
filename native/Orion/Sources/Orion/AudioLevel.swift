import AVFoundation
import Foundation

/// Normalised 0..1 loudness for a float PCM buffer.
///
/// Called from the realtime audio thread by both the mic tap and the playback
/// tap, so it allocates nothing and touches no shared state. RMS in dB rather
/// than raw amplitude: speech sits in a narrow amplitude band, and the log
/// mapping is what makes the hologram's core track the voice instead of sitting
/// pinned near zero.
func orionNormalisedLevel(_ buffer: AVAudioPCMBuffer) -> Double {
    guard let channels = buffer.floatChannelData else { return 0 }
    let frames = Int(buffer.frameLength)
    guard frames > 0 else { return 0 }
    let channelCount = max(1, Int(buffer.format.channelCount))

    var total: Double = 0
    for channel in 0..<channelCount {
        let samples = channels[channel]
        var sum: Float = 0
        for i in 0..<frames {
            let v = samples[i]
            sum += v * v
        }
        total += Double(sum)
    }

    let mean = total / Double(frames * channelCount)
    guard mean.isFinite, mean > 0 else { return 0 }
    let rms = mean.squareRoot()
    let db = 20 * log10(max(rms, 1e-7))
    // -55 dBFS reads as silence, -10 dBFS reads as full scale.
    let normalised = (db + 55) / 45
    if normalised.isNaN { return 0 }
    return min(1, max(0, normalised))
}
