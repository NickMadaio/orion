import Foundation

/// Immutable review content. Display and confirmation use this same value.
/// Transport authentication and account selection belong to the caller.
public struct PairingApprovalRequest: Codable, Equatable, Sendable {
    public let schema: Int
    public let ownerID: String
    public let pairingID: String
    public let nonce: String
    public let offeringFingerprint: String
    public let joiningDeviceID: String
    public let joiningPublicKey: String
    public let expiresAt: Double

    public func validate(expectedOwner: String, offeringFingerprint: String, now: Date) throws {
        let alphabet = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        func identifier(_ value: String, _ range: ClosedRange<Int>) -> Bool {
            range.contains(value.utf8.count) && value.unicodeScalars.allSatisfy { alphabet.contains($0) }
        }
        let remaining = expiresAt - now.timeIntervalSince1970
        guard schema == 1, ownerID == expectedOwner, !ownerID.isEmpty,
              self.offeringFingerprint == offeringFingerprint, offeringFingerprint.count == 64,
              identifier(pairingID, 16...96), identifier(nonce, 32...128),
              (8...128).contains(joiningDeviceID.utf8.count),
              joiningDeviceID.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$", options: .regularExpression) != nil,
              expiresAt.isFinite, remaining > 0, remaining <= 120,
              let point = Data(base64Encoded: joiningPublicKey), point.count == 65, point.first == 4,
              point.base64EncodedString() == joiningPublicKey else { throw ApprovalError.invalid }
    }

    public var confirmationMessage: String {
        "pair-confirm|\(pairingID)|\(nonce)|\(joiningPublicKey)|\(joiningDeviceID)"
    }

    public enum ApprovalError: Error { case invalid }
}
