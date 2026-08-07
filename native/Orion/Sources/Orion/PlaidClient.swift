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

final class PlaidClient: ObservableObject {

    @Published private(set) var accounts: [PlaidAccount] = []
    @Published private(set) var transactions: [PlaidTransaction] = []
    @Published private(set) var items: [PlaidItem] = []
    @Published private(set) var status: String = ""
    @Published private(set) var isWorking = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncedAt: Date?
    /// Why there is nothing on screen, when there is nothing on screen.
    @Published private(set) var blockedReason: String?

    /// Sandbox by default, because a first attempt should not fail on an
    /// approval the user has not applied for yet.
    static let environmentKey = "OrionPlaidEnvironment"

    static var environment: String {
        UserDefaults.standard.string(forKey: environmentKey) ?? "sandbox"
    }

    static var isProduction: Bool { environment == "production" }

    /// Switch environments, and throw away everything that belonged to the old
    /// one.
    ///
    /// This has to clear the grant, and it is not tidiness. A Plaid access
    /// token is issued by one environment and is meaningless to the other, so
    /// keeping a sandbox token after switching to production means the next
    /// balance call fails with an invalid-token error that reads as "your bank
    /// connection broke" rather than "you changed environment". Same for the
    /// item id.
    ///
    /// The client_id is shared across environments; the SECRET is not, which is
    /// why the UI asks for it again on the way through.
    static func setEnvironment(_ next: String) {
        guard next != environment else { return }
        UserDefaults.standard.set(next, forKey: environmentKey)
        SecretStore.set(nil, connector: .plaid, field: SecretStore.Field.accessToken)
        SecretStore.set(nil, connector: .plaid, field: SecretStore.Field.accountID)
        OrionLog.write("[plaid] environment switched to \(next); grant cleared")
        NotificationCenter.default.post(name: .orionConnectionsChanged, object: nil)
    }

    private var host: String { "https://\(Self.environment).plaid.com" }

    /// How far back to pull transactions. Ninety days is enough to see three
    /// occurrences of a monthly charge, which is what the recurring detector
    /// needs before it will call something a subscription.
    private let transactionWindowDays = 90

    // MARK: - Linked items
    //
    // Plaid issues an access token per ITEM — one login at one institution — so
    // Chase and Fidelity are two tokens. This used to be a single Keychain
    // field, which meant linking the second bank silently overwrote the first
    // and the app could only ever show one of them.

    static func storedItems() -> [PlaidItem] {
        guard let raw = SecretStore.get(connector: .plaid, field: SecretStore.Field.items),
              let data = raw.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([PlaidItem].self, from: data)
        else {
            // Carry a pre-multi-item install forward rather than making the
            // user re-link the bank they already connected.
            if let legacy = SecretStore.get(connector: .plaid, field: SecretStore.Field.accessToken) {
                let itemID = SecretStore.get(connector: .plaid, field: SecretStore.Field.accountID) ?? "legacy"
                return [PlaidItem(itemID: itemID, accessToken: legacy, institutionName: "Bank")]
            }
            return []
        }
        return decoded
    }

    static func saveItems(_ items: [PlaidItem]) {
        guard let data = try? JSONEncoder().encode(items),
              let raw = String(data: data, encoding: .utf8)
        else { return }
        SecretStore.set(raw, connector: .plaid, field: SecretStore.Field.items)
        // The single-token fields are what `ConnectionsModel` derives state
        // from, so keep one populated for as long as any item exists.
        SecretStore.set(items.first?.accessToken, connector: .plaid, field: SecretStore.Field.accessToken)
        SecretStore.set(items.first?.itemID, connector: .plaid, field: SecretStore.Field.accountID)
        NotificationCenter.default.post(name: .orionConnectionsChanged, object: nil)
    }

    func forget(_ itemID: String) {
        let remaining = Self.storedItems().filter { $0.itemID != itemID }
        Self.saveItems(remaining)
        items = remaining
        refresh()
    }

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
                    let itemID = json["item_id"] as? String ?? UUID().uuidString

                    // Append, never replace. Re-linking the SAME institution
                    // replaces just that item, so fixing a broken Chase login
                    // does not also drop Fidelity.
                    var items = Self.storedItems().filter { $0.itemID != itemID }
                    items.append(PlaidItem(itemID: itemID, accessToken: accessToken,
                                           institutionName: "Linked account"))
                    Self.saveItems(items)
                    self.items = items
                    OrionLog.write("[plaid] item linked — \(items.count) institution(s) now connected")

