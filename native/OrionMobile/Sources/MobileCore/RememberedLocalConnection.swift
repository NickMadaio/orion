import Foundation

/// Display-only connection history. Never an authorization or reconnect input.
/// No setup grant, session token, plan or private-key material belongs here.
public struct RememberedLocalConnection: Codable, Equatable, Sendable {
    public let schema: Int
    public let port: Int
    public let ownerID: String
    public let deviceID: String
    public let phoneFingerprint: String

    public init(port: Int, ownerID: String, deviceID: String, phoneFingerprint: String) throws {
        self.schema = 1
        self.port = port
        self.ownerID = ownerID
        self.deviceID = deviceID
        self.phoneFingerprint = phoneFingerprint
        try validate(expectedFingerprint: phoneFingerprint)
    }

    public func validate(expectedFingerprint: String) throws {
        guard schema == 1, (1...65535).contains(port),
              ownerID == "pairing-test-owner", deviceID == "pairing-test-phone",
              phoneFingerprint == expectedFingerprint, phoneFingerprint.count == 64,
              phoneFingerprint.allSatisfy({ "0123456789abcdef".contains($0) }) else {
            throw TodayPlanError.invalidInput
        }
    }

    public static func decode(_ data: Data, expectedFingerprint: String) throws -> Self {
        guard data.count <= 4096 else { throw TodayPlanError.invalidInput }
        let value = try JSONDecoder().decode(Self.self, from: data)
        try value.validate(expectedFingerprint: expectedFingerprint)
        return value
    }
}
