import Foundation
import MobileCore

/// Explicit Simulator development connection. No bootstrap reader exists on physical iOS.
@MainActor
final class PhoneTodayReader: ObservableObject {
    struct Bootstrap: Decodable { let port: Int; let owner: String; let token: String }
    @Published private(set) var snapshot: TodayReadSnapshot?
    @Published private(set) var message = "Not connected to your Mac"
    @Published private(set) var loading = false
    @Published private(set) var available = false
    @Published private(set) var cancelledPendingRead = false
    private var bootstrap: Bootstrap?
    private var history = TodayReadHistory()
    private var connectionGeneration = UUID()
    private var activeRead: URLSession?
    var configured: Bool { bootstrap != nil }

    init() {
        #if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--local-today"),
           !ProcessInfo.processInfo.arguments.contains("--http-session-test"),
           !ProcessInfo.processInfo.arguments.contains("--review-http-session"),
           let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
           let data = try? Data(contentsOf: directory.appendingPathComponent("local-today.json")), data.count < 4096,
           let value = try? JSONDecoder().decode(Bootstrap.self, from: data),
           (1...65535).contains(value.port), !value.owner.isEmpty,
           value.token.count >= 32, value.token.count <= 128,
           value.token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) {
            bootstrap = value
            message = "Local development source · not checked"
        } else { bootstrap = nil }
        #else
        bootstrap = nil
        #endif
    }
    #if targetEnvironment(simulator)
    func useDeviceSession(port: Int, owner: String, token: String) throws {
        guard (1...65535).contains(port), !owner.isEmpty, (32...128).contains(token.count),
              token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { throw TodayPlanError.invalidInput }
        disconnect()
        cancelledPendingRead = false
        bootstrap = Bootstrap(port: port, owner: owner, token: token)
        message = "Local device session · not checked"
    }
    func refuseDeviceSession() {
        disconnect()
        cancelledPendingRead = false
        message = "Device session could not be verified"
    }
    #endif

    func disconnect() {
        // Invalidates already-delivered bytes as well as cancelling transport.
        cancelledPendingRead = loading
        connectionGeneration = UUID()
        activeRead?.invalidateAndCancel(); activeRead = nil
        bootstrap = nil; history.clear(); snapshot = nil
        available = false; loading = false
        message = "Reading disconnected"
    }

    func refresh() async {
        guard let bootstrap, !loading else { return }
        let generation = connectionGeneration
        loading = true
        defer { if generation == connectionGeneration { loading = false; activeRead = nil } }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
        let session = URLSession(configuration: config, delegate: NoReadRedirect(), delegateQueue: nil)
        activeRead = session
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(bootstrap.port)/plan")!)
        request.setValue("Bearer \(bootstrap.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard generation == connectionGeneration else { return }
            guard let http = response as? HTTPURLResponse else { throw TodayPlanError.invalidInput }
            if http.statusCode == 401 { history.clear(); snapshot = nil; available = false; message = "Access expired or revoked"; return }
            if http.statusCode == 404 { snapshot = nil; available = false; message = "No published plan"; return }
            guard http.statusCode == 200 else { throw URLError(.badServerResponse) }
            guard http.mimeType == "application/json", response.expectedContentLength <= 1_100_000 else { throw TodayPlanError.invalidInput }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 1_100_000 else { throw TodayPlanError.invalidInput }
                data.append(byte)
            }
            guard generation == connectionGeneration else { return }
            let incoming = try TodayReadSnapshot.decodeResponse(data, expectedOwner: bootstrap.owner)
            try history.receive(incoming)
            snapshot = incoming; available = true; message = "Read from local development service"
        } catch is URLError {
            guard generation == connectionGeneration else { return }
            available = false; message = "Source unavailable · last reading may be out of date"
        } catch {
            guard generation == connectionGeneration else { return }
            snapshot = nil; available = false; message = "Plan response could not be verified"
        }
    }
}

final class NoReadRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

// Platform adapter kept outside MobileCore. No private-key bytes are exported.
