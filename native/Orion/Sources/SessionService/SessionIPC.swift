//
//  The typed command socket. Scripts are clients; they are never a second engine.
//
//  A unix socket at ~/.openclaw/orion-session.sock, one JSON request per
//  connection, one JSON response back. Same shape and the same directory as
//  orion-tts.sock, so there is one convention for "talk to Orion's app" rather
//  than two.
//
//  The important property is what happens when the app is NOT running: the
//  socket does not exist, the client's connect fails, and the client says so.
//  It does not fall back to reading the state file, and it certainly does not
//  fall back to running its own engine. A script that can start a session
//  without the app is a second writer, and a second writer is the bug this
//  entire design exists to prevent.
//
//  Every request carries a `requestId`. The reducer refuses one it has already
//  applied, so a client that times out and retries — the normal case over a
//  socket — gets "already done" rather than a second pause.
//
//  Local only, by construction: a unix socket has no port and no address, so
//  nothing off this machine can reach it. The file is created 0600 anyway.
//

import Foundation
import SessionDomain

// MARK: - Wire types

/// What a client sends.
public struct SessionRequest: Codable, Sendable {
    public let op: String
    public let requestId: String?

    // Payload fields, all optional because each op uses a different few.
    public let task: String?
    public let focusBlocks: Int?
    public let focusMinutes: Double?
    public let restMinutes: Double?
    public let clips: [String]?
    public let minutes: Double?
    /// Bundle identifiers Nick has confirmed for `arm`.
    public let allow: [String]?
    /// "gentle", "guided", "firm", or "shield".
    public let level: String?

    public init(op: String, requestId: String? = nil, task: String? = nil,
                focusBlocks: Int? = nil, focusMinutes: Double? = nil,
                restMinutes: Double? = nil, clips: [String]? = nil, minutes: Double? = nil,
                allow: [String]? = nil, level: String? = nil) {
        self.op = op
        self.requestId = requestId
        self.task = task
        self.focusBlocks = focusBlocks
        self.focusMinutes = focusMinutes
        self.restMinutes = restMinutes
        self.clips = clips
        self.minutes = minutes
        self.allow = allow
        self.level = level
    }
}

/// What it gets back. Deliberately flat and boring — a shell script has to be
/// able to read it with `jq -r .status`.
public struct SessionResponse: Codable, Sendable {
    public var ok: Bool
    /// True when the command had already been applied. `ok` is also true: from
    /// the caller's side a retry that finds the work done is success.
    public var duplicate: Bool = false
    public var error: String?

    public var status: String?
    public var phase: String?
    public var phaseIndex: Int?
    public var blockNumber: Int?
    public var totalBlocks: Int?
    public var task: String?
    public var servedSeconds: Double?
    public var remainingSeconds: Double?
    public var servedFocusSeconds: Double?
    public var uncountedSeconds: Double?
    public var approximate: Bool?
    public var dayKey: String?
    public var sessionId: String?

    /// Set when the state file could not be read. Distinct from "no session",
    /// which is `status: "none"`.
    public var unreadable: String?

    /// Enforcement, when it is running.
    public var enforcement: String?
    /// Apps proposed by `preflight`, for Nick to confirm.
    public var proposedApps: [String]?
    public var proposedBundleIDs: [String]?
    /// Set when a sensor cannot be read, so the UI never implies cover it does
    /// not have.
    public var sensorsUnavailable: String?

    /// Message answers. Empty and unreadable are different, so both exist.
    public var messages: [MessageLine]?
    public var chats: [ChatLine]?
    public var messagesUnavailable: String?

    public init(ok: Bool) { self.ok = ok }

    public static func failure(_ message: String) -> SessionResponse {
        var response = SessionResponse(ok: false)
        response.error = message
        return response
    }
}

// MARK: - Translating a snapshot

public enum SessionWire {

