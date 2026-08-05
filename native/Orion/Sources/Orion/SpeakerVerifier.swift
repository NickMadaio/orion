import AVFoundation
import Foundation

/*
 Is the voice that just said "Orion" the one that enrolled?

 Talks to `orion_voiceid_daemon.py` over a unix socket, the same shape as the
 TTS client. The daemon holds the model warm; this only ships it audio.

 Three rules that shape the whole file:

 1. FAILS OPEN. Daemon down, model missing, socket stale, timeout — every one of
    those returns `.cannotVerify` and the wake word proceeds exactly as it did
    before speaker verification existed. A voice filter that fails closed makes
    Orion mysteriously deaf, and "mysteriously" is the part that costs hours.

 2. NEVER GATES PUSH-TO-TALK. Holding the key is a physical act at the machine;
    there is nothing to verify and nothing to gain by second-guessing it. This
    is consulted only on the wake word.

 3. IT IS NOT AUTHENTICATION. It filters the television and the room. A
    recording of his voice defeats it, and nothing security-relevant should ever
    be conditioned on it.
*/

enum VerificationResult {
    case match(score: Double)
    case reject(score: Double, threshold: Double)
    /// No profile, no model, or no daemon — proceed as if unfiltered.
    case cannotVerify(reason: String)

    var shouldWake: Bool {
        switch self {
        case .match, .cannotVerify: return true
        case .reject: return false
        }
    }
}

final class SpeakerVerifier {

    private let socketPath: String
    private let queue = DispatchQueue(label: "com.nickmadaio.orion.voiceid")

    /// Cached so the menu bar can say "wake word is not filtered" without
    /// hitting the socket on every menu open.
    private(set) var status: String = "not checked"
    private(set) var isFiltering = false

    /// Generous enough for a cold first call, short enough that a hung daemon
    /// cannot make the wake word feel broken.
    private static let timeout: TimeInterval = 1.5

    /// Voice embeddings vary more between a short wake phrase and a longer
    /// enrollment recording than the initial calibration assumed.  Keep the
    /// profile's measured bar when it is reachable, but never reject a clearly
    /// similar wake phrase solely because that bar was over-fitted to the
    /// enrollment samples.  This is a nuisance filter, not authentication.
    private static let wakeSimilarityFloor: Double = 0.45

    init(socketPath: String? = nil) {
        self.socketPath = socketPath
            ?? NSString(string: "~/.openclaw/orion-voiceid.sock").expandingTildeInPath
    }

    // MARK: Public

    /// Ask the daemon what it can actually do, and remember it.
    func refreshStatus(completion: ((Bool) -> Void)? = nil) {
        queue.async { [weak self] in
            guard let self else { return }
            guard let reply = self.send(["op": "ping"]) else {
                self.status = "daemon not running — wake word is unfiltered"
                self.isFiltering = false
                DispatchQueue.main.async { completion?(false) }
                return
            }
            let usable = reply["usable"] as? Bool ?? false
            let enrolled = reply["enrolled"] as? Bool ?? false
            let detail = reply["detail"] as? String ?? ""
            if !usable {
                self.status = detail.isEmpty
                    ? "no speaker model — wake word is unfiltered"
                    : detail
                self.isFiltering = false
            } else if !enrolled {
                self.status = "no voice enrolled — wake word is unfiltered"
                self.isFiltering = false
            } else {
                let threshold = reply["threshold"] as? Double ?? 0
                self.status = String(format: "filtering to your voice (bar %.2f)", threshold)
                self.isFiltering = true
            }
            OrionLog.write("[voiceid] \(self.status)")
            DispatchQueue.main.async { completion?(self.isFiltering) }
        }
    }

    /// Verify a captured utterance. Never blocks the caller's thread.
    func verify(
        samples: [Float],
        sampleRate: Double,
        completion: @escaping (VerificationResult) -> Void
    ) {
        guard isFiltering else {
            completion(.cannotVerify(reason: status))
            return
        }
        queue.async { [weak self] in
            guard let self else { return }
            let result = self.verifySync(samples: samples, sampleRate: sampleRate)
            DispatchQueue.main.async { completion(result) }
        }
    }

    // MARK: Wire

    private func verifySync(samples: [Float], sampleRate: Double) -> VerificationResult {
        var payload = Data(capacity: samples.count * 4)
        for value in samples {
            withUnsafeBytes(of: value.bitPattern.littleEndian) { payload.append(contentsOf: $0) }
        }
        guard let reply = send([
            "op": "verify",
            "audio": payload.base64EncodedString(),
            "rate": Int(sampleRate),
        ]) else {
            return .cannotVerify(reason: "voice daemon did not answer")
        }
        if (reply["ok"] as? Bool) != true {
            return .cannotVerify(reason: reply["error"] as? String ?? "verification failed")
        }
        let score = reply["score"] as? Double ?? 0
        if (reply["enrolled"] as? Bool) == false {
            return .cannotVerify(reason: "no voice enrolled")
        }
        if (reply["match"] as? Bool) == true || score >= Self.wakeSimilarityFloor {
            return .match(score: score)
        }
        return .reject(score: score, threshold: reply["threshold"] as? Double ?? 0)
    }

    private func send(_ message: [String: Any]) -> [String: Any]? {
        guard let request = try? JSONSerialization.data(withJSONObject: message) else {
            return nil
        }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }

        var timeout = timeval(
            tv_sec: Int(SpeakerVerifier.timeout),
            tv_usec: Int32((SpeakerVerifier.timeout.truncatingRemainder(dividingBy: 1)) * 1_000_000)
        )
        setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: address.sun_path) else { return nil }
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            raw.copyBytes(from: pathBytes)
        }
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { return nil }

        var out = request
        out.append(0x0A)
        let written = out.withUnsafeBytes { Darwin.send(descriptor, $0.baseAddress, $0.count, 0) }
        guard written == out.count else { return nil }

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while !buffer.contains(0x0A) {
            let count = chunk.withUnsafeMutableBytes { raw -> Int in
                Darwin.recv(descriptor, raw.baseAddress, raw.count, 0)
            }
            if count <= 0 { break }
            buffer.append(contentsOf: chunk[0..<count])
        }
        guard let newline = buffer.firstIndex(of: 0x0A) else { return nil }
        guard
            let object = try? JSONSerialization.jsonObject(with: buffer[..<newline])
        else { return nil }
        return object as? [String: Any]
    }
}
