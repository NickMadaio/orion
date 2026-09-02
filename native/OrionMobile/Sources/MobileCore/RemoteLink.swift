import Foundation

// PHASE 44 — the Mac's outbound link, and how the phone shows it.
//
// The manifest is mostly a list of negatives: the Mac establishes the
// connection OUTBOUND, never exposes a public server, never needs router port
// forwarding. Then six mechanisms — reconnect, heartbeat, last-seen,
// online/offline, rotation, certificate/key validation — and one sentence about
// the phone: it "must clearly display Mac availability".
//
// This file is the domain for all of that. The transport itself is not here and
// is not stubbed: `scripts/orion-remote` already carries the command vocabulary
// over an append-only file bridge, and attaching a real channel is a separate,
// credentialled step. A fake transport that pretended to connect would make
// every test below meaningless, which is exactly why there is not one.
//
// ## Outbound-only is a shape, not a promise
//
// "Never expose a public server" cannot be enforced by a comment. So there is
// no way to SPELL a listener here: `LinkEndpoint` names somewhere to dial and
// has no bind address, no listen port, and no backlog. A test reflects over its
// stored properties and pins the set, so adding `listenPort` fails by name
// rather than at the point somebody opens a socket with it.
//
// ## The distinction the whole file is built around
//
// `unknown` is not `offline`. "I have never heard from your Mac" and "your Mac
// is off" are different facts, and a phone that renders the first as the second
// tells you your Mac is down when what actually happened is that YOUR phone
// lost signal. That is the single most likely wrong answer this screen can
// give, it is the one a person would act on, and so it has its own case and its
// own headline rather than being folded into offline for tidiness.
//
// ## Everything is evaluated at an injected instant
//
// No `Date()` and no timer inside this logic. Presence, staleness, rotation and
// backoff are all functions of a moment that is passed in, because every
// interesting property here is a boundary and a boundary you cannot name is a
// boundary you cannot test.

// MARK: - Where to dial

/// Somewhere the Mac connects OUT to.
///
/// The absent fields are the design — see the note above. There is deliberately
/// no bind address and no listen port, so this type cannot describe a server.
public struct LinkEndpoint: Sendable, Equatable {
    /// Which transport, by name. Display and audit only.
    public let channel: String
    /// The remote host being dialled.
    public let host: String
    public let port: Int
    /// Fingerprints of keys this endpoint is allowed to present.
    public let pin: KeyPin

    public init?(channel: String, host: String, port: Int, pin: KeyPin) {
        let channel = channel.trimmingCharacters(in: .whitespaces)
        let host = host.trimmingCharacters(in: .whitespaces)
        guard !channel.isEmpty, !host.isEmpty, (1...65535).contains(port) else { return nil }
        self.channel = channel
        self.host = host
        self.port = port
        self.pin = pin
    }
}

// MARK: - Certificate and key validation

/// The set of key fingerprints this link will accept.
///
/// An EMPTY pin set accepts nothing. That is the whole point of the type, and
/// it is the opposite of the usual accident: a validator that treats "no pins
/// configured" as "allow anything" turns a missing config value into a silently
/// unauthenticated connection, which is the failure that looks exactly like
/// success. Failing closed means a misconfiguration cannot connect at all,
/// which is loud and safe.
public struct KeyPin: Sendable, Equatable {
    public private(set) var fingerprints: Set<String>

    public init(_ fingerprints: Set<String> = []) {
        self.fingerprints = Set(fingerprints.compactMap(KeyPin.normalise))
    }

    /// Fingerprints are compared in one spelling. `AA:BB:CC` and `aabbcc` are
    /// the same key, and a comparison that says otherwise rejects the right key
    /// on a bad day and teaches somebody to disable pinning.
    static func normalise(_ raw: String) -> String? {
        let cleaned = raw.lowercased().filter { $0.isHexDigit }
        return cleaned.isEmpty ? nil : cleaned
    }

    public var isConfigured: Bool { !fingerprints.isEmpty }

    public func accepts(_ fingerprint: String) -> Bool {
        guard let candidate = KeyPin.normalise(fingerprint) else { return false }
        return fingerprints.contains(candidate)
    }
}

// MARK: - Heartbeat and presence

public enum MacPresence: String, CaseIterable, Sendable {
    /// A beat arrived within the expected interval.
    case online
    /// A beat is overdue but not by enough to give up on.
    case stale
    /// Long enough without a beat to call it gone.
    case offline
    /// Never heard from at all. NOT the same as offline, and never displayed as
    /// though it were — see the note at the top of this file.
    case unknown
}

/// How long silence is allowed to last before it means something.
public struct HeartbeatPolicy: Sendable, Equatable {
    public let interval: TimeInterval
    public let staleAfter: TimeInterval
    public let offlineAfter: TimeInterval

    /// Refuses a policy whose thresholds are out of order. `staleAfter` below
    /// `interval` marks a healthy link stale on every single beat; `offlineAfter`
    /// below `staleAfter` makes the stale state unreachable, so a link would go
    /// straight from online to offline and the intermediate warning nobody sees
    /// is the one the screen exists to show.
    public init?(interval: TimeInterval, staleAfter: TimeInterval, offlineAfter: TimeInterval) {
        guard interval > 0, staleAfter >= interval, offlineAfter > staleAfter else { return nil }
        self.interval = interval
        self.staleAfter = staleAfter
        self.offlineAfter = offlineAfter
    }

