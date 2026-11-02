import Foundation

/// One line per follow-up / barge-in address decision, for tuning the
/// thresholds in `FollowUpAddressGate` against real use. Never audio: the
/// signals, the reasons, and the words (capped), so a wrong call can be found
/// and turned into a fixture. Rotates to `.1` at 2 MB.
enum AddressDecisionLog {
    static let maxBytes = 2_000_000
    static let maxTextChars = 240
    private static let queue = DispatchQueue(label: "com.nickmadaio.orion.addresslog")

    static var defaultFile: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw/logs/orion-address-decisions.jsonl")
    }

    /// `judged`: what the local model said for a borderline line (nil when not asked).
    static func line(verdict: AddressVerdict, signals: AddressSignals, judged: Bool?, at date: Date) -> String {
        var record: [String: Any] = [
            "at": ISO8601DateFormatter().string(from: date),
            "opening": openingName(signals.opening),
            "outcome": verdict.outcome.rawValue,
            "addressed": verdict.outcome == .addressed || (verdict.outcome == .borderline && judged == true),
            "score": verdict.score,
            "reasons": verdict.reasons,
            "speaker": verdict.speakerRead.rawValue,
            "words": AddressLexicon.words(signals.text).count,
            "text": String(signals.text.prefix(maxTextChars)),
        ]
        if let score = signals.speaker.bestScore { record["speakerScore"] = (score * 1000).rounded() / 1000 }
        if let delta = signals.levelDeltaDB { record["levelDeltaDB"] = (delta * 10).rounded() / 10 }
        if let onset = signals.onsetSeconds { record["onsetSeconds"] = (onset * 100).rounded() / 100 }
        if let judged { record["judge"] = judged }
        guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }

    static func openingName(_ opening: VoiceTurnOpening) -> String {
        switch opening {
        case .wake: return "wake"
        case .pushToTalk: return "pushToTalk"
        case .typed: return "typed"
        case .followUp: return "followUp"
        case .bargeIn: return "bargeIn"
        }
    }

    /// Background append; failures are logged, never thrown at the voice path.
    static func record(_ line: String, to file: URL = defaultFile) {
        queue.async { append(line, to: file, maxBytes: maxBytes) }
    }

    /// Synchronous, for tests and the queue above.
    static func append(_ line: String, to file: URL, maxBytes: Int) {
        let manager = FileManager.default
        let payload = Data((line + "\n").utf8)
        do {
            try manager.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            let size = (try? manager.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            if size > 0, size + payload.count > maxBytes {
                let rotated = URL(fileURLWithPath: file.path + ".1")
                try? manager.removeItem(at: rotated)
                try manager.moveItem(at: file, to: rotated)
            }
            if manager.fileExists(atPath: file.path) {
                let handle = try FileHandle(forWritingTo: file)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: payload)
            } else {
                try payload.write(to: file, options: .atomic)
            }
        } catch {
            OrionLog.write("[gate] address log write failed: \(error.localizedDescription)")
        }
    }
}
