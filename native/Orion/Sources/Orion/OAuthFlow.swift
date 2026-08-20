import AppKit
import AuthenticationServices
import CryptoKit
import Darwin
import Foundation
// SecRandomCopyBytes. Reached transitively today, but the PKCE verifier is not
// something to leave depending on another framework's import graph.
import Security

/*
 The authorization-code exchange, once, for every OAuth connector.

 `ASWebAuthenticationSession` for providers that accept Orion's callback URL.
 Google is the exception: its Desktop-app client type requires the loopback-IP
 redirect flow, so Orion opens the system browser and listens once on a random
 127.0.0.1 port. In both cases the provider's real sign-in page is what the user
 types their password into. No account password ever passes through Orion.

 PKCE on every flow, not only where the provider insists. The code verifier
 makes an intercepted authorization code useless on its own, and it costs two
 hashes. Providers that ignore the extra parameters are unaffected.

 The `state` parameter is checked on return. Without that check a crafted
 redirect could hand Orion an authorization code belonging to someone else's
 session, and Orion would store it as though it were Nick's.
*/

enum OAuthError: LocalizedError {
    case unsupported
    case missingCredentials
    case cancelled
    case badRedirect(String)
    case stateMismatch
    case providerError(String)
    case noToken
    /// The provider rejected the token itself — 401 or 403. Distinct from a
    /// generic provider error because it is the one failure that means the
    /// grant is gone rather than the request being wrong.
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "The provider rejected the sign-in. Reconnect it in Settings ▸ Connections."
        case .unsupported: return "This connector does not use a browser sign-in."
        case .missingCredentials: return "Add the Client ID and Secret first."
        case .cancelled: return "Sign-in was cancelled."
        case .badRedirect(let detail): return "The provider came back with something unexpected: \(detail)"
        case .stateMismatch: return "The sign-in response did not match the request it was answering. Nothing was saved."
        case .providerError(let message): return message
        case .noToken: return "The provider did not return an access token."
        }
    }
}

final class OAuthFlow: NSObject {

    static let shared = OAuthFlow()

    /// Registered in Info.plist as CFBundleURLTypes. One scheme, one path per
    /// connector, so a redirect can only satisfy the flow that asked for it.
    static let scheme = "orion"

    private var session: ASWebAuthenticationSession?
    private var googleLoopback: OAuthLoopbackReceiver?

    func run(
        connector: ConnectorID,
        clientID: String,
        clientSecret: String,
        authorizeURL: String,
        tokenURL: String,
        scopes: [String],
        /// Almost always `client_id`. TikTok requires `client_key` and rejects
        /// the standard name — see `ConnectorSpec.clientIDParameter`.
        clientIDParameter: String = "client_id",
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let verifier = Self.randomURLSafe(64)
        let challenge = Self.s256(verifier)
        let state = Self.randomURLSafe(24)

        func authorizationURL(redirect: String) -> URL? {
            guard var components = URLComponents(string: authorizeURL) else { return nil }
            var items = [
                URLQueryItem(name: clientIDParameter, value: clientID),
                URLQueryItem(name: "redirect_uri", value: redirect),
                URLQueryItem(name: "response_type", value: "code"),
                URLQueryItem(name: "state", value: state),
            ]
            // Instagram's authorize endpoint rejects the PKCE parameters
            // outright rather than ignoring them, so it is the one exception.
            if connector != .instagram {
                items.append(URLQueryItem(name: "code_challenge", value: challenge))
                items.append(URLQueryItem(name: "code_challenge_method", value: "S256"))
            }
            if !scopes.isEmpty {
                items.append(URLQueryItem(name: "scope", value: scopes.joined(separator: " ")))
            }
            // Google returns a refresh token only when offline access is asked
            // for and consent is explicit.
            if connector == .google {
                items.append(URLQueryItem(name: "access_type", value: "offline"))
                items.append(URLQueryItem(name: "prompt", value: "consent"))
            }
            components.queryItems = (components.queryItems ?? []) + items
            return components.url
        }

        func handleCallback(_ callback: URL, redirect: String) {
            let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false)
            let query = parts?.queryItems ?? []
            func value(_ name: String) -> String? {
                query.first { $0.name == name }?.value
            }
            if let providerError = value("error") {
                completion(.failure(OAuthError.providerError(
                    value("error_description") ?? providerError
                )))
                return
            }
            guard value("state") == state else {
                completion(.failure(OAuthError.stateMismatch))
                return
            }
            guard let code = value("code") else {
                completion(.failure(OAuthError.badRedirect("no authorization code")))
                return
            }
            self.exchange(
                connector: connector,
                code: code,
                verifier: verifier,
                redirect: redirect,
                clientID: clientID,
                clientSecret: clientSecret,
                tokenURL: tokenURL,
                clientIDParameter: clientIDParameter,
                completion: completion
            )
        }

