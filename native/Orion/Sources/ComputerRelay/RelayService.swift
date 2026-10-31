import Darwin
import Foundation

/// The app side of the computer relay: watches the relay directory, takes each signed request,
/// runs the allowlisted bridge action as this process's child, and writes a signed response.
///
/// Sequential on one serial queue. A request file is consumed (deleted) the moment it is read,
/// so a file can never be run twice even across a restart; the nonce cache covers copies.
public final class RelayService {
    public struct Heartbeat: Codable, Equatable {
        public let pid: Int32
        public let at: Int64
        public let accessibility: Bool
        public let bridge: String
    }

    public let directory: URL
    private let keyURL: URL
    private let bridge: () -> BridgeRunning?
    private let now: () -> Date
    private let log: (String) -> Void
    private let validator: RelayValidator
    private let queue = DispatchQueue(label: "orion.computer-relay")
    private var watcher: DispatchSourceFileSystemObject?
    private var fastPoll: DispatchSourceTimer?
    private var slowPoll: DispatchSourceTimer?

    public static let heartbeatName = "heartbeat.json"
    static let staleLeftoverSeconds: TimeInterval = 60

    public init(directory: URL, keyURL: URL, bridge: @escaping () -> BridgeRunning?,
                now: @escaping () -> Date = Date.init, log: @escaping (String) -> Void = { _ in }) {
        self.directory = directory
        self.keyURL = keyURL
        self.bridge = bridge
        self.now = now
        self.log = log
        self.validator = RelayValidator(key: { try? RelayFiles.readKey(keyURL).get() }, now: now)
    }

    // MARK: processing

    /// Handles every pending request once, oldest name first. Returns the ids answered.
    @discardableResult
    public func processPending() -> [String] {
        removeLeftovers()
        return pendingRequests().compactMap(handle)
    }

    func pendingRequests() -> [URL] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasSuffix(".req.json") && !$0.hasPrefix(".") }.sorted()
            .map { directory.appendingPathComponent($0) }
    }

    private func handle(_ url: URL) -> String? {
        let stem = String(url.lastPathComponent.dropLast(".req.json".count))
        let data = RelayFiles.readRegular(url, limit: RelayProtocol.Limits.maxRequestBytes)
        unlink(url.path)
        guard let data else {
            log("computer-relay: dropped \(url.lastPathComponent.prefix(60)): unreadable or over the size cap")
            return nil
        }
        switch validator.validate(fileStem: stem, data: data) {
        case .failure(let rejection):
            log("computer-relay: refused \(stem.prefix(40)): \(rejection)")
            guard rejection.canAnswer, let claimed = RelayValidator.claimed(fileStem: stem, data: data) else { return nil }
            return respond(id: claimed.id, nonce: claimed.nonce, ok: false, error: "relay refused: \(rejection)", result: [:])
        case .success(let request):
            let (ok, error, result) = execute(request)
            return respond(id: request.id, nonce: request.nonce, ok: ok, error: error, result: result)
        }
    }

    func execute(_ request: RelayRequest) -> (Bool, String?, [String: String]) {
        guard let runner = bridge() else { return (false, "the Orion app can't find orion-mac-bridge", [:]) }
        guard let line = try? request.bridgeLine() else { return (false, "the relay could not encode the request", [:]) }
        switch runner.run(line: line) {
        case .failure(let failure):
            return (false, failure.description, [:])
        case .success(let stdout):
            return Self.parseBridgeOutput(stdout)
        }
    }

    /// The bridge prints one JSON line {id, ok, result, error}. Only string results pass through.
    static func parseBridgeOutput(_ stdout: Data) -> (Bool, String?, [String: String]) {
        let text = String(decoding: stdout, as: UTF8.self)
        guard let line = text.split(separator: "\n").first(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("{") }),
              let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else {
            return (false, "the screen bridge returned no parseable answer", [:])
        }
        let ok = object["ok"] as? Bool ?? false
        let result = (object["result"] as? [String: Any] ?? [:]).compactMapValues { $0 as? String }
        let error = ok ? nil : (object["error"] as? String ?? "the screen bridge reported an unspecified failure")
        return (ok, error, ok ? result : [:])
    }

    private func respond(id: String, nonce: String, ok: Bool, error: String?, result: [String: String]) -> String? {
        guard let key = try? RelayFiles.readKey(keyURL).get() else {
            log("computer-relay: no usable key, cannot sign the answer to \(id)")
            return nil
        }
        let canonical = RelayProtocol.canonicalResponse(id: id, nonce: nonce, ok: ok, error: error, result: result)
        var object: [String: Any] = ["id": id, "nonce": nonce, "ok": ok, "result": result,
                                     "mac": RelayProtocol.mac(key: key, canonical: canonical)]
        if let error { object["error"] = error }
        do {
            let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            try RelayFiles.writeAtomically(data, to: directory.appendingPathComponent("\(id).res.json"))
            return id
        } catch {
            log("computer-relay: could not write the answer to \(id): \(error)")
            return nil
        }
    }

    /// Answers nobody collected and temp files from a crash, once they are a minute old.
    private func removeLeftovers() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        let cutoff = now().addingTimeInterval(-Self.staleLeftoverSeconds)
        for name in names where name.hasSuffix(".res.json") || name.hasPrefix(".tmp-") {
            let url = directory.appendingPathComponent(name)
            let modified = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
            if let modified, modified < cutoff { unlink(url.path) }
        }
    }

    // MARK: heartbeat

    public func writeHeartbeat(accessibility: Bool) {
        let beat = Heartbeat(pid: getpid(), at: Int64((now().timeIntervalSince1970 * 1000).rounded()),
                             accessibility: accessibility, bridge: bridge() == nil ? "missing" : "ready")
        guard let data = try? JSONEncoder().encode(beat) else { return }
        try? RelayFiles.writeAtomically(data, to: directory.appendingPathComponent(Self.heartbeatName))
    }

    // MARK: watching

    /// Prepares the directory and starts watching it. Throws when the directory is unsafe.
    public func start() throws {
        try RelayFiles.ensureDirectory(directory)
        queue.sync {
            let fd = open(directory.path, O_EVTONLY)
            if fd >= 0 {
                let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: queue)
                source.setEventHandler { [weak self] in self?.tick() }
                source.setCancelHandler { close(fd) }
                source.resume()
                watcher = source
            }
            // A watched directory can be replaced underneath the descriptor; the slow poll still sees it.
            slowPoll = makeTimer(interval: .seconds(2))
            tick()
        }
    }

    public func stop() {
        queue.sync {
            watcher?.cancel(); watcher = nil
            fastPoll?.cancel(); fastPoll = nil
            slowPoll?.cancel(); slowPoll = nil
        }
    }

    /// Runs on `queue`. While requests are pending a 250 ms poll backs up the vnode watcher.
    private func tick() {
        processPending()
        let pending = !pendingRequests().isEmpty
        if pending, fastPoll == nil { fastPoll = makeTimer(interval: .milliseconds(250)) }
        if !pending, let poll = fastPoll { poll.cancel(); fastPoll = nil }
    }

    private func makeTimer(interval: DispatchTimeInterval) -> DispatchSourceTimer {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        return timer
    }
}