    public static func describe(_ snapshot: SessionSnapshot) -> SessionResponse {
        var response = SessionResponse(ok: true)

        if let failure = snapshot.failure {
            response.unreadable = failure.message
        }

        guard let session = snapshot.session, let now = snapshot.reconciliation else {
            response.status = "none"
            return response
        }

        response.sessionId = session.id.raw
        response.dayKey = session.dayKey
        response.task = session.plan.task
        response.phaseIndex = now.phaseIndex
        response.servedSeconds = now.servedInPhase
        response.remainingSeconds = now.remainingInPhase
        response.servedFocusSeconds = now.servedFocus
        response.uncountedSeconds = now.uncounted
        response.approximate = now.approximate
        response.totalBlocks = now.totalFocusBlocks
        response.blockNumber = min(now.completedFocusBlocks + 1, now.totalFocusBlocks)

        switch now.status {
        case .notStarted:
            response.status = "not-started"
        case .running(let kind):
            response.status = "running"
            response.phase = kind.rawValue
        case .paused:
            response.status = "paused"
        case .waitingForReturn:
            response.status = "waiting-for-return"
        case .readyToComplete:
            response.status = "finishing"
        case .readyToAbandon:
            response.status = "abandoning"
        case .finished(let reason):
            response.status = "finished"
            response.phase = reason.rawValue
        }
        return response
    }
}

// MARK: - The server

public final class SessionIPC {

