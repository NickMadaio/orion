import Foundation

/*
 Whoop, read-only.

 The first real API client, and deliberately the template for the rest: fetch,
 map into a small local struct, publish on main, and never let a network shape
 leak into the view. The next connector should look like this one.

 Token refresh is handled here rather than in `OAuthFlow`, because expiry is a
 normal fact of a long-lived connection and not an error to hand back to the
 user. Whoop access tokens last an hour; without refresh the dashboard would
 report "expired — reconnect" every hour forever, which reads as broken.
*/

struct WhoopSnapshot: Equatable {
    var recovery: Int?          // 0-100
    var restingHeartRate: Int?
    var hrvMilliseconds: Int?
    var sleepPerformance: Int?  // 0-100
    var sleepHours: Double?
    var strain: Double?         // 0-21
    var capturedAt: Date

    /// The one-line call the reference puts under the recovery ring.
    var call: (headline: String, detail: String) {
        guard let recovery else {
            return ("No recovery score yet", "Whoop has not scored today.")
        }
        switch recovery {
        case 67...:
            return ("Green — go hard today",
                    "Body's primed. Take the harder session and the heavier task.")
        case 34..<67:
            return ("Yellow — steady",
                    "Maintain rather than push. Save the PR attempt for a green day.")
        default:
            return ("Red — back off",
                    "Recovery is low. Light movement and an early night beat a bad session.")
        }
    }
}

final class WhoopClient: ObservableObject {

    @Published private(set) var snapshot: WhoopSnapshot?
    @Published private(set) var lastError: String?
    @Published private(set) var isLoading = false

    /// v2, not v1.
    ///
    /// Whoop's migration guide is blunt about it: "The v1 API is no longer
    /// supported." Calling v1 is a second, independent reason the dashboard
    /// showed nothing even when the token was good.
    private let base = "https://api.prod.whoop.com/developer/v2"
    private var timer: Timer?

    func start() {
        refresh()
        // Whoop scores once a day and updates through the morning. Every
        // fifteen minutes is far more than enough and stays well inside the
        // rate limit.
        timer = Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        guard SecretStore.get(connector: .whoop, field: SecretStore.Field.accessToken) != nil else {
            snapshot = nil
            return
        }
        isLoading = true
        withFreshToken { [weak self] token in
            guard let self, let token else {
                DispatchQueue.main.async {
                    self?.isLoading = false
                    self?.lastError = "Whoop sign-in has expired. Reconnect it in Settings."
                }
                return
            }
            self.load(token: token)
        }
    }

    // MARK: - Fetch

