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

    /// True when something inside Orion actually READS this connector.
    ///
    /// Three of these have a working sign-in and no reader behind it: signing
    /// in stores a token that nothing ever sends anywhere. The Brand tab was
    /// printing a green LIVE for exactly those, which is the failure mode this
    /// whole file's header claims to prevent — a connector that lies about
    /// being connected. It is a fact about the code, so it belongs in the
    /// catalog rather than in a view's guesswork.
    var dataClient: Bool = false

    /// True when the provider issues refresh tokens, so a grant without one is
    /// a grant that cannot survive its own expiry.
    ///
    /// This is what turns "sign in again every single day" from a mystery into
    /// a state the UI can name. Instagram is deliberately false: it has no
    /// refresh token at all and instead issues sixty-day tokens, so a missing
    /// refresh token there is normal rather than broken.
    var renewable: Bool = false

    /// Which parameter name this provider wants the client identifier under.
    ///
    /// TikTok is the odd one out and it is not a typo in their docs: its OAuth
    /// v2 endpoints reject `client_id` and require `client_key`. Sending the
    /// wrong name fails the authorize step with an error that does not say
    /// which field was wrong.
    var clientIDParameter: String = "client_id"

    static let all: [ConnectorSpec] = [
        ConnectorSpec(
            id: .whoop,
            name: "Whoop",
            purpose: "Recovery, sleep, strain and resting heart rate.",
            auth: .oauth2(
                authorize: "https://api.prod.whoop.com/oauth/oauth2/auth",
                token: "https://api.prod.whoop.com/oauth/oauth2/token",
                // `offline` is NOT optional. Whoop's docs: "You must request the
                // offline scope to receive a refresh token." Without it the
                // access token dies in an hour with nothing to renew it from,
                // which is exactly why this needed signing in again every day.
                scopes: ["offline", "read:recovery", "read:sleep", "read:cycles", "read:workout", "read:profile"]
            ),
            registerURL: "https://developer.whoop.com",
            setupSteps: [
                "Sign in at developer.whoop.com and create an app.",
                "Set the redirect URI to exactly: orion://oauth/whoop",
                "Copy the Client ID and Client Secret into the fields here.",
                "Press Connect — Whoop opens in your browser and comes back. You should only ever have to do this once.",
            ],
            readOnly: true,
            dataClient: true,
            renewable: true
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
                "Nothing in Orion reads YouTube yet, so connecting this stores a grant and shows no numbers until that reader is written.",
            ],
            readOnly: true,
            dataClient: false,
            renewable: true
        ),
        ConnectorSpec(
            id: .plaid,
            name: "Plaid",
            purpose: "Chase and Fidelity balances and transactions. Read-only, and no bank password is ever seen or stored.",
            auth: .hostedLink,
            registerURL: "https://dashboard.plaid.com/signup",
            setupSteps: [
                "Create a free account at dashboard.plaid.com — Sandbox works immediately, no approval needed.",
                "Open Developers ▸ Keys and copy your client_id and the secret for the environment selected below.",
                "Paste both here and press Connect. There is no redirect URI to set for Plaid.",
                "SANDBOX has no real banks in it. The only institutions are Plaid's test ones — First Platypus Bank and friends — and every balance is invented. It proves the plumbing; it cannot show your money.",
                "Sandbox logins: phone 415-555-0011 (or “continue as guest”), phone code 123456, then user_good / pass_good, then 1234 for the bank's own MFA.",
                "FOR REAL CHASE AND FIDELITY: apply for the Trial plan at dashboard.plaid.com. Teams created on or after 15 April 2026 qualify — it is free, allows 10 live connections, and includes Chase, Bank of America and Wells Fargo. Most applications are approved automatically after identity verification, with no business registration or security questionnaire.",
                "Then switch the environment below to Production and paste the PRODUCTION secret here — it is a different string from the Sandbox one, and the grant is cleared on the way through because a token from one environment means nothing to the other.",
            ],
            readOnly: true,
            dataClient: true,
            // Plaid access tokens do not expire; there is nothing to renew.
            renewable: false
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
                "Nothing in Orion reads TikTok yet, so connecting this stores a grant and shows no numbers until that reader is written.",
            ],
            readOnly: true,
            dataClient: false,
            renewable: true,
            // TikTok calls it client_key, and rejects client_id outright.
            clientIDParameter: "client_key"
        ),
        ConnectorSpec(
            id: .instagram,
            name: "Instagram",
            purpose: "Follower count and reel performance. Needs a Professional (Business or Creator) account.",
            // "Instagram API with Instagram Login", which replaced Basic Display
            // when Meta shut that down on 4 December 2024. Different host for
            // authorize (instagram.com) than for the token exchange
            // (api.instagram.com) -- they are genuinely different domains, and
            // it is not a typo.
            auth: .oauth2(
                authorize: "https://www.instagram.com/oauth/authorize",
                token: "https://api.instagram.com/oauth/access_token",
                // The `instagram_business_*` names replaced the older bare
                // `business_*` ones in January 2025.
                scopes: ["instagram_business_basic"]
            ),
            registerURL: "https://developers.facebook.com/apps",
            setupSteps: [
                "Your Instagram account must be Professional — in the Instagram app: Settings ▸ Account type ▸ Switch to professional. Personal accounts cannot use this API at all.",
                "At developers.facebook.com/apps, create an app and pick the Business use case.",
                "In the app, Add Product ▸ Instagram ▸ set up API with Instagram Login.",
                "Under Instagram ▸ API setup, set the redirect URI to exactly: orion://oauth/instagram",
                "Copy the Instagram App ID and Instagram App Secret — the ones on the Instagram product page, NOT the Meta app ID at the top of the dashboard.",
                "Add yourself under Roles ▸ Instagram Testers, then accept the invite in the Instagram app under Settings ▸ Website permissions.",
                "Nothing in Orion reads Instagram yet, so connecting this stores a grant and shows no numbers until that reader is written.",
            ],
            readOnly: true,
            dataClient: false,
            // Instagram has no refresh token: it issues sixty-day tokens that
            // are refreshed by a different call entirely. A missing refresh
            // token here is normal, not a broken grant.
            renewable: false
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
        /// Which Plaid environment the stored secret belongs to.
        ///
        /// Sandbox and Production secrets are different strings, and presenting
        /// one to the other fails with INVALID_API_KEYS — an error that reads
        /// as "your credentials are wrong" when the truth is "those are the
        /// right credentials for the other environment".
        static let secretEnvironment = "secret_environment"
        /// Every linked Plaid institution, JSON-encoded. One access token per
        /// bank — see PlaidItem.
        static let items = "items"
        static let all = [clientID, clientSecret, accessToken, refreshToken, expiresAt,
                          accountID, secretEnvironment, items]
    }
}