    public static var defaultSocketURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw")
            .appendingPathComponent("orion-session.sock")
    }

    private let service: SessionService

    /// Optional so the socket can be tested without sensors. When absent, the
    /// enforcement commands say so rather than pretending to work.
    private let enforcer: Enforcer?

    /// Supplied by the app, which is the process that actually holds Full Disk
    /// Access. Absent in tests and headless runs, where the message ops say so.
    private weak var messages: (any MessageReading)?

    private let socketURL: URL
    private var listener: Int32 = -1
    private var thread: Thread?
    private var running = false

    /// Where a stale socket file is reported. The app logs it; tests read it.
    public var onLog: ((String) -> Void)?

    public init(service: SessionService, enforcer: Enforcer? = nil,
                messages: (any MessageReading)? = nil, socketURL: URL? = nil) {
        self.service = service
        self.enforcer = enforcer
        self.messages = messages
        if let socketURL {
            self.socketURL = socketURL
        } else if let override = ProcessInfo.processInfo.environment["ORION_SESSION_SOCKET"],
                  !override.isEmpty {
            self.socketURL = URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        } else {
            self.socketURL = Self.defaultSocketURL
        }
    }

    deinit { stop() }

    // MARK: Lifecycle

    @discardableResult
    public func start() -> Bool {
        guard listener < 0 else { return true }

        // The default disposition of SIGPIPE is to KILL THE PROCESS, and a
        // client that hangs up before reading its reply raises one. A killed
        // script, a client timeout, or somebody poking the socket with `nc` all
        // do that routinely, and none of them should be able to take Orion down.
        //
        // Ignored process-wide as well as per-socket below. SO_NOSIGPIPE only
        // covers sockets this class owns; ignoring the signal covers the whole
        // process, which is what every long-lived server does and what makes
        // this safe regardless of which end of which socket hung up. Writes
        // return EPIPE instead, which the write loop already handles.
        signal(SIGPIPE, SIG_IGN)

        try? FileManager.default.createDirectory(
            at: socketURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )

        // A socket file left by a process that was killed does not accept
        // connections, and bind() will not replace it. Removing it is safe for
        // the same reason breaking a stale lock is: if anything were listening,
        // the connect below would have succeeded.
        if FileManager.default.fileExists(atPath: socketURL.path) {
            if isSomebodyListening() {
                onLog?("[session] another instance already owns \(socketURL.lastPathComponent)")
                return false
            }
            unlink(socketURL.path)
        }

        listener = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else {
            onLog?("[session] could not create the command socket: \(errnoText())")
            return false
        }

        guard var address = Self.address(for: socketURL.path) else {
            onLog?("[session] socket path is too long: \(socketURL.path)")
            closeListener()
            return false
        }

        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, size) }
        }
        guard bound == 0 else {
            onLog?("[session] could not bind the command socket: \(errnoText())")
            closeListener()
            return false
        }

        chmod(socketURL.path, 0o600)

        guard listen(listener, 8) == 0 else {
            onLog?("[session] could not listen on the command socket: \(errnoText())")
            closeListener()
            return false
        }

        running = true
        let thread = Thread { [weak self] in self?.acceptLoop() }
        thread.name = "com.nickmadaio.orion.session.ipc"
        thread.start()
        self.thread = thread
        return true
    }

    public func stop() {
        running = false
        closeListener()
        unlink(socketURL.path)
    }

    private func closeListener() {
        if listener >= 0 { close(listener) }
        listener = -1
    }

    /// Connect to the existing socket to find out whether it is live or stale.
    private func isSomebodyListening() -> Bool {
        let probe = socket(AF_UNIX, SOCK_STREAM, 0)
        guard probe >= 0 else { return false }
        defer { close(probe) }

        guard var address = Self.address(for: socketURL.path) else { return false }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(probe, $0, size) == 0
            }
        }
    }

    /// Build a `sockaddr_un` for a path, or nil if the path will not fit.
    ///
    /// The capacity is read into a local BEFORE the pointer is taken. Reading
    /// `address.sun_path` inside `withUnsafeMutablePointer(to: &address.sun_path)`
    /// is an overlapping access to the same storage, and Swift 6 rejects it.
    private static func address(for path: String) -> sockaddr_un? {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)

        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard path.utf8.count < capacity else { return nil }

        _ = withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            path.withCString { source in
                strncpy(UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self),
                        source, capacity - 1)
            }
        }
        return address
    }

    // MARK: Serving

    private func acceptLoop() {
        while running {
            let connection = accept(listener, nil, nil)
            guard connection >= 0 else {
                if running && errno != EINTR { usleep(50_000) }
                continue
            }
            // Writing to a socket whose client has already hung up raises
            // SIGPIPE, and the default disposition for SIGPIPE is to kill the
            // process. A client that sends a request and disconnects before
            // reading the reply would therefore take Orion down with it — which
            // a `curl`-style probe, a killed script, or a client timeout all do
            // routinely. SO_NOSIGPIPE turns it into an EPIPE return instead.
            var on: Int32 = 1
            setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &on,
                       socklen_t(MemoryLayout<Int32>.size))

            serve(connection)
            close(connection)
        }
    }

    private func serve(_ connection: Int32) {
        guard let line = readLine(from: connection) else { return }

        let response: SessionResponse
        do {
            let request = try JSONDecoder().decode(SessionRequest.self, from: line)
            response = handle(request)
        } catch {
            response = .failure("could not parse that request: \(error.localizedDescription)")
        }

        guard var payload = try? JSONEncoder().encode(response) else { return }
        payload.append(0x0A)
        payload.withUnsafeBytes { buffer in
            var sent = 0
            while sent < buffer.count {
                let wrote = write(connection, buffer.baseAddress!.advanced(by: sent),
                                  buffer.count - sent)
                if wrote <= 0 { break }
                sent += wrote
            }
        }
    }

    private func readLine(from connection: Int32) -> Data? {
        var data = Data()
        var byte: UInt8 = 0
        // Requests are one short line. A client that opens a connection and
        // says nothing must not hold the accept loop, so the socket carries a
        // receive timeout.
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout,
                   socklen_t(MemoryLayout<timeval>.size))

        while data.count < 64 * 1024 {
            let got = read(connection, &byte, 1)
            if got <= 0 { break }
            if byte == 0x0A { return data }
            data.append(byte)
        }
        return data.isEmpty ? nil : data
    }

    // MARK: Dispatch

    private func handle(_ request: SessionRequest) -> SessionResponse {
        // Status asks nothing of the writer, so it needs no request id.
        if request.op == "status" {
            var response = SessionWire.describe(service.snapshot())
            annotate(&response)
            return response
        }

        // The escape. Deliberately BEFORE the request-id check and before any
        // session lookup: it must work in every state of the world, including
        // with no session, a corrupt state file, and a client that forgot to
        // generate an id. There is no condition under which Nick is told he
        // cannot get out.
        if request.op == "release" {
            guard let enforcer else {
                return .failure("enforcement is not running, so there is nothing to release")
            }
            enforcer.release()
            var response = SessionWire.describe(service.snapshot())
            annotate(&response)
            return response
        }

        // Messages. Read-only, and answered by the app because it is the only
        // process here with Full Disk Access.
        if request.op == "messages" || request.op == "chats" {
            guard let messages else {
                return .failure("Orion cannot reach the Messages database from here.")
            }
            var response = SessionResponse(ok: true)
            if let why = messages.unavailable {
                response.messagesUnavailable = why
                return response
            }
            let limit = max(1, min(200, Int(request.minutes ?? 20)))
            if request.op == "chats" {
                response.chats = messages.chats(limit: limit)
            } else if let who = request.task, !who.isEmpty {
                response.messages = messages.from(who, limit: limit)
            } else {
                response.messages = messages.recent(limit: limit)
            }
            return response
        }

        if request.op == "preflight" {
            guard let enforcer else { return .failure("enforcement is not available") }
            let (list, apps) = enforcer.preflight(forTask: request.task ?? "")
            var response = SessionWire.describe(service.snapshot())
            // Both arrays come from ONE ordered list, so index i is the same app
            // in each. Never sort these separately.
            response.proposedApps = apps.map(\.name)
            response.proposedBundleIDs = apps.map(\.bundleID)
            _ = list
            annotate(&response)
            return response
        }

        if request.op == "arm" {
            guard let enforcer else { return .failure("enforcement is not available") }
            guard let allow = request.allow, !allow.isEmpty else {
                return .failure("arming needs the list of apps you are confirming — "
                              + "run preflight first")
            }
            let level = EnforcementLevel(rawValue: request.level ?? "gentle") ?? .gentle
            enforcer.arm(Allowlist(bundleIDs: Set(allow)),
                         policy: EnforcementPolicy(level: level))
            var response = SessionWire.describe(service.snapshot())
            annotate(&response)
            return response
        }

        guard let requestId = request.requestId, !requestId.isEmpty else {
            return .failure("every command needs a requestId so retries are safe")
        }

        let kind: CommandKind
        switch request.op {
        case "start":
            guard let task = request.task, !task.trimmingCharacters(in: .whitespaces).isEmpty else {
                return .failure("starting a session needs a task to name it")
            }
            let session = SessionID("s-\(requestId)")
            kind = .start(plan: SessionPlanBuilder.alternating(
                session: session,
                focusBlocks: request.focusBlocks ?? 3,
                focus: (request.focusMinutes ?? 50) * 60,
                rest: (request.restMinutes ?? 10) * 60,
                clips: (request.clips ?? []).map { ClipAssignment(name: $0) },
                task: task
            ))
        case "pause":   kind = .pause
        case "resume":  kind = .resume
        case "skip":    kind = .skipRest
        case "shorten":
            guard let minutes = request.minutes else {
                return .failure("shorten needs the minutes to leave")
            }
            kind = .shortenRest(to: minutes * 60)
        case "finish":  kind = .finishEarly
        case "abandon": kind = .abandon
        case "idle":    kind = .noteIdle
        case "back":    kind = .noteReturned
        default:
            return .failure("unknown command: \(request.op)")
        }

        let command = Command(requestID: RequestID(requestId), origin: .script,
                              issuedAt: Date(), kind: kind)
        let outcome = service.send(command)

        var response = SessionWire.describe(outcome.snapshot)
        if outcome.accepted {
            response.ok = true
        } else if outcome.wasDuplicate {
            response.ok = true
            response.duplicate = true
        } else {
            response.ok = false
            response.error = outcome.rejection?.message ?? "that command did not apply"
        }
        return response
    }

    /// Add enforcement and sensor state to any reply.
    ///
    /// Sensor unavailability is reported on EVERY response rather than only
    /// when asked, because a UI that shows enforcement as on while a sensor is
    /// dark is claiming cover it does not have.
    private func annotate(_ response: inout SessionResponse) {
        guard let enforcer else { return }
        if enforcer.isReleased {
            response.enforcement = "released"
        } else if !enforcer.isArmed {
            response.enforcement = "off"
        } else if enforcer.hasDisengaged {
            response.enforcement = "disengaged"
        } else {
            response.enforcement = enforcer.policy.level.rawValue
        }
        response.sensorsUnavailable = enforcer.sensorDisclosure
    }

    private func errnoText() -> String {
        String(cString: strerror(errno))
    }
}
