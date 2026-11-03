import Foundation

// The timing and acoustic halves of `FollowUpAddressGate`: when he started
// talking in the follow-up window, how loud the utterance was, and how loud his
// own turns usually are. All pure values; AppState holds one of each.

/// When the follow-up window opened and when speech first arrived in it.
struct FollowUpWindowClock: Equatable {
    private(set) var openedAt: Date?
    private(set) var firstSpeechAt: Date?

    static let closed = FollowUpWindowClock()

    func opened(at date: Date) -> FollowUpWindowClock {
        FollowUpWindowClock(openedAt: date, firstSpeechAt: nil)
    }

    /// Only the first speech after the window opened counts.
    func heardSpeech(at date: Date) -> FollowUpWindowClock {
        guard let openedAt, firstSpeechAt == nil, date >= openedAt else { return self }
        return FollowUpWindowClock(openedAt: openedAt, firstSpeechAt: date)
    }

    func closed() -> FollowUpWindowClock { .closed }

    var onsetSeconds: TimeInterval? {
        guard let openedAt, let firstSpeechAt else { return nil }
        return firstSpeechAt.timeIntervalSince(openedAt)
    }
}

enum FollowUpTiming {
    enum Band: Equatable { case quick, neutral, late }

    /// A reply that starts this soon after ORION stopped is almost always his.
    static let quickOnset: TimeInterval = 2.0
    /// Within the 6 s grace, a line that starts this late is more often the room.
    static let lateOnset: TimeInterval = 4.0

    static func band(onset: TimeInterval?) -> Band {
        guard let onset else { return .neutral }
        if onset <= quickOnset { return .quick }
        return onset >= lateOnset ? .late : .neutral
    }
}

/// The microphone while a turn is being heard: each buffer's level and samples.
/// Used for the utterance's speech level and for the voiced audio voice ID scores.
/// Never written anywhere.
struct UtteranceCapture: Equatable {
    struct Chunk: Equatable {
        let samples: [Float]
        let level: Double
    }

    static let maxSeconds: Double = 12
    /// The loudest share of buffers is the speech; the rest is the room.
    static let speechShare = 0.3
    /// Buffers within this much (normalised, 45 dB scale) of the speech level are voiced.
    static let voicedMargin = 6.0 / 45.0
    /// Long enough to score two halves separately.
    static let splitSeconds: Double = 2.4

    let rate: Double
    private(set) var chunks: [Chunk] = []
    private(set) var sampleCount = 0
    /// Samples trimmed off the front, so a time from the start of the turn still finds its audio.
    private(set) var droppedSamples = 0

    static func empty(rate: Double) -> UtteranceCapture { UtteranceCapture(rate: rate) }

    func appending(samples: [Float], level: Double) -> UtteranceCapture {
        var next = UtteranceCapture(rate: rate, chunks: chunks + [Chunk(samples: samples, level: level)],
                                    sampleCount: sampleCount + samples.count, droppedSamples: droppedSamples)
        let cap = Int(rate * Self.maxSeconds)
        while next.sampleCount > cap, let first = next.chunks.first {
            next.chunks.removeFirst()
            next.sampleCount -= first.samples.count
            next.droppedSamples += first.samples.count
        }
        return next
    }

    /// Seconds heard since the turn began, including any trimmed off the front.
    var duration: Double { rate > 0 ? Double(droppedSamples + sampleCount) / rate : 0 }

    /// The chunks overlapping [from, to) seconds, each with its first sample's index from the start of the turn.
    private func chunks(from start: Double, to end: Double) -> [(offset: Int, chunk: Chunk)] {
        let low = Int(start * rate), high = Int(end * rate)
        var offset = droppedSamples
        var result: [(Int, Chunk)] = []
        for chunk in chunks {
            let next = offset + chunk.samples.count
            if next > low, offset < high { result.append((offset, chunk)) }
            offset = next
        }
        return result
    }

    /// The audio between two times from the start of the turn (what a word timing points at).
    func samples(from start: Double, to end: Double) -> [Float] {
        let low = Int(start * rate), high = Int(end * rate)
        return chunks(from: start, to: end).flatMap { offset, chunk -> ArraySlice<Float> in
            let first = max(0, low - offset), last = min(chunk.samples.count, high - offset)
            return first < last ? chunk.samples[first..<last] : []
        }
    }

    /// Speech level of the audio between two times, measured like `speechLevel`.
    func level(from start: Double, to end: Double) -> Double? {
        let levels = chunks(from: start, to: end).map(\.chunk.level)
        guard !levels.isEmpty else { return nil }
        let sorted = levels.sorted(by: >)
        let take = max(1, Int((Double(sorted.count) * Self.speechShare).rounded(.up)))
        return sorted.prefix(take).reduce(0, +) / Double(take)
    }

    /// Mean level of the loudest buffers: how loud the speech itself was.
    var speechLevel: Double? {
        guard !chunks.isEmpty else { return nil }
        let sorted = chunks.map(\.level).sorted(by: >)
        let take = max(1, Int((Double(sorted.count) * Self.speechShare).rounded(.up)))
        return sorted.prefix(take).reduce(0, +) / Double(take)
    }

    /// The voiced buffers, in order, keeping the most recent `maxSeconds`.
    func voicedSamples(maxSeconds: Double = 4) -> [Float] {
        guard let speech = speechLevel else { return [] }
        let voiced = chunks.filter { $0.level >= speech - Self.voicedMargin }.flatMap(\.samples)
        let cap = Int(rate * maxSeconds)
        return voiced.count > cap ? Array(voiced.suffix(cap)) : voiced
    }

    /// What to send voice ID: the two halves of a long utterance, or the whole of a short one.
    static func speakerSegments(_ samples: [Float], rate: Double) -> [[Float]] {
        guard !samples.isEmpty else { return [] }
        guard Double(samples.count) >= rate * splitSeconds else { return [samples] }
        let middle = samples.count / 2
        return [Array(samples[..<middle]), Array(samples[middle...])]
    }
}

/// How loud his own turns usually are: the median speech level of his recent
/// turns that are known to be his (wake word, key, or a follow-up voice ID
/// accepted). Stored in UserDefaults as plain numbers.
struct VoiceLevelBaseline: Equatable {
    static let capacity = 12
    static let minimumTurns = 3
    /// The normalised level spans -55..-10 dBFS.
    static let decibelSpan = 45.0
    static let defaultsKey = "OrionVoiceLevelBaseline"

    let levels: [Double]

    static let empty = VoiceLevelBaseline(levels: [])

    init(levels: [Double]) { self.levels = Array(levels.suffix(Self.capacity)) }

    init(stored: [Any]?) {
        let values = (stored ?? []).compactMap { $0 as? Double }.filter { $0.isFinite && (0...1).contains($0) }
        self.init(levels: values)
    }

    var stored: [Double] { levels }

    func adding(_ level: Double) -> VoiceLevelBaseline {
        guard level.isFinite, (0...1).contains(level) else { return self }
        return VoiceLevelBaseline(levels: levels + [level])
    }

    var reference: Double? {
        guard levels.count >= Self.minimumTurns else { return nil }
        let sorted = levels.sorted()
        let mid = sorted.count / 2
        return sorted.count.isMultiple(of: 2) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }

    func deltaDB(for level: Double) -> Double? {
        reference.map { (level - $0) * Self.decibelSpan }
    }
}