    private func load(token: String) {
        let group = DispatchGroup()
        var next = WhoopSnapshot(capturedAt: Date())
        var failure: String?

        // Recovery carries the score, HRV and RHR in one record.
        group.enter()
        get("/recovery", token: token) { result in
            defer { group.leave() }
            switch result {
            case .failure(let error): failure = error.localizedDescription
            case .success(let json):
                guard let record = (json["records"] as? [[String: Any]])?.first,
                      let score = record["score"] as? [String: Any] else { return }
                next.recovery = (score["recovery_score"] as? Double).map { Int($0.rounded()) }
                next.restingHeartRate = (score["resting_heart_rate"] as? Double).map { Int($0.rounded()) }
                next.hrvMilliseconds = (score["hrv_rmssd_milli"] as? Double).map { Int($0.rounded()) }
            }
        }

        group.enter()
        get("/activity/sleep", token: token) { result in
            defer { group.leave() }
            if case .success(let json) = result,
               let record = (json["records"] as? [[String: Any]])?.first,
               let score = record["score"] as? [String: Any] {
                next.sleepPerformance = (score["sleep_performance_percentage"] as? Double).map { Int($0.rounded()) }
                if let stage = score["stage_summary"] as? [String: Any],
                   let milli = stage["total_in_bed_time_milli"] as? Double {
                    next.sleepHours = (milli / 3_600_000 * 10).rounded() / 10
                }
            }
        }

        group.enter()
        get("/cycle", token: token) { result in
            defer { group.leave() }
            if case .success(let json) = result,
               let record = (json["records"] as? [[String: Any]])?.first,
               let score = record["score"] as? [String: Any],
               let strain = score["strain"] as? Double {
                next.strain = (strain * 10).rounded() / 10
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.isLoading = false
            // Only replace a good snapshot when the new one has something in
            // it. A transient network failure should not blank the dashboard.
            let empty = next.recovery == nil && next.sleepPerformance == nil && next.strain == nil
            if !empty { self.snapshot = next }
            // Say WHICH failure. An empty panel with no message was the single
            // most useless state this screen could be in: connected, no data,
            // no reason given, nothing to act on.
            self.lastError = empty
                ? (failure
                    ?? "Whoop returned no records for today. If you have not worn the strap or it has not scored yet, there is genuinely nothing to show.")
                : nil
        }
    }

    private func get(
        _ path: String,
        token: String,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard var components = URLComponents(string: base + path) else {
            completion(.failure(OAuthError.badRedirect("bad Whoop URL")))
            return
        }
        components.queryItems = [URLQueryItem(name: "limit", value: "1")]
        guard let url = components.url else {
            completion(.failure(OAuthError.badRedirect("bad Whoop URL")))
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            if let status = (response as? HTTPURLResponse)?.statusCode, status >= 400 {
                // 401 means the token is dead and could not be renewed, which
                // is a different problem from "no data" and needs a different
                // fix from the user.
                let message = status == 401
                    ? "Whoop rejected the sign-in. Reconnect it in Settings ▸ Connections — this should be a one-off."
                    : "Whoop returned HTTP \(status) for \(path)."
                completion(.failure(OAuthError.providerError(message)))
                return
            }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                completion(.failure(OAuthError.providerError("Whoop sent a response Orion could not read.")))
                return
            }
            completion(.success(json))
        }.resume()
    }

    // MARK: - Token refresh

    /// Hands back a token that is good right now, refreshing first if needed.
    private func withFreshToken(_ completion: @escaping (String?) -> Void) {
        let token = SecretStore.get(connector: .whoop, field: SecretStore.Field.accessToken)
        let expiresAt = SecretStore.get(connector: .whoop, field: SecretStore.Field.expiresAt)
            .flatMap(Double.init)
            .map { Date(timeIntervalSince1970: $0) }
        // Sixty seconds of slack, so a token does not expire between the check
        // and the request it was checked for.
        if let expiresAt, expiresAt.timeIntervalSinceNow > 60, let token {
            completion(token)
            return
        }
        guard let refresh = SecretStore.get(connector: .whoop, field: SecretStore.Field.refreshToken),
              let clientID = SecretStore.get(connector: .whoop, field: SecretStore.Field.clientID),
              let clientSecret = SecretStore.get(connector: .whoop, field: SecretStore.Field.clientSecret),
              let url = URL(string: "https://api.prod.whoop.com/oauth/oauth2/token")
        else {
            completion(token)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refresh),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "client_secret", value: clientSecret),
            // Whoop drops the refresh token from the response unless it is
            // asked for again here, which quietly turns a renewable connection
            // into one that dies in an hour.
            URLQueryItem(name: "scope", value: "offline"),
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let fresh = json["access_token"] as? String
            else {
                completion(nil)
                return
            }
            SecretStore.set(fresh, connector: .whoop, field: SecretStore.Field.accessToken)
            if let rotated = json["refresh_token"] as? String {
                SecretStore.set(rotated, connector: .whoop, field: SecretStore.Field.refreshToken)
            }
            if let expiresIn = json["expires_in"] as? Double {
                SecretStore.set(String(Date().addingTimeInterval(expiresIn).timeIntervalSince1970),
                                connector: .whoop, field: SecretStore.Field.expiresAt)
            }
            completion(fresh)
        }.resume()
    }
}