// MARK: - State

enum ConnectionState: Equatable {
    /// The client exists but Orion has no implementation for it yet. Its own
    /// state rather than a failure, because offering a Connect button that
    /// always fails wastes the user's time twice: once registering an app they
    /// cannot use, and again working out whether they did it wrong. They did
    /// not.
    case notBuilt(String)
    /// Nothing registered yet.
    case needsCredentials
    /// Client id and secret present, but no grant.
    case readyToConnect
    case connected(expires: Date?)
    /// Signed in, and the grant has no refresh token behind it.
    ///
    /// This is the state that explains "why do I have to sign in every single
    /// day". Such a grant works right now and is dead within the hour, and the
    /// old code could not tell it apart from a healthy one — so it reported
    /// "connected", went silent, and turned into "expired — reconnect" the
    /// next morning, every morning. Naming it lets the UI say the true thing
    /// while the connection still works: reconnect once and this stops.
    case cannotRenew
    case expired
    case failed(String)

    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }

    /// True when a grant exists at all, healthy or not. `isConnected` is the
    /// stricter question and stays the one the data views ask.
    var hasGrant: Bool {
        switch self {
        case .connected, .cannotRenew, .expired: return true
        default: return false
        }
    }

    var label: String {
        switch self {
        case .notBuilt: return "not built yet"
        case .needsCredentials: return "needs setup"
        case .readyToConnect: return "ready"
        case .connected(let expires):
            // Deliberately NOT the raw expiry time. Whoop tokens last an hour
            // and renew themselves; printing "renews 1:03 AM" made a healthy
            // connection read like it was about to break.
            guard expires != nil else { return "connected" }
            return "connected · auto-renewing"
        case .cannotRenew: return "reconnect once — cannot renew"
        case .expired: return "expired — reconnect"
        case .failed(let why): return why
        }
    }
}

extension Notification.Name {
    /// A client changed what is in the Keychain — renewed a token, or cleared a
    /// grant the provider had revoked.
    ///
    /// Without this the model only re-derives when a view happens to ask, so a
    /// connection that died mid-session kept rendering as healthy until the
    /// window was reopened.
    static let orionConnectionsChanged = Notification.Name("orion.connections.changed")
}

