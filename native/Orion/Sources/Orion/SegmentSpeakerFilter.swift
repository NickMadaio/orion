import Foundation

// Per-segment speaker filtering for one voice turn (w16, 2026-11-02 23:56).
//
// "What's the weather like tomorrow You can take it off too. You know?" went to the model as one line; the second
// half was another person in the room. Voice ID only ever scored the turn as a whole (or two blind halves), so a
// clear "Nick" score on the first half carried the other voice's words with it. The ear gives word timings: the turn
// is cut at its pauses and sentence ends, each piece long enough is voice-checked on its own audio, and pieces that
// clearly are not Nick are dropped before anything is sent. Pure values; FollowUpAddressChecker runs the voice ID.

/// One recognised word and where it sits in the utterance's audio, in seconds from the start of the stream.
struct TimedWord: Equatable {
    let text: String
    let start: Double
    let end: Double

    /// The ear's words with the transcript's punctuation and casing, when the two line up word for word.
    /// Deepgram's word list is bare ("know"); its transcript is punctuated ("know?"), and sentence ends cut segments.
    static func aligned(_ words: [TimedWord], transcript: String) -> [TimedWord] {
        let tokens = transcript.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard tokens.count == words.count else { return words }
        return zip(words, tokens).map { TimedWord(text: $0.1, start: $0.0.start, end: $0.0.end) }
    }
}

struct SpeechSegment: Equatable {
    let words: [TimedWord]
    var text: String { words.map(\.text).joined(separator: " ") }
    var start: Double { words.first?.start ?? 0 }
    var end: Double { words.last?.end ?? 0 }
    var duration: Double { end - start }
}

enum SpeechSegments {
    /// A gap this long between words is a new breath, and often a new speaker.
    static let pauseGap = 0.5

    static func split(_ words: [TimedWord]) -> [SpeechSegment] {
        var segments: [[TimedWord]] = []
        for word in words {
            if let previous = segments.last?.last, word.start - previous.end < pauseGap, !endsSentence(previous.text) {
                segments[segments.count - 1].append(word)
            } else {
                segments.append([word])
            }
        }
        return segments.map(SpeechSegment.init)
    }

    private static func endsSentence(_ word: String) -> Bool {
        guard let last = word.last else { return false }
        return ".?!\u{2026}".contains(last)
    }
}

struct ScoredSegment: Equatable {
    let segment: SpeechSegment
    let speaker: SpeakerEvidence
    /// Normalised speech level of the segment's audio (0...1 over 45 dB), nil when there was none.
    let level: Double?
}

struct DroppedSegment: Equatable {
    let text: String
    let reason: String
}

struct SegmentFilterResult: Equatable {
    let kept: [ScoredSegment]
    let dropped: [DroppedSegment]
    /// Voice evidence from the kept segments, nil when the filter had nothing to say (the whole-turn check stands).
    let evidence: SpeakerEvidence?

    /// The transcript without the dropped pieces. Each piece is removed from the end backwards, so a phrase that
    /// also occurs earlier ("You know what's next? You know?") loses only the occurrence that was dropped.
    func keptText(from transcript: String) -> String {
        var text = transcript
        for piece in dropped.reversed() {
            guard let range = text.range(of: piece.text, options: .backwards) else { continue }
            text.removeSubrange(range)
        }
        return text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            .trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;")))
    }
}

enum SegmentSpeakerFilter {
    /// A trailing piece this much louder or quieter than his own pieces was said by someone else, or from elsewhere.
    static let levelChangeDB = 6.0
    /// Voice ID needs about this much audio to say anything.
    static let minimumScoredSeconds = 0.8

    static func filter(_ segments: [ScoredSegment]) -> SegmentFilterResult {
        let reads = segments.map { FollowUpAddressGate.read($0.speaker) }
        guard segments.count >= 2, let lastNick = reads.lastIndex(of: .nick) else {
            return SegmentFilterResult(kept: segments, dropped: [], evidence: nil)
        }
        let nickLevel = mean(zip(segments, reads).filter { $0.1 == .nick }.compactMap(\.0.level))
        var kept: [ScoredSegment] = []
        var dropped: [DroppedSegment] = []
        for (index, item) in segments.enumerated() {
            let trailing = index > lastNick
            if trailing, reads[index] != .nick, let previous = dropped.last, previous.text == segments[index - 1].segment.text {
                dropped.append(DroppedSegment(text: item.segment.text, reason: "follows another voice"))
                continue
            }
            let reason = dropReason(item, read: reads[index], trailing: trailing,
                                    afterWholeRequest: trailing && RequestShape.isWhole(kept.map(\.segment.text).joined(separator: " ")),
                                    nickLevel: nickLevel)
            if let reason { dropped.append(DroppedSegment(text: item.segment.text, reason: reason)) } else { kept.append(item) }
        }
        return SegmentFilterResult(kept: kept, dropped: dropped, evidence: evidence(kept))
    }

    private static func dropReason(_ item: ScoredSegment, read: SpeakerRead, trailing: Bool, afterWholeRequest: Bool,
                                   nickLevel: Double?) -> String? {
        if read == .notNick { return "voice is not Nick (\(score(item.speaker)))" }
        guard read != .nick, trailing, afterWholeRequest else { return nil }
        if read == .uncertain { return "after his request, voice unsure (\(score(item.speaker)))" }
        if let level = item.level, let nickLevel {
            let delta = (level - nickLevel) * VoiceLevelBaseline.decibelSpan
            if abs(delta) >= levelChangeDB { return String(format: "after his request, %+.0f dB from his voice", delta) }
        }
        return nil
    }

    private static func evidence(_ kept: [ScoredSegment]) -> SpeakerEvidence? {
        let scores = kept.compactMap { item -> Double? in
            if case .scored(let value) = item.speaker { return value }
            return nil
        }
        guard let low = scores.min(), let high = scores.max() else { return nil }
        return scores.count == 1 ? .scored(low) : .split(first: low, last: high)
    }

    private static func mean(_ values: [Double]) -> Double? {
        values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }

    private static func score(_ evidence: SpeakerEvidence) -> String {
        evidence.bestScore.map { String(format: "%.2f", $0) } ?? "unscored"
    }
}
