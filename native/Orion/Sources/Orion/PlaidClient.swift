import AppKit
import Foundation

/*
 Chase and Fidelity, through Plaid, read-only.

 Why this looks nothing like the other connectors: Plaid is not OAuth. There is
 no authorize URL to redirect to and no code to exchange. The flow is

   1. ask Plaid for a link token, using the client id and secret;
   2. send the user to Plaid's own Link experience;
   3. get a short-lived public token back;
   4. trade that for a long-lived access token.

 Step 2 is normally a JavaScript widget embedded in a page, which a native Mac
 app has nowhere to put. Plaid's **Hosted Link** solves it: ask for
 `hosted_link` at step 1 and Plaid returns an ordinary https URL that runs the
 whole thing in a browser. So Orion opens a URL, then POLLS `/link/token/get`
 until the public token appears.

 Polling rather than a redirect is deliberate. A redirect back into the app
 would need either a custom scheme (Plaid does not offer one) or a Universal
 Link (needs an Apple Developer Team ID this app does not have). Polling needs
 neither, and the cost is a few seconds of waiting on a flow run once per bank.

 READ ONLY, structurally: the only endpoints touched are link-token creation,
 token exchange, and balance/transaction reads. There is no transfer, payment,
 or trading call anywhere in this file, and the bank password is typed into
 Plaid's page — never seen by Orion.
*/

struct PlaidAccount: Identifiable, Equatable {
    let id: String
    var name: String
    var officialName: String
    var mask: String
    var type: String
    var subtype: String
    var available: Double?
    var current: Double?
    var currency: String

    var displayName: String {
        officialName.isEmpty ? name : officialName
    }

    var maskedLabel: String {
        mask.isEmpty ? displayName : "\(displayName) ··\(mask)"
    }
}

final class PlaidClient: ObservableObject {

    @Published private(set) var accounts: [PlaidAccount] = []
    @Published private(set) var status: String = ""
    @Published private(set) var isWorking = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncedAt: Date?

    /// Sandbox by default. Production needs Plaid's approval, so making it the
    /// default would mean every first attempt fails with a permissions error.
    static let environmentKey = "OrionPlaidEnvironment"

    static var environment: String {
        UserDefaults.standard.string(forKey: environmentKey) ?? "sandbox"
    }

    private var host: String { "https://\(Self.environment).plaid.com" }

    private var pollTimer: Timer?
    private var pollAttempts = 0

    /// Stop waiting. Without this the only way out of a half-finished Link was
    /// to wait ten minutes or quit the app, which is not a real option.
    func cancel() {
        stopPolling()
        isWorking = false
        status = ""
        lastError = "Cancelled. Press Connect to start again."
    }

    var isWaitingForBrowser: Bool { pollTimer != nil }

    // MARK: - Linking

