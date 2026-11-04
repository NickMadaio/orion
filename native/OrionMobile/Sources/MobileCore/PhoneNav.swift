import Foundation

/// The phone's bottom tabs, in order. Each is a full screen with its own navigation stack.
public enum PhoneTab: String, CaseIterable, Sendable {
    case home, plan, health, lists, more

    public var title: String {
        switch self {
        case .home: return "Home"
        case .plan: return "Plan"
        case .health: return "Health"
        case .lists: return "Lists"
        case .more: return "More"
        }
    }

    /// The old section names (drawer rows, widget links, `--tab`) mapped onto the tabs.
    public static func forSection(_ name: String) -> PhoneTab {
        switch name {
        case "plan", "calendar": return .plan
        case "health": return .health
        case "tasks", "todos", "lists": return .lists
        case "control", "projects", "more", "night": return .more
        default: return .home
        }
    }
}

/// Where an `orion://` link goes.
public enum PhoneRoute: Equatable, Sendable {
    case tab(PhoneTab)
    case chat
    case addWater

    public static func resolve(_ url: URL) -> PhoneRoute? {
        guard url.scheme == "orion" else { return nil }
        switch url.host {
        case "listen": return .chat
        case "water": return .addWater
        default:
            let name = url.lastPathComponent
            if name == "chat" || name == "orion" { return .chat }
            return .tab(PhoneTab.forSection(name))
        }
    }
}

/// Ring fractions that can never be NaN, negative, above one, or a divide by zero.
public enum RingMath {
    public static func clamp(_ value: Double) -> Double {
        value.isNaN ? 0 : min(1, max(0, value))
    }

    /// `value` as a share of `maximum`, 0...1. Nil when there is no reading; an unusable maximum is an empty ring.
    public static func fraction(_ value: Double?, of maximum: Double) -> Double? {
        guard let value else { return nil }
        guard maximum.isFinite, maximum > 0 else { return 0 }
        return clamp(value / maximum)
    }
}
