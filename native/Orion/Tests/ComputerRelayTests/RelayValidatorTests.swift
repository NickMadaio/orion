import ComputerRelay
import Foundation
import XCTest

/// The request checks: the shared golden vectors, signature, freshness, replay, allowlist and size caps.
final class RelayValidatorTests: XCTestCase {
    struct Vectors: Decodable {
        struct Req: Decodable { let id: String; let action: String; let createdAt: Int64; let nonce: String; let payload: [String: String] }
        struct Res: Decodable { let id: String; let nonce: String; let ok: Bool; let error: String?; let result: [String: String]? }
        struct ReqCase: Decodable { let request: Req; let canonical: String; let mac: String }
        struct ResCase: Decodable { let response: Res; let canonical: String; let mac: String }
        let keyHex: String
        let requests: [ReqCase]
        let responses: [ResCase]
    }

    static func vectors() throws -> Vectors {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/golden-vectors.json")
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    let key = Data((0..<32).map { UInt8($0) })
    let createdAt: Int64 = 1_761_900_000_000
    var clock = Date(timeIntervalSince1970: 1_761_900_000)

    func makeValidator() -> RelayValidator {
        RelayValidator(key: { [key] in key }, now: { [unowned self] in self.clock })
    }

    func signed(id: String = "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", action: String = "screen_type",
                payload: [String: String] = ["expected_bundle_id": "com.apple.TextEdit", "text": "orion test"],
                createdAt: Int64? = nil, nonce: String = "00112233445566778899aabbccddeeff",
                macOverride: String? = nil) -> Data {
        let at = createdAt ?? self.createdAt
        let canonical = RelayProtocol.canonicalRequest(id: id, action: action, createdAt: at, nonce: nonce, payload: payload)
        let object: [String: Any] = ["id": id, "action": action, "payload": payload, "createdAt": at, "nonce": nonce,
                                     "mac": macOverride ?? RelayProtocol.mac(key: key, canonical: canonical)]
        return try! JSONSerialization.data(withJSONObject: object)
    }

    func rejection(_ result: Result<RelayRequest, RelayRejection>) -> RelayRejection? {
        if case .failure(let r) = result { return r }
        return nil
    }

    // MARK: golden vectors

    func testRequestVectorsMatchTheIndependentImplementation() throws {
        let v = try Self.vectors()
        XCTAssertEqual(Data(hex: v.keyHex), key)
        XCTAssertEqual(v.requests.count, 3)
        for c in v.requests {
            let r = c.request
            let canonical = RelayProtocol.canonicalRequest(id: r.id, action: r.action, createdAt: r.createdAt, nonce: r.nonce, payload: r.payload)
            XCTAssertEqual(canonical, c.canonical)
            XCTAssertEqual(RelayProtocol.mac(key: key, canonical: canonical), c.mac)
            XCTAssertTrue(RelayProtocol.verify(key: key, canonical: canonical, presented: c.mac))
        }
    }

    func testResponseVectorsMatchTheIndependentImplementation() throws {
        let v = try Self.vectors()
        for c in v.responses {
            let r = c.response
            let canonical = RelayProtocol.canonicalResponse(id: r.id, nonce: r.nonce, ok: r.ok, error: r.error, result: r.result ?? [:])
            XCTAssertEqual(canonical, c.canonical)
            XCTAssertEqual(RelayProtocol.mac(key: key, canonical: canonical), c.mac)
        }
    }

    // MARK: accept

    func testAValidRequestPassesAndRebuildsTheBridgeLineFromValidatedFields() throws {
        let result = makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())
        let request = try result.get()
        XCTAssertEqual(request.action, "screen_type")
        let line = try request.bridgeLine()
        XCTAssertEqual(line.last, 0x0A)
        let decoded = try JSONSerialization.jsonObject(with: line.dropLast()) as! [String: Any]
        XCTAssertEqual(Set(decoded.keys), ["id", "action", "payload"], "nonce, mac and createdAt never reach the bridge")
    }

    // MARK: signature