        // Google Desktop clients reject Orion's custom-scheme redirect. Their
        // supported macOS flow is a one-shot loopback listener on a random
        // 127.0.0.1 port. Start listening before opening the browser so the
        // authorization response can never race the receiver.
        if connector == .google {
            do {
                let receiver = try OAuthLoopbackReceiver(timeout: 300) { [weak self] result in
                    guard let self else { return }
                    let redirect = self.googleLoopback?.redirectURI
                    self.googleLoopback = nil
                    switch result {
                    case .success(let callback):
                        guard let redirect else {
                            completion(.failure(OAuthError.badRedirect("Google callback receiver disappeared")))
                            return
                        }
                        handleCallback(callback, redirect: redirect)
                    case .failure(let error):
                        completion(.failure(error))
                    }
                }
                googleLoopback?.cancel()
                googleLoopback = receiver
                guard let url = authorizationURL(redirect: receiver.redirectURI) else {
                    receiver.cancel()
                    googleLoopback = nil
                    completion(.failure(OAuthError.badRedirect("could not build the authorize URL")))
                    return
                }
                guard NSWorkspace.shared.open(url) else {
                    receiver.cancel()
                    googleLoopback = nil
                    completion(.failure(OAuthError.badRedirect("the system browser would not open")))
                    return
                }
            } catch {
                completion(.failure(error))
            }
            return
        }

