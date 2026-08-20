//
//  A break you cannot simply click out of.
//
//  Every other surface in this app is dismissible on purpose. This one is not,
//  and the reason is that a rest phase which can be cancelled by reflex is not a
//  rest phase — it is a suggestion, and the suggestion loses to whatever is on
//  the other screen every single time. The lock is the feature.
//
//  What "locked" means here, stated precisely so nothing oversells it:
//
//    · The surface covers every display and refuses to give up front position.
//    · There is no dismiss control, no Escape, and no keyboard shortcut.
//    · The ONLY way out before the timer is to tell Orion why leaving is vital,
//      out loud, and be believed.
//
//  What it does NOT mean: this is not a kiosk and it does not capture the
//  machine. Command-Tab, Force Quit and the power button all still work, and
//  that is deliberate — an app that a person genuinely cannot escape is a
//  hazard, not a discipline tool. The lock is meant to beat reflex, not to beat
//  its owner. Anyone determined to leave can; they just cannot do it absent
//  mindedly, which is the entire point.
//
//  The floor is three minutes because that is the shortest break worth taking.
//  Below it the eyes do not relax and the point is lost, so it is the shortest
//  break that can be CHOSEN — not a window during which the vital-reason escape
//  is disabled. A real emergency at minute one has to be able to get out at
//  minute one, or the lock has become the hazard.
//

import Foundation

/// How long the break runs. Two choices, deliberately — a slider invites
/// negotiating the number down every time, which is the same failure as a
/// dismiss button wearing different clothes.
public enum BreakLength: String, Codable, Sendable, CaseIterable {
    /// The default.
    case full
    /// Chosen in advance, for a day that cannot spare ten.
    case short

    public var seconds: TimeInterval {
        switch self {
        case .full: return 600
        case .short: return BreakLock.floor
        }
    }

    public var minutes: Int { Int(seconds / 60) }

    public var label: String {
        switch self {
        case .full: return "10 minutes"
        case .short: return "3 minutes"
        }
    }
}

/// Why a break ended early, when one did. Kept as data because "he got out of
/// it" is exactly the thing worth being able to look back on: a week of vital
/// reasons is a week that needs a different schedule, not a different lock.
public struct BreakRelease: Equatable, Sendable, Codable {
    public let reason: String
    public let at: Date
    /// Seconds actually served before the release.
    public let served: TimeInterval

    public init(reason: String, at: Date, served: TimeInterval) {
        self.reason = reason
        self.at = at
        self.served = served
    }
}

public struct BreakLock: Equatable, Sendable {

    /// The shortest break that is worth taking, and therefore the shortest that
    /// can be chosen. Not a grace period — see the header.
    public static let floor: TimeInterval = 180

    public let startedAt: Date
    public let length: BreakLength
    public private(set) var release: BreakRelease?

    public init(startedAt: Date, length: BreakLength, release: BreakRelease? = nil) {
        self.startedAt = startedAt
        self.length = length
        self.release = release
    }

    public enum State: Equatable, Sendable {
        /// Held, with time left. `pleadable` is whether the vital-reason route
        /// is offered — always true while held, and stated as a value rather
        /// than assumed so a future policy change is one place.
        case held(remaining: TimeInterval, pleadable: Bool)
        /// Served in full.
        case served
        /// Ended early because a reason was believed.
        case released(BreakRelease)
    }

    public func state(at now: Date) -> State {
        if let release { return .released(release) }
        let elapsed = now.timeIntervalSince(startedAt)
        let remaining = length.seconds - elapsed
        guard remaining > 0 else { return .served }
        return .held(remaining: remaining, pleadable: true)
    }

    public func served(at now: Date) -> TimeInterval {
        if let release { return release.served }
        return min(length.seconds, max(0, now.timeIntervalSince(startedAt)))
    }

    /// 0...1, for the ring that fills. Clamped, because a snapshot can arrive
    /// after the phase ended and a progress bar past 100% looks broken.
    public func progress(at now: Date) -> Double {
        guard length.seconds > 0 else { return 1 }
        return min(1, max(0, served(at: now) / length.seconds))
    }

    /// Let him out, because he said why and was believed.
    ///
    /// The reason is required and must say something. An empty string means the
    /// judging step failed open, and failing open on the one control that
    /// removes the lock would quietly delete the feature.
    public mutating func grantRelease(reason: String, at now: Date) -> Bool {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        guard release == nil else { return false }
        release = BreakRelease(reason: trimmed, at: now, served: served(at: now))
        return true
    }
}