    func testATamperedPayloadFailsTheSignature() {
        var object = try! JSONSerialization.jsonObject(with: signed()) as! [String: Any]
        object["payload"] = ["expected_bundle_id": "com.apple.TextEdit", "text": "rm -rf"]
        let data = try! JSONSerialization.data(withJSONObject: object)
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .badMAC)
    }

    func testAWrongKeyOrMissingKeyFailsTheSignature() {
        let wrong = RelayValidator(key: { Data(repeating: 7, count: 32) }, now: { [clock] in clock })
        XCTAssertEqual(rejection(wrong.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())), .badMAC)
        let none = RelayValidator(key: { nil }, now: { [clock] in clock })
        XCTAssertEqual(rejection(none.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())), .badMAC)
        let short = RelayValidator(key: { Data(repeating: 0, count: 16) }, now: { [clock] in clock })
        XCTAssertEqual(rejection(short.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())), .badMAC)
    }

    func testAMalformedMACIsRefused() {
        let data = signed(macOverride: "zz")
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .badMAC)
    }

    // MARK: freshness and replay

    func testARequestOlderThanFifteenSecondsIsStale() {
        let v = makeValidator()
        let ok = signed(createdAt: createdAt - 15_000, nonce: "0123456789abcdef0123456789abcdef")
        XCTAssertNil(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: ok)))
        let old = signed(createdAt: createdAt - 15_001)
        XCTAssertEqual(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: old)), .stale)
    }

    func testARequestFromTheFutureIsRefused() {
        let data = signed(createdAt: createdAt + 5_000)
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .fromTheFuture)
    }

    func testTheSameNonceTwiceIsAReplay() {
        let v = makeValidator()
        XCTAssertNil(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())))
        XCTAssertEqual(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())), .replay)
    }

    func testANonceIsForgottenOnlyAfterItCouldNoLongerBeFresh() {
        let v = makeValidator()
        XCTAssertNil(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())))
        clock = clock.addingTimeInterval(10)
        XCTAssertEqual(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())), .replay)
        clock = clock.addingTimeInterval(30)
        XCTAssertEqual(rejection(v.validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: signed())), .stale)
    }

    // MARK: allowlist

    func testEveryNonScreenBridgeActionIsRefusedEvenWhenSigned() {
        let forbidden = ["list_upcoming_calendar_events", "create_calendar_event", "delete_calendar_event", "move_calendar_event",
                         "create_reminder", "complete_reminder", "notify", "status", "screen_capture",
                         "request_accessibility", "request_calendar_access", "set_clock_timer", "exec", ""]
        for (i, action) in forbidden.enumerated() {
            let nonce = String(format: "%032x", i + 1)
            let data = signed(action: action, payload: [:], nonce: nonce)
            XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)),
                           .actionNotAllowed(action), action)
        }
    }

    func testEveryAllowedScreenActionPasses() {
        for (i, action) in RelayProtocol.allowedActions.sorted().enumerated() {
            let data = signed(action: action, payload: ["expected_bundle_id": "com.apple.TextEdit"], nonce: String(format: "%032x", 100 + i))
            XCTAssertNil(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), action)
        }
    }

    func testAnUnknownPayloadKeyIsRefused() {
        let data = signed(payload: ["expected_bundle_id": "x", "command": "ls"])
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .badKey("command"))
    }

    // MARK: size caps and shape

    func testAnOversizedValueIsRefused() {
        let data = signed(payload: ["expected_bundle_id": "x", "text": String(repeating: "a", count: 8 * 1024 + 1)])
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .valueTooLarge("text"))
    }

    func testAnOversizedFileIsRefusedBeforeParsing() {
        let data = Data(repeating: 0x20, count: 64 * 1024 + 1)
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "x", data: data)), .tooLarge)
    }

    func testTooManyKeysIsRefused() {
        let payload = Dictionary(uniqueKeysWithValues: (0..<17).map { ("k_\(String(UnicodeScalar(97 + $0)!))", "v") })
        let data = signed(payload: payload)
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .tooManyKeys)
    }

    func testIdsMustBeUUIDsThatMatchTheFileName() {
        let traversal = signed(id: "../../etc/passwd")
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "../../etc/passwd", data: traversal)), .badID)
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", data: signed())), .idMismatch)
    }

    func testMalformedJSONAndBadNoncesAreRefused() {
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "x", data: Data("{".utf8))), .malformed)
        let numericPayload = Data(#"{"id":"3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b","action":"screen_click","payload":{"x":1},"createdAt":1,"nonce":"00","mac":"00"}"#.utf8)
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: numericPayload)), .malformed)
        let data = signed(nonce: "short")
        XCTAssertEqual(rejection(makeValidator().validate(fileStem: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b", data: data)), .badNonce)
    }
}