    /// 30s beats, stale at two minutes, offline at five.
    public static let standard = HeartbeatPolicy(interval: 30, staleAfter: 120, offlineAfter: 300)!
}

/// What is known about the Mac's link right now.
public struct MacLink: Sendable, Equatable {
    /// Nil means never heard from, which is `unknown` and not `offline`.
    public let lastSeen: Date?
    /// The current connection's id, for rotation and for the audit trail.
    public let connectionID: String?
    public let establishedAt: Date?
    /// Consecutive failed connection attempts, driving the backoff.
    public let failedAttempts: Int

    public init(lastSeen: Date? = nil, connectionID: String? = nil,
                establishedAt: Date? = nil, failedAttempts: Int = 0) {
        self.lastSeen = lastSeen
        self.connectionID = connectionID
        self.establishedAt = establishedAt
        self.failedAttempts = max(0, failedAttempts)
    }

    public func presence(at moment: Date, policy: HeartbeatPolicy = .standard) -> MacPresence {
        guard let lastSeen else { return .unknown }
        let silence = moment.timeIntervalSince(lastSeen)
        // A beat from the future is a clock disagreement, not good health.
        // Treating it as online would let a wrong clock pin the screen to
        // "Online" forever, which is the one state nobody re-checks.
        if silence < 0 { return .unknown }
        if silence >= policy.offlineAfter { return .offline }
        if silence >= policy.staleAfter { return .stale }
        return .online
    }
}

// MARK: - Reconnect

/// Exponential backoff with a ceiling.
///
/// The ceiling is not a nicety. Without one the delay grows until the Mac
/// effectively never retries, and the link that is supposed to heal itself
/// quietly stops trying; without backoff at all, a Mac that cannot reach the
/// endpoint hammers it, which is a self-inflicted denial of service against the
/// one channel Nick would use to find out why.
public struct ReconnectPolicy: Sendable, Equatable {
    public let base: TimeInterval
    public let cap: TimeInterval

    public init?(base: TimeInterval, cap: TimeInterval) {
        guard base > 0, cap >= base else { return nil }
        self.base = base
        self.cap = cap
    }

    public static let standard = ReconnectPolicy(base: 2, cap: 300)!

    /// Delay before attempt number `failures + 1`.
    ///
    /// `jitter` is INJECTED rather than drawn from a random source, because a
    /// policy that reaches for randomness inside itself cannot be tested at its
    /// boundaries — and the boundaries (never zero, never above the cap) are
    /// the only properties that matter. A caller passes a fraction in 0...1.
    public func delay(afterFailures failures: Int, jitter: Double = 0) -> TimeInterval {
        guard failures > 0 else { return 0 }
        let clampedJitter = min(max(jitter, 0), 1)
        // Exponent capped before the shift so a long outage cannot overflow into
        // a nonsense value; 2^30 base seconds already exceeds any sane cap.
        let exponent = min(failures - 1, 30)
        let raw = base * pow(2, Double(exponent))
        let ceiling = min(raw, cap)
        // Jitter only ever REDUCES, down to half. Adding would let the delay
        // exceed the cap, and the cap is the property being guaranteed.
        return ceiling * (1 - 0.5 * clampedJitter)
    }
}

// MARK: - Rotation

/// When a connection has been up long enough that it should be replaced.
public struct RotationPolicy: Sendable, Equatable {
    public let maxAge: TimeInterval

    public init?(maxAge: TimeInterval) {
        guard maxAge > 0 else { return nil }
        self.maxAge = maxAge
    }

    public static let standard = RotationPolicy(maxAge: 12 * 3600)!

    /// A link with no established time is not "due for rotation" — it is not
    /// connected. Answering true there would make the reconnect loop rotate a
    /// connection that does not exist, forever.
    public func shouldRotate(_ link: MacLink, at moment: Date) -> Bool {
        guard let establishedAt = link.establishedAt, link.connectionID != nil else { return false }
        return moment.timeIntervalSince(establishedAt) >= maxAge
    }
}

// MARK: - What the phone shows

/// Mac availability, as the phone displays it.
///
/// The manifest asks for this to be CLEAR, which is a real requirement and not
/// a decorative one: the four presences have four distinct headlines, and
/// `unknown` never borrows `offline`'s.
public struct MacAvailability: Sendable, Equatable {
    public let presence: MacPresence
    public let lastSeen: Date?

    public init(link: MacLink, at moment: Date, policy: HeartbeatPolicy = .standard) {
        self.presence = link.presence(at: moment, policy: policy)
        self.lastSeen = link.lastSeen
    }

    public var headline: String {
        switch presence {
        case .online: return "Online"
        case .stale: return "Not responding"
        case .offline: return "Offline"
        case .unknown: return "Never connected"
        }
    }

    /// Whether the phone should let somebody send anything at all.
    ///
    /// False for everything but `online`. Queueing into silence and reporting
    /// it as sent is worse than refusing: the person walks away believing the
    /// Mac was told something it never heard.
    public var canSend: Bool { presence == .online }

    /// Whether the state is one the person should be able to act on rather than
    /// just read. Stale and offline are worth a retry control; `unknown` is
    /// worth a setup one, and they are not the same affordance.
    public var suggestsReconnect: Bool { presence == .stale || presence == .offline }
}
