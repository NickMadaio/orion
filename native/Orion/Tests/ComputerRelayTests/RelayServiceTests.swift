@testable import ComputerRelay
import Darwin
import Foundation
import XCTest

/// The relay host against a temp directory and a fake bridge: files in, signed files out.
final class RelayServiceTests: XCTestCase {
    final class FakeBridge: BridgeRunning {
        var lines: [Data] = []
        var reply: Result<Data, BridgeRunFailure>
        init(reply: Result<Data, BridgeRunFailure>) { self.reply = reply }
        func run(line: Data) -> Result<Data, BridgeRunFailure> {
            lines.append(line)
            return reply
        }
    }

    var root: URL!
    var dir: URL!
    var keyURL: URL!
    let key = Data((0..<32).map { UInt8($0) })
    var clock = Date(timeIntervalSince1970: 1_761_900_000)
    let id = "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b"
    let nonce = "00112233445566778899aabbccddeeff"

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("relay-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        dir = root.appendingPathComponent("computer-relay")
        keyURL = root.appendingPathComponent("computer-relay.key")
        try RelayFiles.ensureDirectory(dir)
        FileManager.default.createFile(atPath: keyURL.path, contents: key, attributes: [.posixPermissions: 0o600])
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func makeService(_ bridge: BridgeRunning?) -> RelayService {
        RelayService(directory: dir, keyURL: keyURL, bridge: { bridge }, now: { [unowned self] in self.clock })
    }

    func drop(action: String = "screen_type", payload: [String: String] = ["expected_bundle_id": "com.apple.TextEdit", "text": "orion test"]) throws {
        let createdAt: Int64 = 1_761_900_000_000
        let canonical = RelayProtocol.canonicalRequest(id: id, action: action, createdAt: createdAt, nonce: nonce, payload: payload)
        let object: [String: Any] = ["id": id, "action": action, "payload": payload, "createdAt": createdAt, "nonce": nonce,
                                     "mac": RelayProtocol.mac(key: key, canonical: canonical)]
        try RelayFiles.writeAtomically(JSONSerialization.data(withJSONObject: object), to: dir.appendingPathComponent("\(id).req.json"))
    }

    func response() throws -> [String: Any] {
        let data = try Data(contentsOf: dir.appendingPathComponent("\(id).res.json"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    func assertSigned(_ res: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
        let canonical = RelayProtocol.canonicalResponse(
            id: res["id"] as! String, nonce: res["nonce"] as! String, ok: res["ok"] as! Bool,
            error: res["error"] as? String, result: res["result"] as? [String: String] ?? [:])
        XCTAssertEqual(res["mac"] as? String, RelayProtocol.mac(key: key, canonical: canonical), file: file, line: line)
    }

    func testARequestIsRunConsumedAndAnsweredWithASignedResponse() throws {
        let bridge = FakeBridge(reply: .success(Data(#"{"id":"x","ok":true,"result":{"app_name":"TextEdit","n":1}}"#.utf8 + [0x0A])))
        try drop()
        XCTAssertEqual(makeService(bridge).processPending(), [id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id).req.json").path), "consumed")
        let res = try response()
        XCTAssertEqual(res["ok"] as? Bool, true)
        XCTAssertEqual(res["nonce"] as? String, nonce)
        XCTAssertEqual(res["result"] as? [String: String], ["app_name": "TextEdit"], "non-string results are dropped")
        assertSigned(res)
        let sent = try JSONSerialization.jsonObject(with: bridge.lines[0].dropLast()) as! [String: Any]
        XCTAssertEqual(sent["action"] as? String, "screen_type")
        XCTAssertEqual(sent["payload"] as? [String: String], ["expected_bundle_id": "com.apple.TextEdit", "text": "orion test"])
        var info = stat()
        XCTAssertEqual(lstat(dir.appendingPathComponent("\(id).res.json").path, &info), 0)
        XCTAssertEqual(info.st_mode & 0o777, 0o600)
    }

    func testAForbiddenActionNeverReachesTheBridgeAndGetsASignedRefusal() throws {
        let bridge = FakeBridge(reply: .success(Data()))
        try drop(action: "create_calendar_event", payload: [:])
        makeService(bridge).processPending()
        XCTAssertTrue(bridge.lines.isEmpty)
        let res = try response()
        XCTAssertEqual(res["ok"] as? Bool, false)
        XCTAssertTrue((res["error"] as? String ?? "").hasPrefix("relay refused: action 'create_calendar_event'"))
        assertSigned(res)
    }

    func testABridgeFailureIsPassedThroughHonestly() throws {
        try drop()
        makeService(FakeBridge(reply: .success(Data(#"{"id":"x","ok":false,"error":"Accessibility is not granted."}"#.utf8)))).processPending()
        XCTAssertEqual(try response()["error"] as? String, "Accessibility is not granted.")
        try drop()
        clock = clock.addingTimeInterval(0.001)
        let replay = makeService(FakeBridge(reply: .failure(.timedOut)))
        replay.processPending()
        XCTAssertEqual(try response()["error"] as? String, BridgeRunFailure.timedOut.description)
    }

    func testAMissingBridgeSaysSo() throws {
        try drop()
        makeService(nil).processPending()
        XCTAssertEqual(try response()["error"] as? String, "the Orion app can't find orion-mac-bridge")
    }

    func testAnUnnamedJunkFileIsDroppedWithoutAnAnswer() throws {
        try Data("not json".utf8).write(to: dir.appendingPathComponent("junk.req.json"))
        XCTAssertEqual(makeService(FakeBridge(reply: .success(Data()))).processPending(), [])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: dir.path), [])
    }

    func testASymlinkedRequestIsNotFollowed() throws {
        let target = root.appendingPathComponent("elsewhere.json")
        try Data("{}".utf8).write(to: target)
        try FileManager.default.createSymbolicLink(at: dir.appendingPathComponent("\(id).req.json"), withDestinationURL: target)
        let bridge = FakeBridge(reply: .success(Data()))
        makeService(bridge).processPending()
        XCTAssertTrue(bridge.lines.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.path), "the link target is untouched")
    }

    func testTheHeartbeatSaysWhetherTheAppIsTrustedAndHasABridge() throws {
        makeService(FakeBridge(reply: .success(Data()))).writeHeartbeat(accessibility: true)
        let beat = try JSONDecoder().decode(RelayService.Heartbeat.self, from: Data(contentsOf: dir.appendingPathComponent("heartbeat.json")))
        XCTAssertEqual(beat.accessibility, true)
        XCTAssertEqual(beat.bridge, "ready")
        XCTAssertEqual(beat.at, 1_761_900_000_000)
        makeService(nil).writeHeartbeat(accessibility: false)
        let missing = try JSONDecoder().decode(RelayService.Heartbeat.self, from: Data(contentsOf: dir.appendingPathComponent("heartbeat.json")))
        XCTAssertEqual(missing.bridge, "missing")
    }

    // MARK: file-system rules

    func testALooseDirectoryIsRefused() throws {
        let loose = root.appendingPathComponent("loose")
        try FileManager.default.createDirectory(at: loose, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
        XCTAssertThrowsError(try RelayFiles.ensureDirectory(loose))
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: dir)
        XCTAssertThrowsError(try RelayFiles.ensureDirectory(link))
    }

    func testAKeyReadableByOthersIsRefused() throws {
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: keyURL.path)
        guard case .failure = RelayFiles.readKey(keyURL) else { return XCTFail("a 0644 key must be refused") }
        let bridge = FakeBridge(reply: .success(Data()))
        try drop()
        makeService(bridge).processPending()
        XCTAssertTrue(bridge.lines.isEmpty, "no usable key, nothing runs")
    }

    func testABridgeBinaryOthersCanRewriteIsRefused() throws {
        let binary = root.appendingPathComponent("bridge")
        FileManager.default.createFile(atPath: binary.path, contents: Data("#!/bin/sh\n".utf8), attributes: [.posixPermissions: 0o775])
        XCTAssertEqual(ProcessBridgeRunner.checkBinary(binary), "writable by group or others")
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: binary.path)
        XCTAssertNil(ProcessBridgeRunner.checkBinary(binary))
    }

    func testTheProcessRunnerSpawnsTheBridgeAndReadsOneLine() throws {
        let binary = root.appendingPathComponent("bridge.sh")
        let script = "#!/bin/sh\nread line\nprintf '{\"id\":\"1\",\"ok\":true,\"result\":{\"echo\":\"%s\"}}\\n' \"$(printf %s \"$line\" | wc -c | tr -d ' ')\"\n"
        FileManager.default.createFile(atPath: binary.path, contents: Data(script.utf8), attributes: [.posixPermissions: 0o700])
        let out = try ProcessBridgeRunner(binary: binary, timeout: 5).run(line: Data("{\"a\":1}\n".utf8)).get()
        let (ok, _, result) = RelayService.parseBridgeOutput(out)
        XCTAssertTrue(ok)
        XCTAssertEqual(result["echo"], "7")
    }

    func testTheProcessRunnerKillsAHungBridge() throws {
        let binary = root.appendingPathComponent("hang.sh")
        FileManager.default.createFile(atPath: binary.path, contents: Data("#!/bin/sh\nexec sleep 30\n".utf8), attributes: [.posixPermissions: 0o700])
        let started = Date()
        XCTAssertEqual(ProcessBridgeRunner(binary: binary, timeout: 0.5).run(line: Data("{}\n".utf8)), .failure(.timedOut))
        XCTAssertLessThan(Date().timeIntervalSince(started), 4)
    }
}
