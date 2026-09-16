import Foundation

/// Local read-session proof, distinct from registration and pairing approval.
/// The caller must already know the account/device association and local key.
public struct DeviceReadChallenge: Codable, Sendable {
    public let schema: Int
    public let ownerID: String
    public let deviceID: String
    public let publicKey: String
    public let challenge: String
    public let expiresAt: Double

    public func validate(expectedOwner: String, expectedDevice: String, expectedKey: String, now: Date) throws {
        let remaining = expiresAt - now.timeIntervalSince1970
        func validID(_ value: String) -> Bool {
            (8...128).contains(value.utf8.count) && value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$", options: .regularExpression) != nil
        }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        guard schema == 1, ownerID == expectedOwner, deviceID == expectedDevice, publicKey == expectedKey,
              validID(ownerID), validID(deviceID),
              (32...128).contains(challenge.utf8.count), challenge.unicodeScalars.allSatisfy({ allowed.contains($0) }),
              expiresAt.isFinite, remaining > 0, remaining <= 300,
              let point = Data(base64Encoded: publicKey), point.count == 65, point.first == 4,
              point.base64EncodedString() == publicKey else { throw InvalidChallenge.refused }
    }

    public var proofMessage: String {
        "local-read-session-v1|\(ownerID)|\(deviceID)|\(publicKey)|\(challenge)"
    }
    public enum InvalidChallenge: Error { case refused }
}
