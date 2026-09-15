import Foundation

// PHASE 42 — the Security Center.
//
// The manifest asks for a mobile security interface that DISPLAYS eight things
// and ALLOWS seven. Both lists are closed enums here, and the interesting half
// is the second one.
//
// ## Every action the manifest asks for takes authority away
//
// Read the seven: revoke device, revoke session, disconnect Gmail, disconnect
// Calendar, disable remote control, revoke delegation, inspect audit history.
// Six removals and one read. Not one of them grants anything, and that is not
// an accident of drafting — a security screen that can also grant is an
// escalation surface, and it is the screen most likely to be reachable from a
// lock screen, a notification, or a stolen unlocked phone.
//
// So `SecurityActionEffect` has exactly two members, `reducesAuthority` and
// `readsOnly`, and there is no third. A future action that grants something
// cannot be given an effect, which means it cannot be added here without
// somebody deliberately widening this type. That is the enforcement: not a
// review checklist, an absent enum member.
//
// The same reasoning makes the lock rule fall out. Locking ORION does not
// remove a single action from this screen, because all seven are removals or
// reads — and a lock that stopped you revoking a stolen device would be
// precisely backwards. That is asserted directly rather than left implied.
//
// ## Automation permissions are DECODED from the live producer
//
// `AuthoritySnapshot` decodes `docs/planning/v2/CURRENT_AUTHORITY.json`, which
// `scripts/orion_v2_authority_snapshot.py` generates from the real capability
// catalogue in `openclaw-plugins/orion-control`. It is not a Swift-side
// re-listing of the tiers: the profile names are the five in `permissions.ts`
// and a sixth one appearing there makes the Swift decode FAIL and name the
// string, rather than quietly displaying nothing.
// `scripts/orion_v2_authority_contract_check.sh` feeds it the real file and
// cross-checks the profile list against the compiled plugin at runtime.
//
// ## What this file is not
//
// It is the model a Security Center screen reads. Nothing renders it yet, and
// no revocation is wired to a live effect — `disconnectGmail` returns an action
// the caller must carry out. Recorded in the gate as a limitation rather than
// implied to be live.

// MARK: - What the screen shows

/// The eight panels, closed. A section that is not on this list is not part of
/// the Security Center, which is what stops it drifting into a settings screen.
public enum SecurityCenterSection: String, CaseIterable, Sendable {
    case devices
    case sessions
    case connections
    case connectorScopes = "connector_scopes"
    case remoteControl = "remote_control"
    case delegatedPermissions = "delegated_permissions"
    case automationPermissions = "automation_permissions"
    case securityEvents = "security_events"
}

// MARK: - What the screen can do

/// What an action does to how much ORION is allowed to do.
///
/// Two members, and the absence of a third is the design. There is no
/// `grantsAuthority`, so no action on this screen can be defined as granting
/// one — see the note at the top of this file.
public enum SecurityActionEffect: String, CaseIterable, Sendable {
    case reducesAuthority = "reduces_authority"
    case readsOnly = "reads_only"
}

/// The seven the manifest allows.
public enum SecurityAction: String, CaseIterable, Sendable, Equatable {
    case revokeDevice = "revoke_device"
    case revokeSession = "revoke_session"
    case disconnectGmail = "disconnect_gmail"
    case disconnectCalendar = "disconnect_calendar"
    case disableRemoteControl = "disable_remote_control"
    case revokeDelegation = "revoke_delegation"
    case inspectAuditHistory = "inspect_audit_history"

    /// Total switch, no `default:`. A new action must be classified, and the
    /// only two things it can be classified as take authority away or read.
    public var effect: SecurityActionEffect {
        switch self {
        case .revokeDevice, .revokeSession, .disconnectGmail, .disconnectCalendar,
             .disableRemoteControl, .revokeDelegation:
            return .reducesAuthority
        case .inspectAuditHistory:
            return .readsOnly
        }
    }

    /// Whether the UI must confirm before doing it.
    ///
    /// Everything that reduces authority is confirmed, because every one of
    /// them is inconvenient to undo and two of them (revoking the device you
    /// are holding, disconnecting Calendar) are how you lock yourself out.
    /// Reading is never confirmed — a confirmation on an audit view teaches
    /// people to dismiss confirmations.
    public var needsConfirmation: Bool { effect == .reducesAuthority }
}

// MARK: - Connections and their scopes

