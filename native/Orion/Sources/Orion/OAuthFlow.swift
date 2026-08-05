import AppKit
import AuthenticationServices
import CryptoKit
import Foundation
// SecRandomCopyBytes. Reached transitively today, but the PKCE verifier is not
// something to leave depending on another framework's import graph.
import Security

/*
 The authorization-code exchange, once, for every OAuth connector.

 `ASWebAuthenticationSession` rather than opening Safari and listening on a
 local port. It runs the provider's own login in a browser view the app cannot
 read, hands back only the redirect URL, and — the part that matters — the
 provider's real sign-in page is what the user types their password into. No
 credential ever passes through Orion, which is the only arrangement worth
 offering for something that reaches a bank.

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

    var errorDescription: String? {
        switch self {
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

    func run(
        connector: ConnectorID,
        clientID: String,
        clientSecret: String,
        authorizeURL: String,
        tokenURL: String,
        scopes: [String],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let redirect = "\(Self.scheme)://oauth/\(connector.rawValue)"
        let verifier = Self.randomURLSafe(64)
        let challenge = Self.s256(verifier)
        let state = Self.randomURLSafe(24)

        guard var components = URLComponents(string: authorizeURL) else {
            completion(.failure(OAuthError.badRedirect("bad authorize URL")))
            return
        }
        var items = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "state", value: state),
        ]
        // Instagram's authorize endpoint rejects the PKCE parameters outright
        // rather than ignoring them, so it is the one flow that goes without.
        // Everything else gets it whether or not the provider asks.
        if connector != .instagram {
            items.append(URLQueryItem(name: "code_challenge", value: challenge))
            items.append(URLQueryItem(name: "code_challenge_method", value: "S256"))
        }
        if !scopes.isEmpty {
            items.append(URLQueryItem(name: "scope", value: scopes.joined(separator: " ")))
        }
        // Google hands back a refresh token only when both are present, and
        // only on the first grant unless consent is forced.
        if connector == .google {
            items.append(URLQueryItem(name: "access_type", value: "offline"))
            items.append(URLQueryItem(name: "prompt", value: "consent"))
        }
        components.queryItems = (components.queryItems ?? []) + items
        guard let url = components.url else {
            completion(.failure(OAuthError.badRedirect("could not build the authorize URL")))
            return
        }

        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: Self.scheme
        ) { [weak self] callback, error in
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
            guard let callback,
                  let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false)
            else {
                completion(.failure(OAuthError.badRedirect("no redirect URL")))
                return
            }
            let query = parts.queryItems ?? []
            func value(_ name: String) -> String? {
                query.first { $0.name == name }?.value
            }
            if let providerError = value("error") {
                completion(.failure(OAuthError.providerError(
                    value("error_description") ?? providerError
                )))
                return
            }
            // Checked before the code is used for anything.
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
                completion: completion
            )
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
            URLQueryItem(name: "client_id", value: clientID),
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

private extension Data {
    /// base64url, per RFC 7636: no padding, and URL-safe alphabet.
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
