//
//  The command socket, over a real socket.
//
//  These connect for real rather than calling `handle` directly. The properties
//  worth testing here — a stale socket file being reclaimed, a client failing
//  loudly when nothing is listening, a retry being reported as a duplicate —
//  are properties of the socket, and testing the dispatch function instead
//  would prove none of them.
//

import XCTest
@testable import SessionDomain
@testable import SessionService

final class IPCTests: XCTestCase {

    private var directory: URL!
    private var socketURL: URL!
    private var service: SessionService!
    private var ipc: SessionIPC!
    private var wall: StubWallClock!
    private var monotonic: StubMonotonicClock!

    override func setUp() {
        super.setUp()
        // Short path: a unix socket path is capped near 104 bytes, and the
        // default temporary directory plus a UUID gets close enough to matter.
        directory = URL(fileURLWithPath: "/tmp")
            .appendingPathComponent("orion-ipc-\(Int.random(in: 100000...999999))")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        socketURL = directory.appendingPathComponent("s.sock")

        wall = StubWallClock(Date(timeIntervalSince1970: 1_772_452_800))
        monotonic = StubMonotonicClock(3600)
        service = SessionService(
            store: SessionStore(url: directory.appendingPathComponent("focus-state.json")),
            history: SessionHistory(url: directory.appendingPathComponent("focus-history.jsonl")),
            clocks: Clocks(wall: wall, monotonic: monotonic),
            effects: NullEffectHandler()
        )
        ipc = SessionIPC(service: service, socketURL: socketURL)
    }

    override func tearDown() {
        ipc?.stop()
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    // MARK: A real client

    /// Connect, send one line, read one line. What the node client does.
    private func ask(_ request: SessionRequest) throws -> SessionResponse {
        let client = socket(AF_UNIX, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(client, 0)
        defer { close(client) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        _ = withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            socketURL.path.withCString { source in
                strncpy(UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self),
                        source, capacity - 1)
            }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(client, $0, size)
            }
        }
        guard connected == 0 else { throw NSError(domain: "ipc", code: Int(errno)) }

        var payload = try JSONEncoder().encode(request)
        payload.append(0x0A)
        _ = payload.withUnsafeBytes { write(client, $0.baseAddress!, $0.count) }

        var reply = Data()
        var byte: UInt8 = 0
        while read(client, &byte, 1) > 0 {
            if byte == 0x0A { break }
            reply.append(byte)
        }
        return try JSONDecoder().decode(SessionResponse.self, from: reply)
    }

    // MARK: Tests

    func testStatusWithNoSessionSaysNoneRatherThanFailing() throws {
        XCTAssertTrue(ipc.start())

        let response = try ask(SessionRequest(op: "status"))

        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.status, "none")
        XCTAssertNil(response.unreadable)
    }

    func testAFullCycleOverTheSocket() throws {
        XCTAssertTrue(ipc.start())

        var response = try ask(SessionRequest(op: "start", requestId: "r1", task: "write the thing",
                                              focusBlocks: 2, focusMinutes: 2, restMinutes: 1))
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.status, "running")
        XCTAssertEqual(response.phase, "focus")
        XCTAssertEqual(response.task, "write the thing")

        wall.advance(30); monotonic.advance(30)

        response = try ask(SessionRequest(op: "pause", requestId: "r2"))
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.status, "paused")

        response = try ask(SessionRequest(op: "resume", requestId: "r3"))
        XCTAssertEqual(response.status, "running")

        response = try ask(SessionRequest(op: "finish", requestId: "r4"))
        XCTAssertEqual(response.status, "finished")
        XCTAssertEqual(response.phase, "early")
    }

    func testARetriedCommandComesBackAsADuplicateAndStillReadsAsSuccess() throws {
        XCTAssertTrue(ipc.start())
        _ = try ask(SessionRequest(op: "start", requestId: "r1", task: "t",
                                   focusBlocks: 2, focusMinutes: 2, restMinutes: 1))
        wall.advance(30); monotonic.advance(30)

        let first = try ask(SessionRequest(op: "pause", requestId: "same"))
        let retry = try ask(SessionRequest(op: "pause", requestId: "same"))

        XCTAssertTrue(first.ok)
        XCTAssertFalse(first.duplicate)
        XCTAssertTrue(retry.ok, "a retry that finds the work done is success")
        XCTAssertTrue(retry.duplicate)
        XCTAssertEqual(retry.status, "paused")
    }

    func testACommandWithoutARequestIdIsRefused() throws {
        XCTAssertTrue(ipc.start())

        let response = try ask(SessionRequest(op: "pause"))

        XCTAssertFalse(response.ok)
        XCTAssertTrue(response.error?.contains("requestId") ?? false, response.error ?? "")
    }

    func testStartingWithoutATaskIsRefused() throws {
        XCTAssertTrue(ipc.start())

        let response = try ask(SessionRequest(op: "start", requestId: "r1"))

        XCTAssertFalse(response.ok)
        XCTAssertNotNil(response.error)
    }

    func testAnUnknownCommandIsRefusedByName() throws {
        XCTAssertTrue(ipc.start())

        let response = try ask(SessionRequest(op: "self-destruct", requestId: "r1"))

        XCTAssertFalse(response.ok)
        XCTAssertTrue(response.error?.contains("self-destruct") ?? false, response.error ?? "")
    }

    func testGarbageOnTheSocketDoesNotKillTheServer() throws {
        XCTAssertTrue(ipc.start())

        let client = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        _ = withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            socketURL.path.withCString { source in
                strncpy(UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self),
                        source, capacity - 1)
            }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        _ = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(client, $0, size) }
        }
        _ = "not json at all\n".withCString { write(client, $0, strlen($0)) }
        close(client)

        // Still serving.
        XCTAssertEqual(try ask(SessionRequest(op: "status")).status, "none")
    }

    // MARK: The socket file itself

    func testAStaleSocketFileIsReclaimed() throws {
        // A process killed without cleanup leaves this behind. bind() will not
        // replace it, so the server has to.
        FileManager.default.createFile(atPath: socketURL.path, contents: Data())

        XCTAssertTrue(ipc.start(), "a dead socket file must not lock Orion out of its own socket")
        XCTAssertEqual(try ask(SessionRequest(op: "status")).status, "none")
    }

    func testASecondServerRefusesToStealALiveSocket() throws {
        XCTAssertTrue(ipc.start())

        let second = SessionIPC(service: service, socketURL: socketURL)
        var logged: String?
        second.onLog = { logged = $0 }

        XCTAssertFalse(second.start(), "two servers on one socket is two writers")
        XCTAssertTrue(logged?.contains("already owns") ?? false, logged ?? "nothing logged")
    }

    func testTheSocketIsNotWorldAccessible() throws {
        XCTAssertTrue(ipc.start())

        let attributes = try FileManager.default.attributesOfItem(atPath: socketURL.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
        XCTAssertEqual(permissions & 0o077, 0)
    }

    func testStoppingRemovesTheSocketSoNothingIsLeftListening() throws {
        XCTAssertTrue(ipc.start())
        ipc.stop()

        XCTAssertFalse(FileManager.default.fileExists(atPath: socketURL.path))
    }

    /// The property the whole design rests on: with the app down there is no
    /// socket, so a client cannot do anything at all — least of all start its
    /// own engine.
    func testWithNoServerAClientCannotConnect() {
        XCTAssertThrowsError(try ask(SessionRequest(op: "status")))
    }
}
