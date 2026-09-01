import Foundation

/// Assembling a streamed reply out of chunks.
///
/// The interesting states are the ones that are not "more text arrived":
/// cancellation mid-stream, an error after partial text, and a duplicate chunk
/// after a reconnect. Each has to leave the transcript in a state a person can
/// read, because a half-sentence with no explanation looks like the app broke.
public struct StreamAssembler: Sendable, Equatable {
    public enum State: Sendable, Equatable {
        case idle
        case streaming
        case complete
        case cancelled
        case failed(String)
    }

    public let messageID: String
    public private(set) var state: State = .idle
    public private(set) var text: String = ""
    public private(set) var chunksApplied: Int = 0

    public init(messageID: String) {
        self.messageID = messageID
    }

    /// Apply a numbered chunk. Out-of-order and duplicate chunks are handled
    /// rather than assumed away: a reconnect resends, and a resend must not
    /// double a paragraph.
    @discardableResult
    public mutating func apply(chunk: String, index: Int) -> Bool {
        guard state == .idle || state == .streaming else { return false }
        // No `seenChunks` set: it always equalled 0..<chunksApplied, so
        // `seenChunks.contains(index)` implied `index < chunksApplied`, which the
        // next guard already rejects. The duplicate case IS handled -- by the
        // equality below -- but it was handled twice, and the assertion named
        // "a duplicate chunk is ignored" was passing on the other one.
        guard index == chunksApplied else {
            // A gap means an earlier chunk is still missing. Holding rather than
            // appending keeps the text honest; the caller retries the gap.
            return false
        }
        chunksApplied += 1
        text += chunk
        state = .streaming
        return true
    }

    public mutating func finish() {
        guard state == .streaming || state == .idle else { return }
        state = .complete
    }

    /// The user stopped it. The partial text stays, because deleting what ORION
    /// already said would be rewriting history the person watched happen.
    public mutating func cancel() {
        guard state == .streaming || state == .idle else { return }
        state = .cancelled
    }

    public mutating func fail(_ reason: String) {
        guard state == .streaming || state == .idle else { return }
        state = .failed(reason)
    }

    public var isTerminal: Bool {
        switch state {
        case .complete, .cancelled, .failed: return true
        case .idle, .streaming: return false
        }
    }

    /// What the transcript should show. A cancelled or failed stream keeps its
    /// partial text and says what happened rather than leaving a fragment.
    public var displayText: String {
        switch state {
        case .cancelled: return text.isEmpty ? "Stopped." : text + "\n\n(Stopped.)"
        case .failed(let reason): return text.isEmpty ? "Couldn't finish: \(reason)" : text + "\n\n(Couldn't finish: \(reason))"
        case .idle, .streaming, .complete: return text
        }
    }
}