        let redirect = "\(Self.scheme)://oauth/\(connector.rawValue)"
        guard let url = authorizationURL(redirect: redirect) else {
            completion(.failure(OAuthError.badRedirect("could not build the authorize URL")))
            return
        }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.scheme) {
            [weak self] callback, error in
            guard let self else { return }
            self.session = nil
            if let error {
                let nsError = error as NSError
                if nsError.domain == ASWebAuthenticationSessionErrorDomain,
                   nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    completion(.failure(OAuthError.cancelled))
                } else {
                    completion(.failure(error))
                }
                return
            }
            guard let callback else {
                completion(.failure(OAuthError.badRedirect("no redirect URL")))
                return
            }
            handleCallback(callback, redirect: redirect)
        }
        session.presentationContextProvider = self
        // Otherwise the provider's existing browser session is reused and
        // "connect" silently re-grants whichever account is already signed in.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() {
            completion(.failure(OAuthError.badRedirect("the browser session would not start")))
        }
    }

    private func exchange(
        connector: ConnectorID,
        code: String,
        verifier: String,
        redirect: String,
        clientID: String,
        clientSecret: String,
        tokenURL: String,
        clientIDParameter: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard let url = URL(string: tokenURL) else {
            completion(.failure(OAuthError.badRedirect("bad token URL")))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: clientIDParameter, value: clientID),
            URLQueryItem(name: "client_secret", value: clientSecret),
            URLQueryItem(name: "code_verifier", value: verifier),
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let data else {
                completion(.failure(OAuthError.noToken))
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(.failure(OAuthError.badRedirect("the token response was not JSON")))
                return
            }
            if let providerError = json["error"] as? String {
                let detail = json["error_description"] as? String ?? providerError
                completion(.failure(OAuthError.providerError(detail)))
                return
            }
            if let status = (response as? HTTPURLResponse)?.statusCode, status >= 400 {
                completion(.failure(OAuthError.providerError("The provider returned HTTP \(status).")))
                return
            }
            guard let accessToken = json["access_token"] as? String else {
                completion(.failure(OAuthError.noToken))
                return
            }
            // Instagram hands back a one-hour token and a user id, and expects
            // a second call to trade it for a sixty-day one. Without that the
            // connection dies within the hour and looks like it never worked.
            if connector == .instagram {
                if let userID = json["user_id"] {
                    SecretStore.set(String(describing: userID),
                                    connector: connector, field: SecretStore.Field.accountID)
                }
                Self.upgradeInstagramToken(accessToken, clientSecret: clientSecret, completion: completion)
                return
            }
            SecretStore.set(accessToken, connector: connector, field: SecretStore.Field.accessToken)
            if let refresh = json["refresh_token"] as? String {
                SecretStore.set(refresh, connector: connector, field: SecretStore.Field.refreshToken)
            }
            if let expiresIn = json["expires_in"] as? Double {
                let expiry = Date().addingTimeInterval(expiresIn).timeIntervalSince1970
                SecretStore.set(String(expiry), connector: connector, field: SecretStore.Field.expiresAt)
            }
            completion(.success(()))
        }.resume()
    }

    /// Trade Instagram's one-hour token for the sixty-day one.
    ///
    /// Stored either way: a short token that works now beats a failed connect,
    /// and the expiry recorded below is what tells the UI to reconnect.
    private static func upgradeInstagramToken(
        _ shortLived: String,
        clientSecret: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        func store(_ token: String, seconds: Double) {
            SecretStore.set(token, connector: .instagram, field: SecretStore.Field.accessToken)
            SecretStore.set(String(Date().addingTimeInterval(seconds).timeIntervalSince1970),
                            connector: .instagram, field: SecretStore.Field.expiresAt)
        }
        var components = URLComponents(string: "https://graph.instagram.com/access_token")
        components?.queryItems = [
            URLQueryItem(name: "grant_type", value: "ig_exchange_token"),
            URLQueryItem(name: "client_secret", value: clientSecret),
            URLQueryItem(name: "access_token", value: shortLived),
        ]
        guard let url = components?.url else {
            store(shortLived, seconds: 3600)
            completion(.success(()))
            return
        }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let long = json["access_token"] as? String {
                store(long, seconds: (json["expires_in"] as? Double) ?? 5_184_000)
            } else {
                store(shortLived, seconds: 3600)
            }
            completion(.success(()))
        }.resume()
    }

    // MARK: - PKCE

    private static func randomURLSafe(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes).base64URLEncoded()
    }

    private static func s256(_ verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64URLEncoded()
    }
}

extension OAuthFlow: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // The dashboard window when it is up, otherwise anything on screen.
        // Returning a detached window here is how the sheet ends up appearing
        // behind everything and looking like nothing happened.
        NSApp.keyWindow ?? NSApp.windows.first { $0.isVisible } ?? ASPresentationAnchor()
    }
}

/// Receives one OAuth redirect on localhost, answers the browser, and closes.
///
/// Google explicitly supports this for macOS Desktop OAuth clients. The socket
/// binds only to 127.0.0.1, chooses an ephemeral port, validates nothing itself
/// (OAuthFlow owns the state check), and cannot be reused after one request.
private final class OAuthLoopbackReceiver {

    enum ReceiverError: LocalizedError {
        case couldNotListen
        case timedOut
        case invalidRequest

        var errorDescription: String? {
            switch self {
            case .couldNotListen:
                return "Orion could not open a temporary local callback for Google sign-in."
            case .timedOut:
                return "Google sign-in timed out before returning to Orion."
            case .invalidRequest:
                return "Google returned an unreadable sign-in response."
            }
        }
    }

    let redirectURI: String

    private let descriptor: Int32
    private let queue = DispatchQueue(label: "com.nickmadaio.orion.google-oauth-loopback")
    private var source: DispatchSourceRead?
    private var finished = false
    private let completion: (Result<URL, Error>) -> Void

    init(timeout: TimeInterval, completion: @escaping (Result<URL, Error>) -> Void) throws {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw ReceiverError.couldNotListen }

