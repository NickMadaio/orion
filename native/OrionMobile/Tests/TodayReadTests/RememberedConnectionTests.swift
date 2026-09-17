import XCTest
@testable import MobileCore

final class RememberedConnectionTests: XCTestCase {
    let fingerprint = String(repeating: "a", count: 64)
    func testRoundTripContainsOnlyDisplayMetadata() throws {
        let value = try RememberedLocalConnection(port: 12345, ownerID: "pairing-test-owner",
            deviceID: "pairing-test-phone", phoneFingerprint: fingerprint)
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(try RememberedLocalConnection.decode(data, expectedFingerprint: fingerprint), value)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["schema", "port", "ownerID", "deviceID", "phoneFingerprint"])
    }
    func testChangedPhoneAndMalformedRecordsRefuse() throws {
        let base: [String: Any] = ["schema":1, "port":12345, "ownerID":"pairing-test-owner",
            "deviceID":"pairing-test-phone", "phoneFingerprint":fingerprint]
        for change: [String: Any] in [["schema":2], ["port":0], ["port":65536],
                                     ["ownerID":"another-owner"], ["deviceID":"other-phone"],
                                     ["phoneFingerprint":String(repeating:"z", count:64)]] {
            let data = try JSONSerialization.data(withJSONObject: base.merging(change) { _, new in new })
            XCTAssertThrowsError(try RememberedLocalConnection.decode(data, expectedFingerprint:fingerprint))
        }
        let valid = try JSONSerialization.data(withJSONObject:base)
        XCTAssertThrowsError(try RememberedLocalConnection.decode(valid, expectedFingerprint:String(repeating:"b", count:64)))
        XCTAssertThrowsError(try RememberedLocalConnection.decode(Data(repeating:32, count:4097), expectedFingerprint:fingerprint))
        XCTAssertThrowsError(try RememberedLocalConnection.decode(Data("{}".utf8), expectedFingerprint:fingerprint))
    }
}