                    self.status = ""
                    self.nameInstitution(for: accessToken, itemID: itemID)
                    self.refresh()
                    completion(.success(()))
                }
            }
        }
    }

    // MARK: - Reading

    /// Every linked institution, in parallel, merged.
    func refresh() {
        let items = Self.storedItems()
        self.items = items
        // Say WHY nothing happened. The previous version returned silently on
        // every one of these, so an empty Finances tab and a missing Keychain
        // item and a wrong environment all looked identical — from the outside
        // and in the log, which had nothing in it at all.
        let clientID = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientID)
        let secret = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret)
        guard let clientID, let secret, !items.isEmpty else {
            var missing: [String] = []
            if clientID == nil { missing.append("client_id") }
            if secret == nil { missing.append("client_secret") }
            if items.isEmpty { missing.append("no linked items") }
            let reason = missing.joined(separator: ", ")
            OrionLog.write("[plaid] refresh skipped — \(reason) (env \(Self.environment))")
            accounts = []
            transactions = []
            lastSyncedAt = nil
            blockedReason = "Nothing to load: \(reason)."
            return
        }
        blockedReason = nil
        OrionLog.write("[plaid] refreshing \(items.count) item(s) in \(Self.environment)")

        isWorking = true
        let group = DispatchGroup()
        // Three requests per item all land on separate URLSession queues.
        let lock = NSLock()
        var collectedAccounts: [PlaidAccount] = []
        var collectedTransactions: [PlaidTransaction] = []
        var failure: String?

        for item in items {
            group.enter()
            post("/accounts/balance/get",
                 body: ["client_id": clientID, "secret": secret, "access_token": item.accessToken]) { result in
                defer { group.leave() }
                lock.lock(); defer { lock.unlock() }
                switch result {
                case .failure(let error):
                    failure = "\(item.institutionName): \(error.localizedDescription)"
                    OrionLog.write("[plaid] balance for \(item.institutionName) — \(error.localizedDescription)")
                case .success(let json):
                    collectedAccounts += PlaidClient.parseAccounts(json, institution: item.institutionName)
                }
            }

            group.enter()
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            let start = Calendar.current.date(byAdding: .day, value: -transactionWindowDays, to: Date()) ?? Date()
            post("/transactions/get",
                 body: [
                    "client_id": clientID,
                    "secret": secret,
                    "access_token": item.accessToken,
                    "start_date": formatter.string(from: start),
                    "end_date": formatter.string(from: Date()),
                    "options": ["count": 500],
                 ]) { result in
                defer { group.leave() }
                lock.lock(); defer { lock.unlock() }
                // Transactions are NOT an error worth surfacing on their own.
                // Plaid returns PRODUCT_NOT_READY for the first minute or two
                // after linking while it pulls history, and a red banner over a
                // working balances screen would be wrong.
                if case .success(let json) = result {
                    collectedTransactions += PlaidClient.parseTransactions(json)
                } else if case .failure(let error) = result {
                    OrionLog.write("[plaid] transactions for \(item.institutionName) — \(error.localizedDescription)")
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.isWorking = false
            self.accounts = collectedAccounts.sorted { left, right in
                if left.institutionName != right.institutionName {
                    return left.institutionName < right.institutionName
                }
                return (left.current ?? 0) > (right.current ?? 0)
            }
            self.transactions = collectedTransactions.sorted { $0.date > $1.date }
            self.lastSyncedAt = Date()
            self.lastError = collectedAccounts.isEmpty ? failure : nil
            OrionLog.write("[plaid] refreshed — \(collectedAccounts.count) account(s), "
                           + "\(collectedTransactions.count) transaction(s) across \(items.count) institution(s)")
        }
    }

    /// Ask Plaid which bank an item belongs to, so the UI can group by name
    /// rather than by an opaque item id.
    private func nameInstitution(for accessToken: String, itemID: String) {
        guard
            let clientID = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientID),
            let secret = SecretStore.get(connector: .plaid, field: SecretStore.Field.clientSecret)
        else { return }
        post("/item/get", body: ["client_id": clientID, "secret": secret, "access_token": accessToken]) { [weak self] result in
            guard case .success(let json) = result,
                  let item = json["item"] as? [String: Any],
                  let institutionID = item["institution_id"] as? String
            else { return }
            self?.post("/institutions/get_by_id", body: [
                "client_id": clientID,
                "secret": secret,
                "institution_id": institutionID,
                "country_codes": ["US"],
            ]) { inner in
                guard case .success(let json) = inner,
                      let institution = json["institution"] as? [String: Any],
                      let name = institution["name"] as? String
                else { return }
                DispatchQueue.main.async {
                    var items = PlaidClient.storedItems()
                    guard let index = items.firstIndex(where: { $0.itemID == itemID }) else { return }
                    items[index].institutionName = name
                    PlaidClient.saveItems(items)
                    self?.items = items
                    self?.refresh()
                }
            }
        }
    }

    // MARK: - Parsing

    static func parseAccounts(_ json: [String: Any], institution: String) -> [PlaidAccount] {
        (json["accounts"] as? [[String: Any]] ?? []).map { entry in
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
                currency: balances["iso_currency_code"] as? String ?? "USD",
                institutionName: institution
            )
        }
    }

    static func parseTransactions(_ json: [String: Any]) -> [PlaidTransaction] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")

        return (json["transactions"] as? [[String: Any]] ?? []).compactMap { entry in
            guard let id = entry["transaction_id"] as? String,
                  let amount = entry["amount"] as? Double,
                  let rawDate = entry["date"] as? String,
                  let date = formatter.date(from: rawDate)
            else { return nil }
            // v2 categories. `category` (the old array) is deprecated and is
            // deliberately not read.
            let category = (entry["personal_finance_category"] as? [String: Any])?["primary"] as? String
            return PlaidTransaction(
                id: id,
                accountID: entry["account_id"] as? String ?? "",
                name: entry["name"] as? String ?? "Transaction",
                merchant: entry["merchant_name"] as? String,
                amount: amount,
                date: date,
                category: category ?? "OTHER",
                isPending: entry["pending"] as? Bool ?? false
            )
        }
    }

    /// Assets minus debts — see `PlaidAccount.isLiability` for why a plain sum
    /// would count a credit-card balance as savings.
    var netWorth: Double { Money.netWorth(accounts) }
    var currency: String { accounts.first?.currency ?? "USD" }

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
