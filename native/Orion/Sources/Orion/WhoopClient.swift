import Foundation

/*
 Whoop, read-only.

 Three separate faults lived in this file, and together they produced the two
 symptoms that mattered: signing in again every single day, and an empty panel
 while apparently connected.

   1. NO REFRESH TOKEN, NO WARNING. A grant made without the `offline` scope
      comes back with an access token and nothing to renew it from. It works for
      an hour and is then dead forever. This client could not tell that apart
      from a healthy grant, so it reported connected, went quiet, and by the
      next morning the only visible state was "expired — reconnect". Every day.
      `ConnectionState.cannotRenew` names it now, and the checks below refuse to
      pretend a dead grant is a working one.

   2. CONCURRENT REFRESH KILLED THE GRANT. Whoop rotates the refresh token and
      invalidates the old one on use. The timer, the connect callback and the
      Refresh button could all call in at once; the first exchange succeeded and
      every other one presented a token Whoop had just revoked. A single-flight
      guard is not politeness here, it is what stops the connection destroying
      itself.

   3. `limit=1` AND HOPE. The old fetch asked for exactly one record with no
      date window and no ordering guarantee, then took `records.first` and
      believed it. That is a coin flip on getting the day you wanted, and it
      returns nothing at all on a morning Whoop has not scored yet. Now: a
      seven-day window, filter to records Whoop says are SCORED, and take the
      genuinely most recent — so an unscored morning shows yesterday's numbers
      and says so, rather than showing an empty screen.

 The client also logs. Not one line of this ever reached orion-app.log before,
 which is why the whole thing had to be diagnosed from the Keychain instead.
*/

struct WhoopSnapshot: Equatable {
    var recovery: Int?          // 0-100
    var restingHeartRate: Int?
    var hrvMilliseconds: Int?
    var sleepPerformance: Int?  // 0-100
    var sleepHours: Double?
    var strain: Double?         // 0-21
    /// The day these numbers are ABOUT, which is frequently not today.
    var recordedOn: Date?
    /// The end of the most recent real night — when you actually got up.
    var wokeAt: Date?
    /// When Orion fetched them.
    var capturedAt: Date

    /// Said plainly, because "recovery 62" means something different if it is
    /// Tuesday's. Showing stale numbers as though they were current is the
    /// quiet version of showing made-up ones.
    var dayLabel: String {
        guard let recordedOn else { return "latest reading" }
        let calendar = Calendar.current
        if calendar.isDateInToday(recordedOn) { return "today" }
        if calendar.isDateInYesterday(recordedOn) { return "yesterday" }
        return recordedOn.formatted(.dateTime.weekday(.wide).month().day())
    }

