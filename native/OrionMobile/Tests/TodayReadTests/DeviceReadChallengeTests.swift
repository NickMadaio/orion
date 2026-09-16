import XCTest
@testable import MobileCore

final class DeviceReadChallengeTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1000)
    let point = (Data([4]) + Data(repeating: 1, count: 64)).base64EncodedString()
    func request(_ changes: [String: Any] = [:]) throws -> DeviceReadChallenge {
        var value: [String: Any] = ["schema":1, "ownerID":"test-owner", "deviceID":"test-phone",
            "publicKey":point, "challenge":String(repeating:"n", count:43), "expiresAt":1200.0]
        value.merge(changes) { _,new in new }
        return try JSONDecoder().decode(DeviceReadChallenge.self, from: JSONSerialization.data(withJSONObject:value))
    }
    func testMessageMatchesBackendDomainAndFields() throws {
        let value = try request()
        try value.validate(expectedOwner:"test-owner", expectedDevice:"test-phone", expectedKey:point, now:now)
        XCTAssertEqual(value.proofMessage, "local-read-session-v1|test-owner|test-phone|\(point)|\(value.challenge)")
    }
    func testDifferentOwnerDeviceOrKeyRefused() throws {
        let value = try request()
        for (owner, device, key) in [("other-owner","test-phone",point), ("test-owner","other-phone",point), ("test-owner","test-phone","other-key")] {
            XCTAssertThrowsError(try value.validate(expectedOwner:owner, expectedDevice:device, expectedKey:key, now:now))
        }
    }
    func testExpiredFutureAndInvalidNonceRefused() throws {
        for changes: [String: Any] in [["expiresAt":1000.0], ["expiresAt":1301.0], ["schema":2], ["challenge":"too-short"], ["challenge":String(repeating:"n", count:40)+"|injection"]] {
            let value = try request(changes)
            XCTAssertThrowsError(try value.validate(expectedOwner:"test-owner", expectedDevice:"test-phone", expectedKey:point, now:now))
        }
    }
    func testTimeRecheckedBeforeSigning() throws {
        let value = try request()
        XCTAssertThrowsError(try value.validate(expectedOwner:"test-owner", expectedDevice:"test-phone", expectedKey:point, now:Date(timeIntervalSince1970:1200)))
    }
}
