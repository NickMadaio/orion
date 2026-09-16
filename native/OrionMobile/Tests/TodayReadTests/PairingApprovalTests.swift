import XCTest
@testable import MobileCore

final class PairingApprovalTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1000)
    let fingerprint = String(repeating: "a", count: 64)
    func request(_ changes: [String: Any] = [:]) throws -> PairingApprovalRequest {
        var value: [String: Any] = ["schema": 1, "ownerID": "test-owner", "pairingID": "pairing-1234567890",
            "nonce": String(repeating: "n", count: 43), "offeringFingerprint": fingerprint,
            "joiningDeviceID": "joining-device", "joiningPublicKey": (Data([4]) + Data(repeating: 1, count: 64)).base64EncodedString(), "expiresAt": 1100.0]
        value.merge(changes) { _, new in new }
        return try JSONDecoder().decode(PairingApprovalRequest.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func testValidRequestBindsExactKeyAndDevice() throws {
        let value = try request()
        XCTAssertNoThrow(try value.validate(expectedOwner: "test-owner", offeringFingerprint: fingerprint, now: now))
        XCTAssertEqual(value.confirmationMessage, "pair-confirm|\(value.pairingID)|\(value.nonce)|\(value.joiningPublicKey)|joining-device")
        XCTAssertNotEqual(value.confirmationMessage, try request(["joiningDeviceID": "other"]).confirmationMessage)
        XCTAssertNotEqual(value.confirmationMessage, try request(["joiningPublicKey": (Data([4]) + Data(repeating: 2, count: 64)).base64EncodedString()]).confirmationMessage)
    }
    func testBackendIdentifierPunctuationAccepted() throws {
        let value = try request(["joiningDeviceID": "device:abc.def-123_45"])
        XCTAssertNoThrow(try value.validate(expectedOwner: "test-owner", offeringFingerprint: fingerprint, now: now))
    }
    func testWrongAccountOrOfferingKeyRefused() throws {
        let value = try request()
        XCTAssertThrowsError(try value.validate(expectedOwner: "other", offeringFingerprint: fingerprint, now: now))
        XCTAssertThrowsError(try value.validate(expectedOwner: "test-owner", offeringFingerprint: String(repeating: "b", count: 64), now: now))
    }
    func testExpiredFutureMalformedAndInjectedFieldsRefused() throws {
        for changes: [String: Any] in [["expiresAt": 1000.0], ["expiresAt": 1121.0], ["schema": 2],
            ["pairingID": "pairing|injection"], ["nonce": "short"], ["joiningDeviceID": "id|injection"],
            ["joiningPublicKey": "bad-key"], ["joiningDeviceID": ""], ["joiningDeviceID": "short"],
            ["joiningDeviceID": "-invalid-start"], ["joiningDeviceID": "_invalid-start"]] {
            let value = try request(changes)
            XCTAssertThrowsError(try value.validate(expectedOwner: "test-owner", offeringFingerprint: fingerprint, now: now))
        }
    }
    func testValidationRechecksTimeAtDecision() throws {
        let value = try request()
        XCTAssertNoThrow(try value.validate(expectedOwner: "test-owner", offeringFingerprint: fingerprint, now: now))
        XCTAssertThrowsError(try value.validate(expectedOwner: "test-owner", offeringFingerprint: fingerprint, now: Date(timeIntervalSince1970: 1100)))
    }
}
