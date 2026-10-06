import Foundation

/*
 Hard limits on a phone voice conversation (2026-10-06, P0).

 The phone re-listened forever: after every reply, after silence, after errors.
 Background speech kept turning into chat messages for hours, and the only way
 to stop it was revoking microphone access. Every listening loop now asks this
 guard first, and the guard has the last word: idle, too long, too many turns,
 or nothing but noise ends the conversation.
*/
public struct VoiceSessionLimits: Equatable, Sendable {
    public var idleSeconds: TimeInterval
    public var maxSessionSeconds: TimeInterval
    public var maxTurns: Int
    public var maxConsecutiveDiscards: Int

    public init(idleSeconds: TimeInterval = 45, maxSessionSeconds: TimeInterval = 900,
                maxTurns: Int = 30, maxConsecutiveDiscards: Int = 3) {
        self.idleSeconds = idleSeconds
        self.maxSessionSeconds = maxSessionSeconds
        self.maxTurns = maxTurns
        self.maxConsecutiveDiscards = maxConsecutiveDiscards
    }
}

public enum VoiceStopReason: String, Equatable, Sendable { case user, idle, lifetime, turnLimit, strayAudio, background }

public enum VoiceTurnVerdict: Equatable, Sendable { case send(String), discard, stop(VoiceStopReason) }

public struct VoiceSessionGuard: Equatable, Sendable {
    public let limits: VoiceSessionLimits
    public let startedAt: Date
    public private(set) var lastActivityAt: Date
    public private(set) var turnsSent: Int = 0
    public private(set) var consecutiveDiscards: Int = 0

    static let filler: Set<String> = ["um", "uh", "uhh", "umm", "hmm", "mm", "mhm", "ah", "oh", "er", "erm",
                                      "like", "okay", "ok", "yeah", "so"]
    static let stopPhrases: Set<String> = ["stop", "stop listening", "that's all", "thats all", "goodbye",
                                           "bye orion", "end conversation", "end voice"]

    public init(startedAt: Date, limits: VoiceSessionLimits = VoiceSessionLimits()) {
        self.limits = limits
        self.startedAt = startedAt
        self.lastActivityAt = startedAt
    }

    public func markingActivity(at moment: Date) -> VoiceSessionGuard {
        var copy = self
        copy.lastActivityAt = max(lastActivityAt, moment)
        return copy
    }

    public func check(now: Date) -> VoiceStopReason? {
        if now.timeIntervalSince(startedAt) >= limits.maxSessionSeconds { return .lifetime }
        if now.timeIntervalSince(lastActivityAt) >= limits.idleSeconds { return .idle }
        return nil
    }

    public func judging(_ transcript: String, at moment: Date) -> (VoiceSessionGuard, VoiceTurnVerdict) {
        if let reason = check(now: moment) { return (self, .stop(reason)) }
        let normal = Self.normalise(transcript)
        if Self.stopPhrases.contains(normal) { return (self, .stop(.user)) }
        let words = normal.split(separator: " ").map(String.init).filter { !Self.filler.contains($0) }
        var copy = self
        if words.count < 2 {
            copy.consecutiveDiscards += 1
            let verdict: VoiceTurnVerdict = copy.consecutiveDiscards >= limits.maxConsecutiveDiscards ? .stop(.strayAudio) : .discard
            return (copy, verdict)
        }
        if turnsSent >= limits.maxTurns { return (self, .stop(.turnLimit)) }
        copy.turnsSent += 1
        copy.consecutiveDiscards = 0
        copy.lastActivityAt = max(lastActivityAt, moment)
        return (copy, .send(transcript.trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    public static func message(for reason: VoiceStopReason, limits: VoiceSessionLimits = VoiceSessionLimits()) -> String {
        switch reason {
        case .user: return "Voice ended."
        case .idle: return "Voice ended — nothing heard for a while."
        case .lifetime: return "Voice ended after \(Int(limits.maxSessionSeconds / 60)) minutes. Tap the mic to keep going."
        case .turnLimit: return "Voice ended after \(limits.maxTurns) messages. Tap the mic to keep going."
        case .strayAudio: return "Voice ended — it was only hearing background noise."
        case .background: return "Voice ended when ORION left the screen."
        }
    }

    static func normalise(_ text: String) -> String {
        let stripped = text.lowercased().unicodeScalars.filter { !".,!?…".unicodeScalars.contains($0) }
        return String(String.UnicodeScalarView(stripped))
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}
