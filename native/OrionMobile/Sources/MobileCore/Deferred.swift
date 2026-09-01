import Foundation

/// What this phase must NOT contain, and who owns each.
///
/// The manifest was explicit at Phase 16: no Gmail, no HealthKit, no remote Mac
/// control yet. A "not yet" that lives only in a plan document is a "not yet"
/// until somebody is in a hurry, so the list is here and `MobileCoreCheck` greps
/// the sources for it.
///
/// **Phase 30 released HealthKit, which is what this list is for.** The way the
/// other two get released by accident is a phase editing two separate lists and
/// getting one right, so `forbiddenTokens` is now DERIVED from `features`: a
/// feature carries the tokens that identify it, removing the feature removes
/// them together, and a feature that is still deferred cannot have lost its
/// tokens.
public struct DeferredFeature: Sendable, Equatable {
    public let name: String
    public let owningPhase: Int
    public let reason: String
    /// The strings that identify this feature in source. Deliberately the API
    /// names and not just the product name: `HKHealthStore` is HealthKit
    /// whatever the surrounding comment calls it.
    public let tokens: [String]

    public init(name: String, owningPhase: Int, reason: String, tokens: [String]) {
        self.name = name
        self.owningPhase = owningPhase
        self.reason = reason
        self.tokens = tokens
    }
}

public enum Deferred {
    public static let features: [DeferredFeature] = [
        DeferredFeature(
            name: "Gmail",
            owningPhase: 26,
            reason: "Mail needs the connector, the vault and the action inbox before a phone should touch it.",
            tokens: ["GmailAPI", "gmail.readonly", "MailMessage"]
        ),
        DeferredFeature(
            name: "remote Mac control",
            owningPhase: 44,
            reason: "The policy engine still denies every request whose target is not its origin.",
            tokens: ["RemoteMacControl", "remoteExecute", "MacRemote"]
        ),
    ]

    /// Features released by a phase that has since closed, kept so that the
    /// list records a decision rather than losing an entry. HealthKit's tokens
    /// are absent from `forbiddenTokens` BECAUSE it appears here.
    public static let released: [DeferredFeature] = [
        DeferredFeature(
            name: "HealthKit",
            owningPhase: 30,
            reason: "Released by Phase 30, which owns it. Health.swift defines the local port; no source imports HealthKit.",
            tokens: ["HealthKit", "HKHealthStore", "HKQuery"]
        ),
    ]

    /// Tokens a source file must not contain. Derived, never hand-maintained.
    public static var forbiddenTokens: [String] {
        features.flatMap(\.tokens)
    }
}
