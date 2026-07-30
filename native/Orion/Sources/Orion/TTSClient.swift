import Darwin
import Foundation

/*
 Client for the warm TTS daemon (`scripts/orion_tts_daemon.py`).

 We talk to the unix socket directly rather than shelling out to the CLI. The
 CLI spawns a Python interpreter per reply, and that process start is a
 measurable slice of the latency the daemon exists to remove.

 Protocol: newline-delimited JSON, one request per line, one or more response
 frames per request.

     -> {"op":"synth","text":"...","mode":"stream","preempt":true}
     <- {"event":"chunk","id":"...","index":0,"text":"...","ms":173,"path":"..."}
     <- {"event":"chunk","index":1,...}
     <- {"event":"done","ok":true,"id":"...","chunks":3,"ms":812}

 Stream mode is the whole point: the first chunk is playable in ~170ms, long
 before the full reply has been synthesised. We hand each chunk to the player
 the moment its frame arrives.
 */

enum TTSOutcome {
    case finished(chunks: Int)
    case failed(String)
    case cancelled
}

enum TTSError: LocalizedError {
    case socket(String)

    var errorDescription: String? {
        switch self {
        case .socket(let message): return message
        }
    }
}

// MARK: - Minimal blocking unix-domain socket

/// Just enough POSIX to speak NDJSON over `AF_UNIX`. Network.framework can do
/// this too, but a blocking socket on a private queue is a much smaller thing
/// to reason about, and the daemon is on the same machine.
final class UnixSocketConnection {
    private var fd: Int32 = -1
    private var buffer = Data()

    init(path: String, timeout: TimeInterval) throws {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)

        let pathBytes = Array(path.utf8CString)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard pathBytes.count <= capacity else {
            throw TTSError.socket("socket path is too long for sockaddr_un")
        }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: pathBytes.map { UInt8(bitPattern: $0) })
        }

        let handle = socket(AF_UNIX, SOCK_STREAM, 0)
        guard handle >= 0 else {
            throw TTSError.socket("could not create a socket (errno \(errno))")
        }

        var tv = timeval(tv_sec: Int(timeout), tv_usec: Int32((timeout - Double(Int(timeout))) * 1_000_000))
        setsockopt(handle, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(handle, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        let status = withUnsafePointer(to: &addr) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(handle, sa, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard status == 0 else {
            let code = errno
            Darwin.close(handle)
            throw TTSError.socket("the voice daemon is not accepting connections (errno \(code))")
        }
        fd = handle
    }

    deinit { closeSocket() }

    func closeSocket() {
        if fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
    }

    func setReadTimeout(_ seconds: TimeInterval) {
        guard fd >= 0 else { return }
        var tv = timeval(tv_sec: Int(seconds), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    }

    func send(json object: [String: Any]) throws {
        guard fd >= 0 else { throw TTSError.socket("socket is closed") }
        var payload = try JSONSerialization.data(withJSONObject: object, options: [])
        payload.append(0x0A)
        try payload.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let written = Darwin.write(fd, base + offset, raw.count - offset)
                if written > 0 {
                    offset += written
                    continue
                }
                if written < 0 && errno == EINTR { continue }
                throw TTSError.socket("could not write to the voice daemon (errno \(errno))")
            }
        }
    }

    /// One NDJSON frame, or nil at end of stream.
    func readFrame() throws -> [String: Any]? {
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                let line = buffer.subdata(in: buffer.startIndex..<newline)
                buffer.removeSubrange(buffer.startIndex...newline)
                if line.isEmpty { continue }
                guard
                    let parsed = try? JSONSerialization.jsonObject(with: line, options: []),
                    let object = parsed as? [String: Any]
                else { continue }
                return object
            }

            guard fd >= 0 else { return nil }
            var scratch = [UInt8](repeating: 0, count: 16384)
            let count = Darwin.read(fd, &scratch, scratch.count)
            if count == 0 { return nil }
            if count < 0 {
                if errno == EINTR { continue }
                if errno == EAGAIN || errno == EWOULDBLOCK {
                    throw TTSError.socket("the voice daemon stopped responding")
                }
                throw TTSError.socket("read from the voice daemon failed (errno \(errno))")
            }
            buffer.append(contentsOf: scratch[0..<count])
        }
    }
}

// MARK: - Client

final class TTSClient {
    static let socketPath = "/Users/nickmadaio/.openclaw/orion-tts.sock"