/// One permission a connector actually holds, in the provider's own words and
/// in plain ones.
///
/// `writes` is the field that matters. "Connected to Gmail" tells somebody
/// nothing; "can send mail as you" is the fact they are deciding about, and a
/// screen that lists opaque scope URLs has disclosed nothing.
public struct ConnectorScope: Sendable, Equatable {
    /// The provider's own scope string, shown so it can be checked against
    /// their console.
    public let raw: String
    /// What it permits, in words.
    public let summary: String
    /// Whether it can CHANGE anything, as opposed to only read.
    public let writes: Bool

    public init(raw: String, summary: String, writes: Bool) {
        self.raw = raw
        self.summary = summary
        self.writes = writes
    }
}

public struct Connection: Sendable, Equatable, Identifiable {
    public enum Provider: String, CaseIterable, Sendable {
        case gmail
        case calendar

        /// The action that disconnects this provider. Total, so a new provider
        /// must be given one rather than silently becoming undisconnectable.
        public var disconnectAction: SecurityAction {
            switch self {
            case .gmail: return .disconnectGmail
            case .calendar: return .disconnectCalendar
            }
        }
    }

    public let id: String
    public let provider: Provider
    /// Which account, for display. Never a token.
    public let account: String
    public let connected: Bool
    public let scopes: [ConnectorScope]
    public let lastUsed: Date?

    public init(id: String, provider: Provider, account: String, connected: Bool,
                scopes: [ConnectorScope], lastUsed: Date?) {
        self.id = id
        self.provider = provider
        self.account = account
        self.connected = connected
        self.scopes = scopes
        self.lastUsed = lastUsed
    }

    public var writeScopes: [ConnectorScope] { scopes.filter(\.writes) }

    /// Surfaced separately from the scope list because it is the one thing a
    /// person scanning the screen has to see.
    public var hasWriteAccess: Bool { !writeScopes.isEmpty }
}

// MARK: - Remote control

/// What Phases 44 and 45 build, as this screen sees it today.
public struct RemoteControlState: Sendable, Equatable {
    public enum Mode: String, CaseIterable, Sendable {
        case off
        /// Phase 45. Can look, cannot touch.
        case readOnly = "read_only"
        /// Phase 44's fixed verb set.
        case full
    }

    public let mode: Mode
    /// Which transport, for display. Never a token or a webhook URL.
    public let channel: String?
    public let lastCommandAt: Date?

    public init(mode: Mode, channel: String? = nil, lastCommandAt: Date? = nil) {
        self.mode = mode
        self.channel = channel
        self.lastCommandAt = lastCommandAt
    }

    public var isEnabled: Bool { mode != .off }
}

// MARK: - Delegated permissions

/// Something ORION may do on Nick's behalf, until it expires or is revoked.
public struct Delegation: Sendable, Equatable, Identifiable {
    public let id: String
    /// What was delegated, in words.
    public let what: String
    public let grantedAt: Date
    /// Nil means it does not expire on its own, which is exactly the kind that
    /// needs to be visible on this screen.
    public let expiresAt: Date?
    public let revoked: Bool

    public init(id: String, what: String, grantedAt: Date, expiresAt: Date?, revoked: Bool = false) {
        self.id = id
        self.what = what
        self.grantedAt = grantedAt
        self.expiresAt = expiresAt
        self.revoked = revoked
    }

    /// Expiry is evaluated at an INJECTED instant, never at `Date()`. A screen
    /// that decides what is still granted by reading the device clock inside
    /// the logic cannot be tested for the boundary, and the boundary is the
    /// only interesting part.
    public func isActive(at moment: Date) -> Bool {
        if revoked { return false }
        guard let expiry = expiresAt else { return true }
        return moment < expiry
    }
}

// MARK: - Recent security events

/// The audit history, as the phone holds it.
///
/// There is no removal API, deliberately. An audit log the app can edit is not
/// an audit log, and "inspect audit history" is the manifest's word — inspect,
/// not manage. `recent(_:)` bounds what is DISPLAYED and deletes nothing.
public struct SecurityEvent: Sendable, Equatable, Identifiable {
    public enum Kind: String, CaseIterable, Sendable {
        case devicePaired = "device_paired"
        case deviceRevoked = "device_revoked"
        case sessionRevoked = "session_revoked"
        case connectionAdded = "connection_added"
        case connectionRemoved = "connection_removed"
        case profileChanged = "profile_changed"
        case remoteControlChanged = "remote_control_changed"
        case delegationGranted = "delegation_granted"
        case delegationRevoked = "delegation_revoked"
        case orionLocked = "orion_locked"
        case orionUnlocked = "orion_unlocked"
    }

