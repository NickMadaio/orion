import Foundation
import Security

/*
 Every outside service Orion talks to, and where its secrets live.

 Two things this file is trying to prevent, both of which the project has
 already been bitten by once:

 1. Secrets in .env. The API keys currently sit in a plaintext file on the
    Desktop. That was fine when the only reader was a shell script; it stops
    being fine the moment the list includes a bank aggregator. Everything added
    from here goes to the Keychain, which is encrypted at rest, unlocked with
    the login session, and does not end up in a git diff or a screen share.

 2. A connector that lies about being connected. Every state below is derived
    from something checkable — a token that exists and has not expired — rather
    than from a flag someone set once. `orion-doctor` and the UI read the same
    derivation, so they cannot disagree.

 What is deliberately NOT here: any secret values. Client IDs and secrets are
 registered by Nick at each provider and pasted in once. No credential is
 compiled into the app, which is why this file is safe to commit and why a
 provider can be rotated without a rebuild.
*/

// MARK: - Catalog

enum ConnectorID: String, CaseIterable, Identifiable, Codable {
    case whoop
    case google          // YouTube, Calendar and Gmail all ride this one grant.
    case plaid           // Chase and Fidelity both, via one aggregator.
    case tiktok
    case instagram

    var id: String { rawValue }
}

/// How a connector proves who you are.
enum AuthKind: Equatable {
    /// Standard OAuth 2 authorization-code flow.
    case oauth2(authorize: String, token: String, scopes: [String])
    /// A token exchange that happens inside a provider-hosted widget, not a
    /// browser redirect we control. Plaid Link works this way.
    case hostedLink
}

struct ConnectorSpec {
    let id: ConnectorID
    let name: String
    /// What Orion will actually do with it, in one line, for the UI.
    let purpose: String
    let auth: AuthKind
    /// Where Nick registers the app and gets a client id and secret.
    let registerURL: String
    /// Exactly what to do there. Shown in the UI so it is not a scavenger hunt.
    let setupSteps: [String]
    /// True when the provider grants nothing but reads.
    let readOnly: Bool

    static let all: [ConnectorSpec] = [
        ConnectorSpec(
            id: .whoop,
            name: "Whoop",
            purpose: "Recovery, sleep, strain and resting heart rate.",
            auth: .oauth2(
                authorize: "https://api.prod.whoop.com/oauth/oauth2/auth",
                token: "https://api.prod.whoop.com/oauth/oauth2/token",
                scopes: ["read:recovery", "read:sleep", "read:cycles", "read:workout", "read:profile"]
            ),
            registerURL: "https://developer.whoop.com",
            setupSteps: [
                "Sign in at developer.whoop.com and create an app.",
                "Set the redirect URI to exactly: orion://oauth/whoop",
                "Copy the Client ID and Client Secret into the fields here.",
                "Press Connect — Whoop opens in your browser and comes back.",
            ],
            readOnly: true
        ),
        ConnectorSpec(
            id: .google,
            name: "Google",
            purpose: "YouTube subscriber counts, and later Calendar and Gmail on the same grant.",
            auth: .oauth2(
                authorize: "https://accounts.google.com/o/oauth2/v2/auth",
                token: "https://oauth2.googleapis.com/token",
                scopes: ["https://www.googleapis.com/auth/youtube.readonly"]
            ),
            registerURL: "https://console.cloud.google.com/apis/credentials",
            setupSteps: [
                "Create a project, then an OAuth client of type Desktop app.",
                "Add the YouTube Data API v3 to the project's enabled APIs.",
                "Set the redirect URI to exactly: orion://oauth/google",
                "Copy the Client ID and Client Secret into the fields here.",
            ],
            readOnly: true
        ),
        ConnectorSpec(
            id: .plaid,
            name: "Plaid",
            purpose: "Chase and Fidelity balances and transactions. Read-only, and no bank password is ever seen or stored.",
            auth: .hostedLink,
            registerURL: "https://dashboard.plaid.com/signup",
            setupSteps: [
                "Create a Plaid account — Sandbox works immediately with fake data.",
                "Copy the client_id and the Sandbox secret into the fields here.",
                "Connect opens Plaid Link, where you pick Chase or Fidelity.",
                "Production access needs Plaid's approval; Sandbox does not.",
            ],
            readOnly: true
        ),
        ConnectorSpec(
            id: .tiktok,
            name: "TikTok",
            purpose: "Follower count and recent video performance.",
            auth: .oauth2(
                authorize: "https://www.tiktok.com/v2/auth/authorize/",
                token: "https://open.tiktokapis.com/v2/oauth/token/",
                scopes: ["user.info.basic", "user.info.stats", "video.list"]
            ),
            registerURL: "https://developers.tiktok.com",
            setupSteps: [
                "Register an app at developers.tiktok.com and request Login Kit.",
                "Set the redirect URI to exactly: orion://oauth/tiktok",
                "Copy the Client Key and Client Secret into the fields here.",
                "Note: TikTok reviews apps by hand, which can take a few days.",
            ],
            readOnly: true
        ),
        ConnectorSpec(
            id: .instagram,
            name: "Instagram",
            purpose: "Follower count and reel performance.",
            auth: .oauth2(
                authorize: "https://api.instagram.com/oauth/authorize",
                token: "https://api.instagram.com/oauth/access_token",
                scopes: ["user_profile", "user_media"]
            ),
            registerURL: "https://developers.facebook.com/apps",
            setupSteps: [
                "Create a Meta app and add the Instagram Basic Display product.",
                "Set the redirect URI to exactly: orion://oauth/instagram",
                "Copy the App ID and App Secret into the fields here.",
                "Follower counts need a Business account and Meta's app review.",
            ],
            readOnly: true
        ),
    ]