    /// Step 1 and 2: mint a hosted Link URL and open it.
    func beginLink(completion: @escaping (Result<Void, Error>) -> Void) {
        guard
            let clientID = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientID),
            let secret = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret)
        else {
            completion(.failure(PlaidError.missingCredentials))
            return
        }
        isWorking = true
        status = "Asking Plaid for a link…"

        // `client_user_id` identifies the end user to Plaid. One local user, so
        // a stable synthetic id is correct — and deliberately not an email or
        // anything else identifying.
        let body: [String: Any] = [
            "client_id": clientID,
            "secret": secret,
            "client_name": "Orion",
            "language": "en",
            "country_codes": ["US"],
            "user": ["client_user_id": Self.stableUserID()],
            "products": ["transactions"],
            "hosted_link": [:],
        ]

        post("/link/token/create", body: body) { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                DispatchQueue.main.async {
                    self.isWorking = false
                    self.lastError = error.localizedDescription
                    self.status = ""
                }
                completion(.failure(error))
            case .success(let json):
                guard
                    let linkToken = json["link_token"] as? String,
                    let hosted = json["hosted_link_url"] as? String,
                    let url = URL(string: hosted)
                else {
                    // Naming the likely cause matters here: Hosted Link is opt-in
                // on some Plaid accounts, and the raw API error does not say so.
                let message = (json["error_message"] as? String)
                        ?? "Plaid did not return a hosted link URL. Hosted Link may need enabling on your Plaid account, under Team Settings."
                    DispatchQueue.main.async {
                        self.isWorking = false
                        self.lastError = message
                        self.status = ""
                    }
                    completion(.failure(PlaidError.api(message)))
                    return
                }
                DispatchQueue.main.async {
                    self.status = "Finish in your browser — waiting for Plaid…"
                    NSWorkspace.shared.open(url)
                    self.startPolling(linkToken: linkToken, completion: completion)
                }
            }
        }
    }

    /// Step 3: wait for the public token to show up on the link token.
    private func startPolling(
        linkToken: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        pollTimer?.invalidate()
        pollAttempts = 0
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.pollAttempts += 1
            // Say how long, so a flow that is genuinely still waiting looks
            // different from one that has quietly died.
            let seconds = self.pollAttempts * 3
            self.status = "Waiting for Plaid… \(seconds)s. Finish in your browser."
            // Ten minutes. Past that the user has almost certainly abandoned
            // it, and a timer polling a dead link forever is its own bug.
            if self.pollAttempts > 200 {
                self.stopPolling()
                self.lastError = "Timed out waiting for Plaid. Press Connect to start again."
                self.status = ""
                self.isWorking = false
                completion(.failure(PlaidError.timedOut))
                return
            }
            self.checkLinkToken(linkToken, completion: completion)
        }
    }

    private func checkLinkToken(
        _ linkToken: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard
            let clientID = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientID),
            let secret = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret)
        else { return }
        post(
            "/link/token/get",
            body: ["client_id": clientID, "secret": secret, "link_token": linkToken]
        ) { [weak self] result in
            guard let self else { return }
            guard case .success(let json) = result else {
                // Was swallowed entirely, which meant a link token Plaid had
                // started rejecting looked identical to one still waiting for
                // the user — ten minutes of "Waiting for Plaid…" either way.
                if case .failure(let error) = result {
                    OrionLog.write("[plaid] link/token/get failed — \(error.localizedDescription)")
                }
                return
            }
            guard let publicToken = PlaidClient.publicToken(in: json) else { return }
            OrionLog.write("[plaid] public token found after \(self.pollAttempts) poll(s)")
            DispatchQueue.main.async {
                self.stopPolling()
                self.status = "Linking account…"
                self.exchange(publicToken: publicToken, completion: completion)
            }
        }
    }

    /// Dig the public token out of `/link/token/get`.
    ///
    /// This is where the whole flow was failing. The old code read
    /// `link_sessions.last["public_token"]`, and `public_token` is never at the
    /// top level of a session — Plaid nests it at
    /// `link_sessions[].results.item_add_results[].public_token`, with a
    /// deprecated `on_success.public_token` still returned for older
    /// integrations. So the read was nil on every poll, the loop never
    /// finished, and ten minutes later it timed out having done everything
    /// else correctly.
    ///
    /// Both paths are accepted, because which one an account gets depends on
    /// when the integration was set up, and the newer one exists to support
    /// Multi-Item Link returning several tokens from one session.
    ///
    /// The newest session is chosen by `finished_at` rather than by array
    /// position: Plaid does not document the ordering of `link_sessions`, and
    /// after a retry the array holds an abandoned session as well as the good
    /// one.
    static func publicToken(in json: [String: Any]) -> String? {
        let sessions = json["link_sessions"] as? [[String: Any]] ?? []
        return sessions
            .compactMap { session -> (Date, String)? in
                guard let token = token(in: session) else { return nil }
                let finished = (session["finished_at"] as? String)
                    .flatMap(parseTimestamp) ?? .distantPast
                return (finished, token)
            }
            .max { $0.0 < $1.0 }?
            .1
    }

    private static func token(in session: [String: Any]) -> String? {
        if let results = session["results"] as? [String: Any],
           let adds = results["item_add_results"] as? [[String: Any]] {
            for add in adds {
                if let token = add["public_token"] as? String, !token.isEmpty {
                    return token
                }
            }
        }
        if let onSuccess = session["on_success"] as? [String: Any],
           let token = onSuccess["public_token"] as? String, !token.isEmpty {
            return token
        }
        return nil
    }

    private static func parseTimestamp(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return fractional.date(from: raw) ?? plain.date(from: raw)
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Step 4: public token becomes a durable access token, into the Keychain.
    private func exchange(
        publicToken: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard
            let clientID = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientID),
            let secret = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret)
        else { return }
        post(
            "/item/public_token/exchange",
            body: ["client_id": clientID, "secret": secret, "public_token": publicToken]
        ) { [weak self] result in
            guard let self else { return }
            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .failure(let error):
                    self.lastError = error.localizedDescription
                    self.status = ""
                    completion(.failure(error))
                case .success(let json):
                    guard let accessToken = json["access_token"] as? String else {
                        let message = (json["error_message"] as? String) ?? "No access token returned."
                        self.lastError = message
                        self.status = ""
                        completion(.failure(PlaidError.api(message)))
                        return
                    }
                    SecretStore.set(accessToken, connector: .plaid,
                                    field: SecretStore.Field.accessToken)
                    if let itemID = json["item_id"] as? String {
                        SecretStore.set(itemID, connector: .plaid,
                                        field: SecretStore.Field.accountID)
                    }
                    self.status = ""
                    self.refresh()
                    completion(.success(()))
                }
            }
        }
    }

    // MARK: - Reading

    func refresh() {
        guard
            let clientID = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientID),
            let secret = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret),
            let accessToken = SecretStore.get(connector: .plaid, field: SecretStore.Field.accessToken)
        else { return }
        isWorking = true
        post(
            "/accounts/balance/get",
            body: ["client_id": clientID, "secret": secret, "access_token": accessToken]
        ) { [weak self] result in
            guard let self else { return }
            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .failure(let error):
                    self.lastError = error.localizedDescription
                case .success(let json):
                    let raw = json["accounts"] as? [[String: Any]] ?? []
                    self.accounts = raw.map { entry in
                        let balances = entry["balances"] as? [String: Any] ?? [:]
                        return PlaidAccount(
                            id: entry["account_id"] as? String ?? UUID().uuidString,
                            name: entry["name"] as? String ?? "Account",
                            officialName: entry["official_name"] as? String ?? "",
                            mask: entry["mask"] as? String ?? "",
                            type: entry["type"] as? String ?? "",
                            subtype: entry["subtype"] as? String ?? "",
                            available: balances["available"] as? Double,
                            current: balances["current"] as? Double,
                            currency: balances["iso_currency_code"] as? String ?? "USD"
                        )
                    }
                    self.lastSyncedAt = Date()
                    self.lastError = nil
                }
            }
        }
    }

    var totalBalance: Double {
        accounts.reduce(0) { $0 + ($1.current ?? 0) }
    }

    // MARK: - Plumbing

    private func post(
        _ path: String,
        body: [String: Any],
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard let url = URL(string: host + path) else {
            completion(.failure(PlaidError.api("Bad Plaid URL.")))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error { completion(.failure(error)); return }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                completion(.failure(PlaidError.api("Plaid sent a response Orion could not read.")))
                return
            }
            // Plaid reports failures in the body with 400s, so the message is
            // more useful than the status code.
            if let message = json["error_message"] as? String {
                // Plaid's own message plus the code, because the message alone
                // is often generic and the code is what is searchable.
                let code = json["error_code"] as? String
                completion(.failure(PlaidError.api(code.map { "\(message) (\($0))" } ?? message)))
                return
            }
            completion(.success(json))
        }.resume()
    }

    /// Stable per-install identifier for Plaid's `client_user_id`.
    /// Random and stored locally — not an email, not a device serial.
    private static func stableUserID() -> String {
        let key = "OrionPlaidUserID"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
    }
}

enum PlaidError: LocalizedError {
    case missingCredentials
    case api(String)
    case timedOut

    var errorDescription: String? {
        switch self {
        case .missingCredentials: return "Add your Plaid client_id and secret first."
        case .api(let message): return message
        case .timedOut: return "Timed out waiting for Plaid."
        }
    }
}