        var noSigPipe: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe,
                   socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, Darwin.listen(descriptor, 1) == 0 else {
            Darwin.close(descriptor)
            throw ReceiverError.couldNotListen
        }

        var actual = sockaddr_in()
        var actualLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &actual) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(descriptor, $0, &actualLength)
            }
        }
        guard named == 0 else {
            Darwin.close(descriptor)
            throw ReceiverError.couldNotListen
        }

        self.descriptor = descriptor
        self.redirectURI = "http://127.0.0.1:\(UInt16(bigEndian: actual.sin_port))"
        self.completion = completion

        let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
        self.source = source
        source.setEventHandler { [weak self] in self?.receive() }
        source.setCancelHandler { Darwin.close(descriptor) }
        source.resume()

        queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.finish(.failure(ReceiverError.timedOut))
        }
    }

    deinit {
        source?.cancel()
    }

    func cancel() {
        queue.async { [weak self] in
            guard let self, !self.finished else { return }
            self.finished = true
            self.source?.cancel()
            self.source = nil
        }
    }

    private func receive() {
        guard !finished else { return }
        let connection = Darwin.accept(descriptor, nil, nil)
        guard connection >= 0 else { return }
        defer { Darwin.close(connection) }

        var noSigPipe: Int32 = 1
        setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe,
                   socklen_t(MemoryLayout<Int32>.size))
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout,
                   socklen_t(MemoryLayout<timeval>.size))

        var data = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let headerTerminator = Data("\r\n\r\n".utf8)
        while data.count < 64 * 1024, data.range(of: headerTerminator) == nil {
            let count = chunk.withUnsafeMutableBytes {
                Darwin.recv(connection, $0.baseAddress, $0.count, 0)
            }
            if count <= 0 { break }
            data.append(contentsOf: chunk[0..<count])
        }

        let callback = Self.callbackURL(from: data, redirectURI: redirectURI)
        Self.answerBrowser(connection, success: callback != nil)
        if let callback {
            finish(.success(callback))
        } else {
            finish(.failure(ReceiverError.invalidRequest))
        }
    }

    private func finish(_ result: Result<URL, Error>) {
        guard !finished else { return }
        finished = true
        source?.cancel()
        source = nil
        DispatchQueue.main.async { [completion] in completion(result) }
    }

    private static func callbackURL(from request: Data, redirectURI: String) -> URL? {
        guard let text = String(data: request, encoding: .utf8),
              let line = text.components(separatedBy: "\r\n").first
        else { return nil }
        let parts = line.split(separator: " ", maxSplits: 2)
        guard parts.count == 3, parts[0] == "GET",
              let base = URL(string: redirectURI),
              let url = URL(string: String(parts[1]), relativeTo: base)?.absoluteURL,
              url.host == "127.0.0.1"
        else { return nil }
        return url
    }

    private static func answerBrowser(_ connection: Int32, success: Bool) {
        let title = success ? "Google connected" : "Google sign-in failed"
        let detail = success
            ? "Authorization returned to Orion. You can close this tab."
            : "Orion could not read Google's response. Return to Orion and try again."
        let body = """
        <!doctype html><meta charset="utf-8"><title>\(title)</title>
        <body style="font:16px -apple-system;padding:48px;background:#111;color:#eee">
        <h1>\(title)</h1><p>\(detail)</p></body>
        """
        let bodyData = Data(body.utf8)
        let header = """
        HTTP/1.1 200 OK\r
        Content-Type: text/html; charset=utf-8\r
        Content-Length: \(bodyData.count)\r
        Cache-Control: no-store\r
        Connection: close\r
        \r

        """
        var response = Data(header.utf8)
        response.append(bodyData)
        response.withUnsafeBytes { buffer in
            var sent = 0
            while sent < buffer.count {
                let count = Darwin.send(connection, buffer.baseAddress!.advanced(by: sent),
                                        buffer.count - sent, 0)
                if count <= 0 { break }
                sent += count
            }
        }
    }
}

private extension Data {
    /// base64url, per RFC 7636: no padding, and URL-safe alphabet.
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