    static func spec(for id: ConnectorID) -> ConnectorSpec {
        all.first { $0.id == id }!
    }
}

// MARK: - Keychain

/// The only place a credential is written.
///
/// Generic-password items keyed by connector and field. `kSecAttrAccessible`
/// is `WhenUnlockedThisDeviceOnly`: these are this Mac's grants, and syncing
/// them to iCloud would spread a bank aggregator's token further than the user
/// asked for.
enum SecretStore {

    private static let service = "com.nickmadaio.orion.connections"

    static func set(_ value: String?, connector: ConnectorID, field: String) {
        let account = "\(connector.rawValue).\(field)"
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else { return }
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func get(connector: ConnectorID, field: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(connector.rawValue).\(field)",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty
        else { return nil }
        return value
    }

    static func clear(connector: ConnectorID) {
        for field in Field.all {
            set(nil, connector: connector, field: field)
        }
    }

    enum Field {
        static let clientID = "client_id"
        static let clientSecret = "client_secret"
        static let accessToken = "access_token"
        static let refreshToken = "refresh_token"
        static let expiresAt = "expires_at"
        static let accountID = "account_id"
        static let all = [clientID, clientSecret, accessToken, refreshToken, expiresAt, accountID]
    }
}

// MARK: - State

enum ConnectionState: Equatable {
    /// Nothing registered yet.
    case needsCredentials
    /// Client id and secret present, but no grant.
    case readyToConnect
    case connected(expires: Date?)
    case expired
    case failed(String)

    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }

    var label: String {
        switch self {
        case .needsCredentials: return "needs setup"
        case .readyToConnect: return "ready"
        case .connected(let expires):
            guard let expires else { return "connected" }
            return "connected · renews \(expires.formatted(date: .omitted, time: .shortened))"
        case .expired: return "expired — reconnect"
        case .failed(let why): return why
        }
    }
}

final class ConnectionsModel: ObservableObject {

    @Published private(set) var states: [ConnectorID: ConnectionState] = [:]
    @Published var busy: ConnectorID?

    init() { refreshAll() }

    func refreshAll() {
        var next: [ConnectorID: ConnectionState] = [:]
        for spec in ConnectorSpec.all {
            next[spec.id] = derive(spec.id)
        }
        states = next
    }

    /// Derived from what is actually in the Keychain, never from a stored flag.
    /// A connector cannot claim to be connected without a token to show for it.
    private func derive(_ id: ConnectorID) -> ConnectionState {
        let hasCredentials = SecretStore.get(connector: id, field: SecretStore.Field.clientID) != nil
            && SecretStore.get(connector: id, field: SecretStore.Field.clientSecret) != nil
        guard hasCredentials else { return .needsCredentials }
        guard let token = SecretStore.get(connector: id, field: SecretStore.Field.accessToken),
              !token.isEmpty
        else { return .readyToConnect }
        if let raw = SecretStore.get(connector: id, field: SecretStore.Field.expiresAt),
           let seconds = Double(raw) {
            let expires = Date(timeIntervalSince1970: seconds)
            // A refresh token means expiry is routine rather than a disconnect.
            let refreshable = SecretStore.get(connector: id, field: SecretStore.Field.refreshToken) != nil
            if expires < Date() && !refreshable { return .expired }
            return .connected(expires: expires)
        }
        return .connected(expires: nil)
    }

    func state(_ id: ConnectorID) -> ConnectionState {
        states[id] ?? .needsCredentials
    }

    func saveCredentials(_ id: ConnectorID, clientID: String, clientSecret: String) {
        SecretStore.set(clientID.trimmingCharacters(in: .whitespacesAndNewlines),
                        connector: id, field: SecretStore.Field.clientID)
        SecretStore.set(clientSecret.trimmingCharacters(in: .whitespacesAndNewlines),
                        connector: id, field: SecretStore.Field.clientSecret)
        refreshAll()
    }

    func disconnect(_ id: ConnectorID) {
        // Only the grant, not the registration — disconnecting should not make
        // you go and find your client secret again.
        SecretStore.set(nil, connector: id, field: SecretStore.Field.accessToken)
        SecretStore.set(nil, connector: id, field: SecretStore.Field.refreshToken)
        SecretStore.set(nil, connector: id, field: SecretStore.Field.expiresAt)
        refreshAll()
    }

    func forget(_ id: ConnectorID) {
        SecretStore.clear(connector: id)
        refreshAll()
    }

    func connect(_ id: ConnectorID, completion: ((Result<Void, Error>) -> Void)? = nil) {
        let spec = ConnectorSpec.spec(for: id)
        guard case .oauth2(let authorize, let token, let scopes) = spec.auth else {
            states[id] = .failed("Plaid Link is not wired up yet — see the setup steps.")
            completion?(.failure(OAuthError.unsupported))
            return
        }
        guard let clientID = SecretStore.get(connector: id, field: SecretStore.Field.clientID),
              let clientSecret = SecretStore.get(connector: id, field: SecretStore.Field.clientSecret)
        else {
            states[id] = .needsCredentials
            completion?(.failure(OAuthError.missingCredentials))
            return
        }
        busy = id
        OAuthFlow.shared.run(
            connector: id,
            clientID: clientID,
            clientSecret: clientSecret,
            authorizeURL: authorize,
            tokenURL: token,
            scopes: scopes
        ) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.busy = nil
                switch result {
                case .success:
                    self.refreshAll()
                    completion?(.success(()))
                case .failure(let error):
                    self.states[id] = .failed(error.localizedDescription)
                    completion?(.failure(error))
                }
            }
        }
    }
}