final class ConnectionsModel: ObservableObject {

    @Published private(set) var states: [ConnectorID: ConnectionState] = [:]
    @Published var busy: ConnectorID?

    private var changeObserver: NSObjectProtocol?

    /// Fired the moment a connector finishes authorizing.
    ///
    /// Without this, a client that checked for a token at launch — before there
    /// was one — has no idea a grant just arrived, and its data does not appear
    /// until its own refresh timer next fires. Whoop's is 15 minutes, so
    /// connecting looked like it had silently failed for a quarter of an hour.
    var onConnected: ((ConnectorID) -> Void)?

    init() {
        refreshAll()
        changeObserver = NotificationCenter.default.addObserver(
            forName: .orionConnectionsChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.refreshAll()
        }
    }

    deinit {
        if let changeObserver {
            NotificationCenter.default.removeObserver(changeObserver)
        }
    }

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
        // Plaid holding the other environment's secret cannot connect, and
        // saying "ready" would send the user into a Connect that fails.
        if id == .plaid, ConnectionsModel.plaidSecretMismatch() { return .needsCredentials }

        guard let token = SecretStore.get(connector: id, field: SecretStore.Field.accessToken),
              !token.isEmpty
        else { return .readyToConnect }

        let refreshable = SecretStore.get(connector: id, field: SecretStore.Field.refreshToken) != nil

        if let raw = SecretStore.get(connector: id, field: SecretStore.Field.expiresAt),
           let seconds = Double(raw) {
            let expires = Date(timeIntervalSince1970: seconds)
            // A grant that expires and has nothing to renew from is broken
            // whether or not it has expired yet. Reporting that only after it
            // dies is what made this look like a new problem every morning
            // instead of one problem with one fix.
            if ConnectorSpec.spec(for: id).renewable && !refreshable { return .cannotRenew }
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
        // Stamp the environment this secret was entered for, so switching
        // environments later can say "that secret is for the other one"
        // instead of letting Connect fail with a credentials error.
        if id == .plaid {
            SecretStore.set(PlaidClient.environment, connector: id,
                            field: SecretStore.Field.secretEnvironment)
        }
        refreshAll()
    }

    /// True when Plaid holds a secret that belongs to the other environment.
    ///
    /// A secret with no stamp is treated as Sandbox: that is what every
    /// existing install has, since Sandbox is the default and was the only
    /// thing reachable before there was a switch.
    static func plaidSecretMismatch() -> Bool {
        guard SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret) != nil
        else { return false }
        let saved = SecretStore.get(connector: .plaid, field: SecretStore.Field.secretEnvironment)
            ?? "sandbox"
        return saved != PlaidClient.environment
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

    /// Set by the dashboard so Plaid's non-OAuth flow has somewhere to run.
    var plaid: PlaidClient?

    func connect(_ id: ConnectorID, completion: ((Result<Void, Error>) -> Void)? = nil) {
        let spec = ConnectorSpec.spec(for: id)
        // Plaid is not OAuth: no authorize URL, no code. It mints a link token,
        // runs in Plaid's own hosted page, and hands back a public token that
        // gets exchanged. PlaidClient owns that; everything else is shared.
        if case .hostedLink = spec.auth {
            guard SecretStore.get(connector: id, field: SecretStore.Field.clientID) != nil,
                  SecretStore.get(connector: id, field: SecretStore.Field.clientSecret) != nil
            else {
                states[id] = .needsCredentials
                completion?(.failure(OAuthError.missingCredentials))
                return
            }
            busy = id
            plaid?.beginLink { [weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.busy = nil
                    switch result {
                    case .success:
                        self.refreshAll()
                        self.onConnected?(id)
                        completion?(.success(()))
                    case .failure(let error):
                        self.states[id] = .failed(error.localizedDescription)
                        completion?(.failure(error))
                    }
                }
            }
            return
        }
        guard case .oauth2(let authorize, let token, let scopes) = spec.auth else {
            states[id] = .failed("This connector has no sign-in flow.")
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
            scopes: scopes,
            clientIDParameter: spec.clientIDParameter
        ) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.busy = nil
                switch result {
                case .success:
                    self.refreshAll()
                    self.onConnected?(id)
                    completion?(.success(()))
                case .failure(let error):
                    self.states[id] = .failed(error.localizedDescription)
                    completion?(.failure(error))
                }
            }
        }
    }
}
