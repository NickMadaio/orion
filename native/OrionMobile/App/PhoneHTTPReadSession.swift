#if targetEnvironment(simulator)
import Foundation
import MobileCore

/// Loopback exchange test. Only a short-lived, owner/device-bound bootstrap
/// reaches disk; the resulting read token stays in this app process.
@MainActor
enum PhoneHTTPReadSession {
    private struct Bootstrap: Decodable {
        let port: Int
        let owner: String
        let device: String
        let token: String
    }
    private struct TokenResponse: Decodable {
        let schema: Int
        let ownerID: String
        let deviceID: String
        let token: String
    }

    static func connect(identity: PhoneDeviceIdentity, reader: PhoneTodayReader) async {
        do {
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("http-session-bootstrap.json")
            guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4096 else { throw URLError(.badURL) }
            let grant = try JSONDecoder().decode(Bootstrap.self, from: Data(contentsOf: url))
            guard (1...65535).contains(grant.port), grant.owner == "pairing-test-owner", grant.device == "pairing-test-phone",
                  (32...128).contains(grant.token.count), grant.token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { throw URLError(.badURL) }
            let config = URLSessionConfiguration.ephemeral
            config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
            config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
            let session = URLSession(configuration: config, delegate: NoReadRedirect(), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            let challengeData = try await post(session, grant: grant, path: "/session/challenge", body: [:])
            let challenge = try JSONDecoder().decode(DeviceReadChallenge.self, from: challengeData)
            let signature = try identity.signReadSessionChallenge(challenge)
            let result = try await post(session, grant: grant, path: "/session/exchange",
                                        body: ["challenge": challenge.challenge, "signature": signature])
            let token = try JSONDecoder().decode(TokenResponse.self, from: result)
            guard token.schema == 1, token.ownerID == grant.owner, token.deviceID == grant.device else { throw URLError(.badServerResponse) }
            try reader.useDeviceSession(port: grant.port, owner: grant.owner, token: token.token)
        } catch { reader.refuseDeviceSession() }
    }

    private static func post(_ session: URLSession, grant: Bootstrap, path: String, body: [String:String]) async throws -> Data {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(grant.port)\(path)")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(grant.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.mimeType == "application/json", response.expectedContentLength <= 8192 else { throw URLError(.badServerResponse) }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 8192 else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return data
    }
}
#endif