    private let streamQueue = DispatchQueue(label: "com.nickmadaio.orion.tts.stream")
    /// Cancel goes out on its own queue and its own connection: the streaming
    /// connection is parked inside a blocking read when barge-in happens.
    private let controlQueue = DispatchQueue(label: "com.nickmadaio.orion.tts.control")

    /// Bumped on every cancel/new request. Frames from a superseded job are
    /// dropped instead of reaching the player. Main thread only.
    private var generation = 0

    /// A TCP-connect-equivalent probe: if we can open the socket, the daemon is
    /// there. Cheap enough to poll.
    static func isReachable(timeout: TimeInterval = 0.4) -> Bool {
        guard FileManager.default.fileExists(atPath: socketPath) else { return false }
        guard let connection = try? UnixSocketConnection(path: socketPath, timeout: timeout) else {
            return false
        }
        connection.closeSocket()
        return true
    }

    /// Streams `text`. `onChunk` fires on the main thread the instant a chunk
    /// frame lands; `onDone` fires once, also on the main thread.
    func stream(text: String,
                onChunk: @escaping (URL, Int) -> Void,
                onDone: @escaping (TTSOutcome) -> Void) {
        generation += 1
        let job = generation
        let path = TTSClient.socketPath

        streamQueue.async { [weak self] in
            let connection: UnixSocketConnection
            do {
                connection = try UnixSocketConnection(path: path, timeout: 5)
            } catch {
                let message = (error as? TTSError)?.errorDescription ?? error.localizedDescription
                DispatchQueue.main.async {
                    guard let self, self.generation == job else { return }
                    onDone(.failed(message))
                }
                return
            }
            defer { connection.closeSocket() }

            // Generous read timeout: a long reply can take a while between
            // chunks on a cold model, and the daemon has its own deadlines.
            connection.setReadTimeout(60)

            do {
                try connection.send(json: [
                    "op": "synth",
                    "text": text,
                    "mode": "stream",
                    "preempt": true
                ])
            } catch {
                let message = (error as? TTSError)?.errorDescription ?? error.localizedDescription
                DispatchQueue.main.async {
                    guard let self, self.generation == job else { return }
                    onDone(.failed(message))
                }
                return
            }

            var delivered = 0
            while true {
                let frame: [String: Any]?
                do {
                    frame = try connection.readFrame()
                } catch {
                    let message = (error as? TTSError)?.errorDescription ?? error.localizedDescription
                    DispatchQueue.main.async {
                        guard let self, self.generation == job else { return }
                        onDone(.failed(message))
                    }
                    return
                }

                guard let frame else {
                    DispatchQueue.main.async {
                        guard let self, self.generation == job else { return }
                        onDone(delivered > 0 ? .finished(chunks: delivered)
                                             : .failed("the voice daemon closed the connection"))
                    }
                    return
                }

                let event = frame["event"] as? String

                if event == "chunk" {
                    guard let chunkPath = frame["path"] as? String else { continue }
                    let index = frame["index"] as? Int ?? delivered
                    delivered += 1
                    let url = URL(fileURLWithPath: chunkPath)
                    DispatchQueue.main.async {
                        guard let self, self.generation == job else { return }
                        onChunk(url, index)
                    }
                    continue
                }

                if event == "done" {
                    let ok = frame["ok"] as? Bool ?? true
                    let chunks = frame["chunks"] as? Int ?? delivered
                    DispatchQueue.main.async {
                        guard let self, self.generation == job else { return }
                        if ok {
                            onDone(.finished(chunks: chunks))
                        } else {
                            onDone(.failed(frame["error"] as? String ?? "synthesis failed"))
                        }
                    }
                    return
                }

                // Error frames come back without an "event" key.
                if let ok = frame["ok"] as? Bool, ok == false {
                    let code = frame["code"] as? String ?? ""
                    let message = frame["error"] as? String ?? "synthesis failed"
                    DispatchQueue.main.async {
                        guard let self, self.generation == job else { return }
                        onDone(code == "cancelled" ? .cancelled : .failed(message))
                    }
                    return
                }
            }
        }
    }

    /// Barge-in. Cancels every in-flight and queued job on the daemon and makes
    /// this client ignore any frames still in flight toward us.
    func cancelAll() {
        generation += 1
        let path = TTSClient.socketPath
        controlQueue.async {
            guard let connection = try? UnixSocketConnection(path: path, timeout: 1) else { return }
            defer { connection.closeSocket() }
            try? connection.send(json: ["op": "cancel"])
            _ = try? connection.readFrame()
        }
    }
}
