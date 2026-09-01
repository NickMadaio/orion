import Foundation

/// The device's own identity, as a reference rather than as key material.
///
/// The private key lives in the Secure Enclave and is not exportable, so this
/// type holds a *reference* to it and the public half. There is deliberately no
/// property that could contain a private key: a struct that can hold one is a
/// struct that will eventually be logged.
public struct DeviceKeyReference: Sendable, Equatable {
    public let reference: String
    public let publicKey: String
    public let hardwareBacked: Bool

    public init(reference: String, publicKey: String, hardwareBacked: Bool) {
        self.reference = reference
        self.publicKey = publicKey
        self.hardwareBacked = hardwareBacked
    }
}

/// A device in the user's list, as the phone displays it.
public struct KnownDevice: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let platform: String
    public let isCurrent: Bool
    public let lastSeen: Date?
    public let revoked: Bool

    public init(id: String, name: String, platform: String, isCurrent: Bool,
                lastSeen: Date?, revoked: Bool) {
        self.id = id
        self.name = name
        self.platform = platform
        self.isCurrent = isCurrent
        self.lastSeen = lastSeen
        self.revoked = revoked
    }
}

/// Device management: what the phone can see and do about devices.
public struct DeviceManagement: Sendable, Equatable {
    public private(set) var devices: [KnownDevice] = []

    public init(devices: [KnownDevice] = []) {
        self.devices = devices
    }

    public var current: KnownDevice? { devices.first(where: \.isCurrent) }

    public var active: [KnownDevice] { devices.filter { !$0.revoked } }

    /// Revoking the device you are holding signs you out of it; that is the
    /// correct behaviour and the UI has to say so before doing it, so the model
    /// answers the question rather than leaving it to a screen.
    public func revokingIsSelfSignOut(_ deviceID: String) -> Bool {
        current?.id == deviceID
    }

    public mutating func markRevoked(_ deviceID: String) {
        devices = devices.map { device in
            device.id == deviceID
                ? KnownDevice(id: device.id, name: device.name, platform: device.platform,
                              isCurrent: device.isCurrent, lastSeen: device.lastSeen, revoked: true)
                : device
        }
    }

    /// The claim payload the phone sends when it scans a pairing code.
    ///
    /// Mirrors Phase 15's `pair-join|<pairing>|<nonce>|<public key>`. Written
    /// here rather than assembled in a view because the string IS the protocol.
    public static func pairingClaimMessage(pairingID: String, nonce: String, publicKey: String) -> String {
        "pair-join|\(pairingID)|\(nonce)|\(publicKey)"
    }
}