    public let id: String
    public let kind: Kind
    public let at: Date
    /// Display text. Never a credential, and never the contents of what was
    /// accessed — an audit line saying WHAT was read is itself a disclosure.
    public let detail: String

    public init(id: String, kind: Kind, at: Date, detail: String) {
        self.id = id
        self.kind = kind
        self.at = at
        self.detail = detail
    }
}

public struct SecurityEventLog: Sendable, Equatable {
    public private(set) var entries: [SecurityEvent]

    public init(_ entries: [SecurityEvent] = []) {
        self.entries = entries
    }

    /// Append-only, and immutable in the caller's sense: this returns a new log
    /// rather than editing one in place.
    public func appending(_ event: SecurityEvent) -> SecurityEventLog {
        SecurityEventLog(entries + [event])
    }

    /// Newest first, bounded for display. A limit of zero returns nothing
    /// rather than everything, which is the direction a bug should fail in.
    public func recent(_ limit: Int) -> [SecurityEvent] {
        guard limit > 0 else { return [] }
        return Array(entries.sorted { $0.at == $1.at ? $0.id > $1.id : $0.at > $1.at }.prefix(limit))
    }
}

// MARK: - Automation permissions, decoded from the live snapshot

/// The five profiles in `openclaw-plugins/orion-control/src/permissions.ts`.
///
/// Raw values are that file's strings. A sixth profile added there makes the
/// decode below fail and name the unknown string, which is the loud failure the
/// Phase 40 zone table chose for the same reason.
public enum PermissionProfile: String, CaseIterable, Sendable, Codable {
    case restrictedReadOnly = "restricted_read_only"
    case approvedRootEdit = "approved_root_edit"
    case broadLocalFilesystem = "broad_local_filesystem"
    case consequentialLocal = "consequential_local"
    case externalConnected = "external_connected"
}

/// The four gates in `scripts/orion_v2_authority_snapshot.py`.
public enum AuthorityLevel: String, CaseIterable, Sendable, Codable {
    case auto = "AUTO"
    case notify = "NOTIFY"
    case approval = "APPROVAL"
    case never = "NEVER"
}

public struct AuthorityCounts: Sendable, Equatable, Codable {
    public let total: Int
    public let auto: Int
    public let notify: Int
    public let approval: Int
    public let never: Int

    public init(total: Int, auto: Int, notify: Int, approval: Int, never: Int) {
        self.total = total
        self.auto = auto
        self.notify = notify
        self.approval = approval
        self.never = never
    }

    enum CodingKeys: String, CodingKey {
        case total
        case auto = "AUTO"
        case notify = "NOTIFY"
        case approval = "APPROVAL"
        case never = "NEVER"
    }

    /// Every action sits at exactly one gate, so the four must add up.
    ///
    /// Worth checking rather than assuming: a snapshot that does not add up
    /// means an action was counted twice or dropped entirely, and a dropped
    /// action is one nobody is being shown.
    public var isConsistent: Bool { auto + notify + approval + never == total }
}

public struct TierAvailability: Sendable, Equatable, Codable, Identifiable {
    public let tier: String
    /// Nullable, and finding that out is why this test exists.
    ///
    /// The `simulation` tier really does emit `"flag": null` — no configuration
    /// key governs it. A non-optional `String` here decoded every hand-written
    /// fixture and refused the real file on the first run of the contract
    /// check (orion_v2_authority_contract_check.sh), which would have left the
    /// automation panel blank: the most
    /// dangerous possible wrong answer, since a blank permission list reads as
    /// "nothing is allowed".
    public let flag: String?
    public let configOn: Bool
    public let profileOn: Bool
    public let available: Bool
    public let unresolved: Bool

    public init(tier: String, flag: String?, configOn: Bool, profileOn: Bool,
                available: Bool, unresolved: Bool) {
        self.tier = tier
        self.flag = flag
        self.configOn = configOn
        self.profileOn = profileOn
        self.available = available
        self.unresolved = unresolved
    }

    public var id: String { tier }

