import Foundation

/// Notifications: which kinds exist, and what the phone is allowed to send.
///
/// Categories are closed rather than free-form because every category is a
/// decision about when it is acceptable to interrupt somebody, and a string
/// parameter would make that decision at a call site instead of here.
public enum NotificationCategory: String, CaseIterable, Sendable {
    /// Something needs a yes or no before it can proceed.
    case approvalRequired = "approval_required"
    /// Something the user asked to be told about.
    case requested = "requested"
    /// A security event: a new device, a revocation, a lock.
    case security = "security"
    /// ORION finished something that was running.
    case completion = "completion"

    /// Whether this may interrupt a focus session or Do Not Disturb.
    ///
    /// Only two may. An assistant that considers all of its own output important
    /// is one people turn off entirely.
    public var mayBreakThrough: Bool {
        switch self {
        case .approvalRequired, .security: return true
        case .requested, .completion: return false
        }
    }
}

public enum NotificationPermission: String, Sendable {
    case notAsked
    case granted
    case denied
    case provisional
}

public struct NotificationSettings: Sendable, Equatable {
    public private(set) var permission: NotificationPermission = .notAsked
    public private(set) var enabled: Set<String>

    public init(enabled: Set<NotificationCategory> = Set(NotificationCategory.allCases)) {
        self.enabled = Set(enabled.map(\.rawValue))
    }

    public mutating func record(permission: NotificationPermission) {
        self.permission = permission
    }

    public mutating func setEnabled(_ category: NotificationCategory, _ on: Bool) {
        if on { enabled.insert(category.rawValue) } else { enabled.remove(category.rawValue) }
    }

    /// Security notifications cannot be switched off.
    ///
    /// A person can silence them at the OS level, which is their business. What
    /// the app must not offer is a setting that makes "a new device was paired
    /// to your account" quietly stop arriving.
    public func mayDeliver(_ category: NotificationCategory) -> Bool {
        guard permission == .granted || permission == .provisional else { return false }
        if category == .security { return true }
        return enabled.contains(category.rawValue)
    }
}