    /// The one-line call under the recovery ring.
    var call: (headline: String, detail: String) {
        guard let recovery else {
            return ("No recovery score yet", "Whoop has not scored a day in the last week.")
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
    /// The whole week, so the tab can show where today sits rather than one
    /// number with no context. See WhoopSeries for why this was free.
    @Published private(set) var week = WhoopWeek()
    @Published private(set) var lastError: String?
    @Published private(set) var isLoading = false

    /// v2, not v1.
    ///
    /// Whoop's migration guide is blunt about it: "The v1 API is no longer
    /// supported."
    private let base = "https://api.prod.whoop.com/developer/v2"

    /// How far back to look for a scored day. Long enough that a missed night
    /// or an unscored morning still shows something true.
    private let lookbackDays = 7

    private var timer: Timer?

    /// Single-flight. See fault 2 in the file header — this is load-bearing.
    private var tokenRefreshInFlight = false
    private var pendingTokenWaiters: [(String?) -> Void] = []

    // MARK: - Lifecycle

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

    // MARK: - Refresh

    func refresh() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.refresh() }
            return
        }
        guard !isLoading else {
            OrionLog.write("[whoop] refresh skipped — one already in flight")
            return
        }
        // The token check is a Keychain read, and a Keychain read can sit in
        // securityd for as long as an unanswered authorization prompt lasts.
        // `start()` calls this from the dashboard's `onAppear`, so doing it
        // inline is doing it on the launch path — which is the 2026-08-12 hang
        // one frame further down. Ask off the main thread and come back.
        SecretStore.load([.whoop], fields: SecretStore.derivedFields) { [weak self] secrets in
            self?.refresh(with: secrets)
        }
    }

    /// The rest of `refresh()`, once the Keychain has actually answered.
    private func refresh(with secrets: SecretStore.Secrets) {
        guard !isLoading else { return }
        guard secrets.has(.whoop, SecretStore.Field.accessToken) else {
            snapshot = nil
            lastError = nil
            OrionLog.write("[whoop] no access token — not connected")
            return
        }
        // A grant with no refresh token is the daily-login state. Say so here
        // rather than letting it fail as a network error in an hour's time.
        let renewable = secrets.has(.whoop, SecretStore.Field.refreshToken)
        if !renewable {
            OrionLog.write("[whoop] grant has NO refresh token — it cannot renew itself")
        }

        isLoading = true
        lastError = nil
        withFreshToken(secrets) { [weak self] token in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let token else {
                    self.isLoading = false
                    self.lastError = renewable
                        ? "Whoop would not renew the sign-in. Reconnect it in Settings ▸ Connections."
                        : "This Whoop sign-in was granted without offline access, so it cannot renew itself. Reconnect once in Settings ▸ Connections and it will stay connected."
                    OrionLog.write("[whoop] no usable token — \(self.lastError ?? "")")
                    return
                }
                self.load(token: token)
            }
        }
    }

    // MARK: - Fetch

    private func load(token: String) {
        let group = DispatchGroup()
        // The three requests complete on separate URLSession queues and all
        // write here, so the shared state is behind a lock. It was not before:
        // three callbacks mutating one struct and one error string concurrently
        // is a data race that would show up as a field intermittently missing
        // from an otherwise fine snapshot — the hardest possible version of
        // "sometimes Whoop doesn't fill in".
        let lock = NSLock()
        var collected: [String: [[String: Any]]] = [:]
        var failure: String?
        var authFailed = false

        func finish(_ path: String, _ result: Result<[[String: Any]], Error>) {
            lock.lock()
            defer { lock.unlock(); group.leave() }
            switch result {
            case .success(let records):
                collected[path] = records
            case .failure(let error):
                if case OAuthError.unauthorized = error { authFailed = true }
                failure = error.localizedDescription
            }
        }

        for path in ["/recovery", "/activity/sleep", "/cycle"] {
            group.enter()
            get(path, token: token) { finish(path, $0) }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.isLoading = false

            let recoveries = collected["/recovery"] ?? []
            // Naps are sleep records too, and treating one as the night would
            // report a twenty-minute afternoon nap as the night's sleep and,
            // worse, as the time you woke up.
            let sleeps = (collected["/activity/sleep"] ?? []).filter { ($0["nap"] as? Bool) != true }
            let cycles = collected["/cycle"] ?? []

            let week = WhoopClient.buildWeek(recoveries: recoveries, sleeps: sleeps, cycles: cycles)
            var next = WhoopClient.snapshot(recoveries: recoveries, sleeps: sleeps, cycles: cycles)

            // The end of the most recent real night IS the moment the day
            // started. Everything that buckets by day reads this — see OrionDay.
            if let latestSleep = WhoopClient.mostRecentScored(sleeps),
               let wokeAt = (latestSleep["end"] as? String).flatMap(WhoopClient.parseTimestamp) {
                OrionDay.recordWake(wokeAt)
                next.wokeAt = wokeAt
            }

            // Only replace a good snapshot when the new one has something in
            // it. A transient network failure should not blank the dashboard.
            let empty = next.recovery == nil && next.sleepPerformance == nil && next.strain == nil
            if !empty {
                self.snapshot = next
                self.week = week
                self.lastError = nil
                OrionLog.write("[whoop] loaded recovery=\(next.recovery.map { "\($0)" } ?? "—") "
                               + "sleep=\(next.sleepPerformance.map { "\($0)" } ?? "—") "
                               + "strain=\(next.strain.map { String(format: "%.1f", $0) } ?? "—") "
                               + "for \(next.dayLabel) · \(week.points.count) day(s) of history")
                return
            }

            if authFailed {
                // The token was rejected outright. Clear the grant so the UI
                // offers Connect instead of insisting it is connected — a
                // connector that lies about its own state is the one thing this
                // layer is supposed to prevent.
                SecretStore.set(nil, connector: .whoop, field: SecretStore.Field.accessToken)
                SecretStore.set(nil, connector: .whoop, field: SecretStore.Field.expiresAt)
                NotificationCenter.default.post(name: .orionConnectionsChanged, object: nil)
                self.lastError = "Whoop rejected the sign-in. Reconnect it in Settings ▸ Connections."
            } else {
                self.lastError = failure
                    ?? "Whoop has no scored day in the last \(self.lookbackDays) days. If the strap has not been worn, there is genuinely nothing to show."
            }
            OrionLog.write("[whoop] empty result — \(self.lastError ?? "unknown")")
        }
    }

    /// One collection request, over a date window, returning the records array.
    private func get(
        _ path: String,
        token: String,
        completion: @escaping (Result<[[String: Any]], Error>) -> Void
    ) {
        guard var components = URLComponents(string: base + path) else {
            completion(.failure(OAuthError.badRedirect("bad Whoop URL")))
            return
        }
        let start = Calendar.current.date(byAdding: .day, value: -lookbackDays, to: Date()) ?? Date()
        components.queryItems = [
            // 25 is Whoop's per-page maximum. A week of days fits comfortably.
            URLQueryItem(name: "limit", value: "25"),
            URLQueryItem(name: "start", value: WhoopClient.iso8601.string(from: start)),
        ]
        guard let url = components.url else {
            completion(.failure(OAuthError.badRedirect("bad Whoop URL")))
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                OrionLog.write("[whoop] GET \(path) failed — \(error.localizedDescription)")
                completion(.failure(error))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 || status == 403 {
                OrionLog.write("[whoop] GET \(path) — HTTP \(status), token rejected")
                completion(.failure(OAuthError.unauthorized))
                return
            }
            if status >= 400 {
                OrionLog.write("[whoop] GET \(path) — HTTP \(status)")
                completion(.failure(OAuthError.providerError("Whoop returned HTTP \(status) for \(path).")))
                return
            }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                completion(.failure(OAuthError.providerError("Whoop sent a response Orion could not read.")))
                return
            }
            let records = json["records"] as? [[String: Any]] ?? []
            OrionLog.write("[whoop] GET \(path) — \(records.count) record(s)")
            completion(.success(records))
        }.resume()
    }

    // MARK: - Mapping records

    /// Whoop's field names, in one place, so a rename is one edit rather than
    /// a hunt through three call sites that each looked slightly different.
    private static func recoveryFields(_ record: [String: Any]) -> (Int?, Int?, Int?) {
        guard let score = record["score"] as? [String: Any] else { return (nil, nil, nil) }
        return (
            (score["recovery_score"] as? Double).map { Int($0.rounded()) },
            (score["resting_heart_rate"] as? Double).map { Int($0.rounded()) },
            (score["hrv_rmssd_milli"] as? Double).map { Int($0.rounded()) }
        )
    }

    private static func sleepFields(_ record: [String: Any]) -> (Int?, Double?) {
        guard let score = record["score"] as? [String: Any] else { return (nil, nil) }
        let performance = (score["sleep_performance_percentage"] as? Double).map { Int($0.rounded()) }
        var hours: Double?
        if let stage = score["stage_summary"] as? [String: Any],
           let milli = stage["total_in_bed_time_milli"] as? Double {
            hours = (milli / 3_600_000 * 10).rounded() / 10
        }
        return (performance, hours)
    }

    private static func strainField(_ record: [String: Any]) -> Double? {
        guard let score = record["score"] as? [String: Any],
              let strain = score["strain"] as? Double else { return nil }
        return (strain * 10).rounded() / 10
    }

    /// The newest of everything, which is what the hero reads.
    static func snapshot(
        recoveries: [[String: Any]],
        sleeps: [[String: Any]],
        cycles: [[String: Any]]
    ) -> WhoopSnapshot {
        var next = WhoopSnapshot(capturedAt: Date())
        if let record = mostRecentScored(recoveries) {
            let (recovery, rhr, hrv) = recoveryFields(record)
            next.recovery = recovery
            next.restingHeartRate = rhr
            next.hrvMilliseconds = hrv
            next.recordedOn = timestamp(of: record)
        }
        if let record = mostRecentScored(sleeps) {
            let (performance, hours) = sleepFields(record)
            next.sleepPerformance = performance
            next.sleepHours = hours
        }
        if let record = mostRecentScored(cycles) {
            next.strain = strainField(record)
        }
        return next
    }

    /// Fold three collections into one point per day, oldest first.
    ///
    /// Bucketing by the calendar day of each record's own timestamp lines the
    /// three collections up: a recovery is stamped the morning it is computed,
    /// a night's sleep by when it ended, and a cycle by when it began — which
    /// for Whoop is the same waking moment. They land on the same day without
    /// having to correlate cycle ids across collections.
    static func buildWeek(
        recoveries: [[String: Any]],
        sleeps: [[String: Any]],
        cycles: [[String: Any]]
    ) -> WhoopWeek {
        let calendar = Calendar.current
        var byDay: [Date: WhoopDayPoint] = [:]

        func point(for record: [String: Any]) -> Date? {
            guard let stamp = timestamp(of: record) else { return nil }
            return calendar.startOfDay(for: stamp)
        }

        for record in recoveries where record["score"] is [String: Any] {
            guard let day = point(for: record) else { continue }
            let (recovery, rhr, hrv) = recoveryFields(record)
            var entry = byDay[day] ?? WhoopDayPoint(date: day)
            entry.recovery = recovery
            entry.restingHeartRate = rhr
            entry.hrv = hrv
            byDay[day] = entry
        }

        for record in sleeps where record["score"] is [String: Any] {
            guard let day = point(for: record) else { continue }
            let (performance, hours) = sleepFields(record)
            var entry = byDay[day] ?? WhoopDayPoint(date: day)
            entry.sleepPerformance = performance
            entry.sleepHours = hours
            byDay[day] = entry
        }

        for record in cycles where record["score"] is [String: Any] {
            guard let day = point(for: record) else { continue }
            var entry = byDay[day] ?? WhoopDayPoint(date: day)
            entry.strain = strainField(record)
            byDay[day] = entry
        }

        return WhoopWeek(points: byDay.values.sorted { $0.date < $1.date })
    }

    // MARK: - Picking the right record

    /// The newest record Whoop says it has actually scored.
    ///
    /// Both halves matter. `score_state` filters out the days Whoop has
    /// accepted but not yet computed — those arrive with `score` absent, and
    /// taking one produced the empty panel. Sorting by timestamp rather than
    /// trusting the array order is what makes "today, or the last day there
    /// was one" true regardless of how the API chooses to paginate.
    static func mostRecentScored(_ records: [[String: Any]]) -> [String: Any]? {
        records
            .filter { record in
                guard record["score"] is [String: Any] else { return false }
                // Absent score_state on a record that has a score is fine;
                // present-and-not-SCORED is not.
                guard let state = record["score_state"] as? String else { return true }
                return state == "SCORED"
            }
            .max { left, right in
                (timestamp(of: left) ?? .distantPast) < (timestamp(of: right) ?? .distantPast)
            }
    }

    /// When a record is FROM. Whoop uses different field names per collection,
    /// so try the ones that exist in order of how well they describe the day.
    static func timestamp(of record: [String: Any]) -> Date? {
        for key in ["end", "start", "created_at", "updated_at"] {
            if let raw = record[key] as? String, let date = parseTimestamp(raw) { return date }
        }
        return nil
    }

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let iso8601Fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Whoop stamps some fields with fractional seconds and some without, and
    /// ISO8601DateFormatter returns nil rather than coping with both.
    static func parseTimestamp(_ raw: String) -> Date? {
        iso8601Fractional.date(from: raw) ?? iso8601.date(from: raw)
    }

    // MARK: - Token refresh

    /// Hands back a token that is good right now, refreshing first if needed.
    ///
    /// Single-flight: concurrent callers queue on the one exchange rather than
    /// each starting their own. Whoop invalidates the previous refresh token
    /// the moment one is used, so two exchanges in flight means the second one
    /// presents a revoked credential and permanently breaks the connection.
    ///
    /// Takes the snapshot its caller already paid for rather than reading the
    /// Keychain again: these five reads used to happen on the main thread, and
    /// five more chances to block on securityd is five more ways to hang the
    /// launch. The values are microseconds old, which is exactly as fresh as
    /// reading them here would have been.
    private func withFreshToken(
        _ secrets: SecretStore.Secrets,
        completion: @escaping (String?) -> Void
    ) {
        let token = secrets.value(.whoop, SecretStore.Field.accessToken)
        let expiresAt = secrets.value(.whoop, SecretStore.Field.expiresAt)
            .flatMap(Double.init)
            .map { Date(timeIntervalSince1970: $0) }

        // Sixty seconds of slack, so a token does not expire between the check
        // and the request it was checked for.
        if let expiresAt, expiresAt.timeIntervalSinceNow > 60, let token {
            completion(token)
            return
        }

        guard let refresh = secrets.value(.whoop, SecretStore.Field.refreshToken),
              let clientID = secrets.value(.whoop, SecretStore.Field.clientID),
              let clientSecret = secrets.value(.whoop, SecretStore.Field.clientSecret),
              let url = URL(string: "https://api.prod.whoop.com/oauth/oauth2/token")
        else {
            // Nothing to renew from. Hand back the token only if it is still
            // alive; a stale one would fail as a mystery 401 rather than as the
            // reconnect-once state it actually is.
            let stillValid = (expiresAt.map { $0.timeIntervalSinceNow > 0 } ?? true)
            completion(stillValid ? token : nil)
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { completion(nil); return }
            self.pendingTokenWaiters.append(completion)
            guard !self.tokenRefreshInFlight else {
                OrionLog.write("[whoop] token refresh already running — queued")
                return
            }
            self.tokenRefreshInFlight = true
            self.exchangeRefreshToken(
                refresh: refresh,
                clientID: clientID,
                clientSecret: clientSecret,
                url: url
            )
        }
    }

    private func exchangeRefreshToken(
        refresh: String,
        clientID: String,
        clientSecret: String,
        url: URL
    ) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refresh),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "client_secret", value: clientSecret),
            // Whoop's own documented refresh call includes this. Without it the
            // response carries no refresh token, which quietly turns a renewable
            // connection into one that dies in an hour — the same daily-login
            // failure by a different route.
            URLQueryItem(name: "scope", value: "offline"),
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)

        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            var fresh: String?
            defer { self?.finishTokenRefresh(with: fresh) }

            if let error {
                OrionLog.write("[whoop] token refresh failed — \(error.localizedDescription)")
                return
            }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                OrionLog.write("[whoop] token refresh returned something unreadable")
                return
            }
            if let providerError = json["error"] as? String {
                OrionLog.write("[whoop] token refresh rejected — \(providerError)")
                // `invalid_grant` means this refresh token is spent or revoked
                // and no retry will ever work. Clear it so the UI stops
                // promising a connection that cannot come back on its own.
                if providerError.contains("invalid_grant") {
                    SecretStore.set(nil, connector: .whoop, field: SecretStore.Field.refreshToken)
                    SecretStore.set(nil, connector: .whoop, field: SecretStore.Field.accessToken)
                    SecretStore.set(nil, connector: .whoop, field: SecretStore.Field.expiresAt)
                    NotificationCenter.default.post(name: .orionConnectionsChanged, object: nil)
                }
                return
            }
            guard let accessToken = json["access_token"] as? String else {
                OrionLog.write("[whoop] token refresh returned no access_token")
                return
            }

            SecretStore.set(accessToken, connector: .whoop, field: SecretStore.Field.accessToken)
            if let rotated = json["refresh_token"] as? String {
                SecretStore.set(rotated, connector: .whoop, field: SecretStore.Field.refreshToken)
            }
            if let expiresIn = json["expires_in"] as? Double {
                SecretStore.set(String(Date().addingTimeInterval(expiresIn).timeIntervalSince1970),
                                connector: .whoop, field: SecretStore.Field.expiresAt)
            }
            OrionLog.write("[whoop] token renewed"
                           + (json["refresh_token"] != nil ? " (refresh token rotated)" : " (NO new refresh token)"))
            NotificationCenter.default.post(name: .orionConnectionsChanged, object: nil)
            fresh = accessToken
        }.resume()
    }

    private func finishTokenRefresh(with token: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.tokenRefreshInFlight = false
            let waiters = self.pendingTokenWaiters
            self.pendingTokenWaiters = []
            waiters.forEach { $0(token) }
        }
    }
}