    /// Available means the config flag AND the profile both allow it. A tier
    /// whose `available` disagrees with that conjunction is a snapshot bug, and
    /// this is what says so.
    public var agreesWithItsInputs: Bool { available == (configOn && profileOn) }

    /// Whether any configuration key can switch this tier off. False for
    /// `simulation`, which is governed by the profile alone. Stated narrowly on
    /// purpose: it does not mean "always on", because the profile still gates it.
    public var isConfigGated: Bool { flag != nil }
}

public struct ExecPolicy: Sendable, Equatable, Codable {
    public let security: String
    public let ask: String
    public let askFallback: String

    public init(security: String, ask: String, askFallback: String) {
        self.security = security
        self.ask = ask
        self.askFallback = askFallback
    }
}

/// `docs/planning/v2/CURRENT_AUTHORITY.json`, as the phone reads it.
public struct AuthoritySnapshot: Sendable, Equatable, Codable {
    public let schemaVersion: Int
    public let profile: PermissionProfile
    public let execPolicy: ExecPolicy
    public let counts: AuthorityCounts
    public let availability: [TierAvailability]

    public init(schemaVersion: Int, profile: PermissionProfile, execPolicy: ExecPolicy,
                counts: AuthorityCounts, availability: [TierAvailability]) {
        self.schemaVersion = schemaVersion
        self.profile = profile
        self.execPolicy = execPolicy
        self.counts = counts
        self.availability = availability
    }

    public static func decode(_ data: Data) throws -> AuthoritySnapshot {
        try JSONDecoder().decode(AuthoritySnapshot.self, from: data)
    }

    public var enabledTiers: [TierAvailability] { availability.filter(\.available) }

    /// Tiers whose availability could not be determined. Shown rather than
    /// hidden: "I do not know whether this is on" is a different answer from
    /// "it is off", and only one of them is safe to skip past.
    public var unresolvedTiers: [TierAvailability] { availability.filter(\.unresolved) }
}

// MARK: - The centre

public struct SecurityCenter: Sendable, Equatable {
    public var controls: SecurityControls
    public var connections: [Connection]
    public var remoteControl: RemoteControlState
    public var delegations: [Delegation]
    /// Nil while the snapshot has not been read. The screen says so rather than
    /// rendering an empty permission list, which would read as "nothing is
    /// allowed" — the most dangerous possible wrong answer here.
    public var authority: AuthoritySnapshot?
    public var events: SecurityEventLog

    public init(controls: SecurityControls = SecurityControls(),
                connections: [Connection] = [],
                remoteControl: RemoteControlState = RemoteControlState(mode: .off),
                delegations: [Delegation] = [],
                authority: AuthoritySnapshot? = nil,
                events: SecurityEventLog = SecurityEventLog()) {
        self.controls = controls
        self.connections = connections
        self.remoteControl = remoteControl
        self.delegations = delegations
        self.authority = authority
        self.events = events
    }

    public func connection(_ provider: Connection.Provider) -> Connection? {
        connections.first { $0.provider == provider }
    }

    public func activeDelegations(at moment: Date) -> [Delegation] {
        delegations.filter { $0.isActive(at: moment) }
    }

    /// Which of the seven to offer right now.
    ///
    /// Offered means there is something for it to act ON — there is no point
    /// showing "disconnect Gmail" when Gmail is not connected. It deliberately
    /// does NOT depend on `controls.lock`: every action here removes authority
    /// or reads, and a lock that stopped you revoking a stolen device would be
    /// exactly backwards. That is asserted, not assumed.
    ///
    /// `inspectAuditHistory` is always offered, including when the log is
    /// empty. An empty audit history is itself information, and hiding the way
    /// to look at it is how somebody concludes nothing happened.
    public func offeredActions(at moment: Date) -> [SecurityAction] {
        var offered: [SecurityAction] = []
        if !controls.devices.active.isEmpty { offered.append(.revokeDevice) }
        if !controls.sessions.isEmpty { offered.append(.revokeSession) }
        if connection(.gmail)?.connected == true { offered.append(.disconnectGmail) }
        if connection(.calendar)?.connected == true { offered.append(.disconnectCalendar) }
        if remoteControl.isEnabled { offered.append(.disableRemoteControl) }
        if !activeDelegations(at: moment).isEmpty { offered.append(.revokeDelegation) }
        offered.append(.inspectAuditHistory)
        return offered
    }
}
