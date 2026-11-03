import Foundation

/// Mouse-wheel direction (w18 scroll; Nick chose always as the default, 2026-11-03): reverse the wheel of a MOUSE only, never the trackpad, and never the system setting.
/// Pure: the event tap reads the raw CGEvent fields and asks these functions what to do.

public enum ReverseWheelMode: String, Codable, CaseIterable {
    case games, always, never
}

public struct ScrollDeltas: Equatable {
    public var delta1: Int64, delta2: Int64
    public var pointDelta1: Int64, pointDelta2: Int64
    public var fixed1: Double, fixed2: Double

    public init(delta1: Int64, delta2: Int64, pointDelta1: Int64, pointDelta2: Int64, fixed1: Double, fixed2: Double) {
        self.delta1 = delta1; self.delta2 = delta2; self.pointDelta1 = pointDelta1; self.pointDelta2 = pointDelta2
        self.fixed1 = fixed1; self.fixed2 = fixed2
    }

    /// Every field flipped together, so apps that read any of them agree.
    public func negated() -> ScrollDeltas {
        ScrollDeltas(delta1: -delta1, delta2: -delta2, pointDelta1: -pointDelta1, pointDelta2: -pointDelta2, fixed1: -fixed1, fixed2: -fixed2)
    }
}

public enum ScrollWheelPolicy {
    /// A notched mouse wheel: not continuous, and no gesture or momentum phase. Trackpads and Magic Mice are one of those.
    public static func isDiscreteWheel(isContinuous: Int64, scrollPhase: Int64, momentumPhase: Int64) -> Bool {
        isContinuous == 0 && scrollPhase == 0 && momentumPhase == 0
    }

    /// Reversal only makes sense when natural scrolling is on (it is what makes the wheel feel backwards).
    public static func shouldInvert(mode: ReverseWheelMode, gameSession: Bool, naturalScrolling: Bool) -> Bool {
        guard naturalScrolling else { return false }
        switch mode {
        case .never: return false
        case .always: return true
        case .games: return gameSession
        }
    }

    /// com.apple.swipescrolldirection: absent means on (the macOS default).
    public static func naturalScrolling(fromDefault value: Any?) -> Bool {
        switch value {
        case let b as Bool: return b
        case let n as NSNumber: return n.boolValue
        default: return true
        }
    }
}

/// What the tap callback reads: three facts, and the one decision they add up to.
public struct WheelState: Equatable {
    public var mode: ReverseWheelMode
    public var natural: Bool
    public var gameSession: Bool
    public init(mode: ReverseWheelMode = .always, natural: Bool = true, gameSession: Bool = false) {
        self.mode = mode; self.natural = natural; self.gameSession = gameSession
    }
    public var invert: Bool { ScrollWheelPolicy.shouldInvert(mode: mode, gameSession: gameSession, naturalScrolling: natural) }
}
