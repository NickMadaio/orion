import Foundation

/// The security surface the phone offers: lock, sessions, devices, revocation.
///
/// Phase 42 builds the Security Center screen. This is what it will read, and it
/// is here now because Phase 16's list ends with "security controls" and a
/// control that arrives after the features it governs is a control nobody used.
public enum LockState: String, Sendable {
    case unlocked
    case locked
    /// Everything suspended, deliberately, by the user or by a security event.
    /// Mirrors Phase 5's SecurityState.LOCKED.
    case orionLocked
}

public struct ActiveSession: Sendable, Equatable, Identifiable {
    public let id: String
    public let deviceName: String
    public let lastUsed: Date?
    public let isCurrent: Bool

    public init(id: String, deviceName: String, lastUsed: Date?, isCurrent: Bool) {
        self.id = id
        self.deviceName = deviceName
        self.lastUsed = lastUsed
        self.isCurrent = isCurrent
    }
}

public struct SecurityControls: Sendable, Equatable {
    public private(set) var lock: LockState = .unlocked
    public private(set) var sessions: [ActiveSession] = []
    public private(set) var devices: DeviceManagement = DeviceManagement()

    public init() {}

    public mutating func update(sessions: [ActiveSession]) {
        self.sessions = sessions
    }

    public mutating func update(devices: DeviceManagement) {
        self.devices = devices
    }

    public mutating func lockOrion() {
        lock = .orionLocked
    }

    public mutating func unlock() {
        lock = .unlocked
    }

    /// Which actions the UI may offer right now.
    ///
    /// While ORION is locked the only things on offer are unlocking and
    /// revoking: an assistant that is locked but will still happily sign you out
    /// of other devices has not really been locked.
    public var availableActions: [String] {
        switch lock {
        case .orionLocked: return ["unlock", "revoke_device", "sign_out_everywhere"]
        case .locked: return ["unlock"]
        case .unlocked: return ["lock_orion", "revoke_device", "sign_out_everywhere", "review_sessions"]
        }
    }

    public var otherSessionCount: Int {
        sessions.filter { !$0.isCurrent }.count
    }
}
