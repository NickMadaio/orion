import Foundation

/// Service readiness, not proof that a model turn or an individual connector works.
enum GatewayAvailability: String {
    case checking, ready, degraded, unavailable, unverified, stale

    var title: String {
        switch self {
        case .checking: return "Checking connection"
        case .ready: return "Service connected"
        case .degraded: return "Service needs attention"
        case .unavailable: return "Service unavailable"
        case .unverified: return "Connection unverified"
        case .stale: return "Connection check overdue"
        }
    }

    var detail: String {
        switch self {
        case .checking: return "Checking the local service."
        case .ready: return "The local service passed its readiness check. Individual tools may still need attention."
        case .degraded: return "The service is responding, but its readiness check reports a problem. Some requests may still work."
        case .unavailable: return "The local service did not respond. Local app features remain available."
        case .unverified: return "A service responded, but ORION could not verify its health response."
        case .stale: return "The last connection check is out of date. Check again for current availability."
        }
    }
}

struct GatewayHealthSnapshot {
    let availability: GatewayAvailability
    let checkedAt: Date?

    static let initial = GatewayHealthSnapshot(availability: .checking, checkedAt: nil)

    func current(at now: Date = Date()) -> GatewayAvailability {
        guard let checkedAt else { return .checking }
        let age = now.timeIntervalSince(checkedAt)
        guard age >= 0, age <= 20 else { return .stale }
        return availability
    }
}

struct GatewayProbeResponse {
    let statusCode: Int
    let data: Data
}

/// Only fixed loopback GETs, without credentials, cookies, redirects or model calls.
/// Blocking by design: AppState calls this on its background status queue.
enum GatewayHealthProbe {
    typealias Fetch = (URL, TimeInterval) -> GatewayProbeResponse?

    private struct Liveness: Decodable { let ok: Bool; let status: String }
    private struct Readiness: Decodable {
        let ready: Bool
        let eventLoop: EventLoop?
        struct EventLoop: Decodable { let degraded: Bool }
    }

    static func check(port: Int, timeout: TimeInterval = 0.8,
                      fetch: Fetch = request) -> GatewayHealthSnapshot {
        func result(_ state: GatewayAvailability) -> GatewayHealthSnapshot {
            GatewayHealthSnapshot(availability: state, checkedAt: Date())
        }
        guard (1...65535).contains(port), timeout.isFinite, timeout > 0 else {
            return result(.unverified)
        }
        let budget = min(timeout, 2)
        let base = "http://127.0.0.1:\(port)"
        guard let live = fetch(URL(string: base + "/healthz")!, budget) else {
            return result(.unavailable)
        }
        // OpenClaw's UI can return 200 HTML for an unknown path. Status alone
        // would certify an older, unsupported endpoint (or an unrelated server).
        guard live.statusCode == 200,
              let liveness = try? JSONDecoder().decode(Liveness.self, from: live.data),
              liveness.ok, liveness.status == "live" else { return result(.unverified) }
        guard let response = fetch(URL(string: base + "/readyz")!, budget) else {
            return result(.degraded)
        }
        guard let readiness = try? JSONDecoder().decode(Readiness.self, from: response.data) else {
            return result(.unverified)
        }
        if response.statusCode == 503, !readiness.ready { return result(.degraded) }
        guard response.statusCode == 200, readiness.ready else { return result(.unverified) }
        return result(readiness.eventLoop?.degraded == true ? .degraded : .ready)
    }

    static func request(_ url: URL, timeout: TimeInterval) -> GatewayProbeResponse? {
        guard url.scheme == "http", url.host == "127.0.0.1",
              url.user == nil, url.password == nil,
              ["/healthz", "/readyz"].contains(url.path),
              url.query == nil, url.fragment == nil,
              timeout.isFinite, timeout > 0, timeout <= 2 else { return nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.connectionProxyDictionary = [:]
        let delegate = ProbeDelegate()
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let task = session.dataTask(with: request)
        task.resume()
        guard delegate.done.wait(timeout: .now() + timeout) == .success else {
            task.cancel()
            return nil
        }
        return delegate.box.get()
    }

    private final class ResponseBox: @unchecked Sendable {
        private let lock = NSLock()
        private var value: GatewayProbeResponse?
        func set(_ response: GatewayProbeResponse) { lock.lock(); defer { lock.unlock() }; value = response }
        func get() -> GatewayProbeResponse? { lock.lock(); defer { lock.unlock() }; return value }
    }

    /// The server is local, but it is still untrusted input. Bound body size
    /// as well as time, and never retain a provider's arbitrary diagnostics.
    private final class ProbeDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        let done = DispatchSemaphore(value: 0)
        let box = ResponseBox()
        private var data = Data()
        private var statusCode: Int?
        private var finished = false
        private let maximumBytes = 64 * 1024

        // URLSession serializes these callbacks on its delegate queue.
        private func finish(_ response: GatewayProbeResponse?) {
            guard !finished else { return }
            finished = true
            if let response { box.set(response) }
            done.signal()
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                        didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            statusCode = (response as? HTTPURLResponse)?.statusCode
            if response.expectedContentLength > Int64(maximumBytes) {
                finish(GatewayProbeResponse(statusCode: statusCode ?? 0, data: Data()))
                completionHandler(.cancel)
            } else { completionHandler(.allow) }
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
            guard !finished else { return }
            guard chunk.count <= maximumBytes - data.count else {
                finish(GatewayProbeResponse(statusCode: statusCode ?? 0, data: Data()))
                dataTask.cancel()
                return
            }
            data.append(chunk)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        didCompleteWithError error: Error?) {
            if error == nil, let statusCode {
                finish(GatewayProbeResponse(statusCode: statusCode, data: data))
            } else { finish(nil) }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }
}
