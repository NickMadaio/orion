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
                "Copy the Client ID and Client Secret into the fields here.",
                "Press Connect. Orion receives Google's reply on a temporary 127.0.0.1 address, which Desktop OAuth clients allow automatically — there is no redirect URI to add in Google Cloud.",
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

    /// Where every Keychain read that happens at launch actually runs.
    ///
    /// `SecItemCopyMatching` is not a local lookup. It is a mach round trip to
    /// securityd, and securityd blocks that call for as long as it takes a
    /// human to answer a SecurityAgent prompt — which can be forever. Keychain
    /// ACLs are bound to the app's code signature and every rebuild changes the
    /// signature, so the FIRST launch of every build raises that prompt.
    ///
    /// On 2026-08-12 that prompt arrived while `ConnectionsModel.init` was
    /// deriving state inside `NSHostingView(DashboardView)` — on the main
    /// thread, during view construction, before any window existed. All 2323
    /// samples of the hung process sat in `mach_msg` under
    /// `SecItemCopyMatching`. Orion never opened a window, and because the
    /// audio meter reports through `DispatchQueue.main.async`, the log went
    /// dead too: a silent, permanent hang at 0.1% CPU caused by a dialog the
    /// user had not clicked yet.
    ///
    /// So nothing on the launch path calls `get` directly any more. It asks for
    /// a `Secrets` snapshot, which is filled in here, off the main thread. An
    /// unanswered prompt now costs a connections list that reads "checking…"
    /// for a while instead of an assistant that never starts.
    private static let queue = DispatchQueue(label: "com.nickmadaio.orion.keychain",
                                             qos: .userInitiated)

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

    // MARK: Snapshots

    /// A point-in-time copy of what the Keychain holds.
    ///
    /// Reading one of these touches securityd exactly zero times, which is the
    /// entire point: it is safe to derive UI state from on the main thread,
    /// whereas `get` is not and never was.
    struct Secrets {
        fileprivate let values: [String: String]

        /// What the launch path starts with, and what it keeps if the user
        /// walks away from the authorization prompt. Every connector derives to
        /// "needs setup" from this, which is wrong-but-harmless and corrects
        /// itself the moment securityd answers.
        static let empty = Secrets(values: [:])

        func value(_ connector: ConnectorID, _ field: String) -> String? {
            values["\(connector.rawValue).\(field)"]
        }

        func has(_ connector: ConnectorID, _ field: String) -> Bool {
            value(connector, field) != nil
        }
    }

    /// The fields connection state is derived from.
    ///
    /// Deliberately not `Field.all`. Every field is its own securityd round
    /// trip and, on the first launch after a rebuild, potentially its own
    /// authorization prompt — so the snapshot asks for what the derivation
    /// actually reads and nothing more.
    static let derivedFields = [
        Field.clientID, Field.clientSecret, Field.accessToken,
        Field.refreshToken, Field.expiresAt, Field.secretEnvironment,
    ]

    /// Read some fields for some connectors without blocking the caller.
    ///
    /// The completion always arrives on the main thread, because everything
    /// that wants one of these is about to publish to a view.
    static func load(
        _ connectors: [ConnectorID],
        fields: [String],
        completion: @escaping (Secrets) -> Void
    ) {
        queue.async {
            var values: [String: String] = [:]
            for connector in connectors {
                for field in fields {
                    guard let value = get(connector: connector, field: field) else { continue }
                    values["\(connector.rawValue).\(field)"] = value
                }
            }
            let secrets = Secrets(values: values)
            DispatchQueue.main.async { completion(secrets) }
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
    /// The Keychain has not answered yet.
    ///
    /// Every connector starts here now. Deriving state means reading secrets,
    /// reading secrets can block on a SecurityAgent prompt, and blocking on
    /// that prompt used to happen on the main thread during view construction —
    /// see `SecretStore.queue` for the launch it hung. A named waiting state is
    /// what lets that read move off the main thread: the row can say it does
    /// not know yet, instead of the app having to know before it can open.
    case checking
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
        case .checking: return "checking…"
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

    /// True when Plaid holds a secret that belongs to the other environment.
    ///
    /// Published rather than asked for on demand. The row that shows this used
    /// to call a static that read the Keychain from inside `body` — which is
    /// the main thread, which is the one thread that must never wait on
    /// securityd. See `SecretStore.queue`.
    @Published private(set) var plaidSecretMismatch = false

    private var changeObserver: NSObjectProtocol?

    /// Fired the moment a connector finishes authorizing.
    ///
    /// Without this, a client that checked for a token at launch — before there
    /// was one — has no idea a grant just arrived, and its data does not appear
    /// until its own refresh timer next fires. Whoop's is 15 minutes, so
    /// connecting looked like it had silently failed for a quarter of an hour.
    var onConnected: ((ConnectorID) -> Void)?

    init() {
        // Seeded WITHOUT touching the Keychain, and that is the whole fix.
        //
        // This initialiser runs inside `NSHostingView(DashboardView)`, on the
        // main thread, before Orion has a window. It used to derive state here,
        // which meant reading secrets here, which meant waiting on securityd
        // here — and on the first launch after any rebuild securityd is waiting
        // on a SecurityAgent prompt the user has not seen yet, because the app
        // that would have drawn behind it never opened. See `SecretStore.queue`.
        states = Dictionary(uniqueKeysWithValues: ConnectorSpec.all.map { ($0.id, .checking) })
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

    /// Re-derive every connector from a fresh Keychain snapshot.
    ///
    /// Returns immediately. The states arrive on the main thread whenever
    /// securityd answers, which may be never — if the user walks away from the
    /// authorization prompt, the rows sit on "checking…" and everything else
    /// about Orion carries on working. That is the trade this whole file's
    /// launch path is built around.
    func refreshAll(then: (() -> Void)? = nil) {
        SecretStore.load(ConnectorID.allCases, fields: SecretStore.derivedFields) {
            [weak self] secrets in
            guard let self else { return }
            defer { then?() }
            // Read once, on the main thread, and hand the same value to every
            // derivation — otherwise Plaid's environment could change between
            // two connectors and produce a snapshot that disagrees with itself.
            let environment = PlaidClient.environment
            var next: [ConnectorID: ConnectionState] = [:]
            for spec in ConnectorSpec.all {
                next[spec.id] = ConnectionsModel.derive(spec.id, from: secrets,
                                                        environment: environment)
            }
            self.plaidSecretMismatch = ConnectionsModel.plaidSecretMismatch(
                in: secrets, environment: environment
            )
            self.states = next
        }
    }

    /// Derived from what is actually in the Keychain, never from a stored flag.
    /// A connector cannot claim to be connected without a token to show for it.
    ///
    /// Pure, and static, over a snapshot rather than over live Keychain reads:
    /// that is what lets the reads happen somewhere other than the main thread,
    /// and it means the derivation can be reasoned about without a securityd
    /// round trip in the middle of it.
    static func derive(
        _ id: ConnectorID,
        from secrets: SecretStore.Secrets,
        environment: String
    ) -> ConnectionState {
        let hasCredentials = secrets.has(id, SecretStore.Field.clientID)
            && secrets.has(id, SecretStore.Field.clientSecret)
        guard hasCredentials else { return .needsCredentials }
        // Plaid holding the other environment's secret cannot connect, and
        // saying "ready" would send the user into a Connect that fails.
        if id == .plaid, plaidSecretMismatch(in: secrets, environment: environment) {
            return .needsCredentials
        }

        guard let token = secrets.value(id, SecretStore.Field.accessToken),
              !token.isEmpty
        else { return .readyToConnect }

        let refreshable = secrets.has(id, SecretStore.Field.refreshToken)

        if let raw = secrets.value(id, SecretStore.Field.expiresAt),
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

    /// Unknown until the Keychain answers, rather than "needs setup".
    ///
    /// A connector Orion has not looked at yet is not a connector the user has
    /// failed to configure, and saying "needs setup" next to a working Whoop
    /// grant for the first second of every launch is the kind of small lie this
    /// file's header is about.
    func state(_ id: ConnectorID) -> ConnectionState {
        states[id] ?? .checking
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
    static func plaidSecretMismatch(
        in secrets: SecretStore.Secrets,
        environment: String
    ) -> Bool {
        guard secrets.has(.plaid, SecretStore.Field.clientSecret) else { return false }
        let saved = secrets.value(.plaid, SecretStore.Field.secretEnvironment) ?? "sandbox"
        return saved != environment
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

    /// Re-read the Keychain AND ask every live connector to pull its data.
    ///
    /// The rows already re-derive when a grant changes, but nothing re-derives
    /// when the grant is fine and the CLIENT is the thing that is stuck — a
    /// connector that failed once sat there looking broken until its own timer
    /// came round a quarter of an hour later. This is the button for that, and
    /// it reuses `onConnected` because "pull your data now" is exactly what a
    /// client does the moment it is connected.
    func recheck() {
        refreshAll { [weak self] in
            guard let self else { return }
            for spec in ConnectorSpec.all where self.state(spec.id).isConnected {
                self.onConnected?(spec.id)
            }
        }
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
