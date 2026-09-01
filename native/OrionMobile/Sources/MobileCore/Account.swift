import Foundation

/// Account authentication, as the phone sees it.
///
/// The server half is Phase 13. This is the state machine the UI reads, and it
/// exists so "am I signed in" has one answer rather than being inferred from
/// whether a token happens to be in the Keychain.
public struct AccountSession: Sendable, Equatable {
    public enum State: Sendable, Equatable {
        case signedOut
        case signingIn(method: String)
        case signedIn(userID: String)
        /// The access token expired and a refresh is in flight. The UI stays on
        /// screen: signing somebody out because a ten-minute token lapsed is a
        /// bug that reads as a security feature.
        case refreshing(userID: String)
        case failed(String)
    }

    public private(set) var state: State = .signedOut
    public private(set) var accessExpiresAt: Date?

    public init() {}

    public var userID: String? {
        switch state {
        case .signedIn(let id), .refreshing(let id): return id
        case .signedOut, .signingIn, .failed: return nil
        }
    }

    public var isUsable: Bool {
        if case .signedIn = state { return true }
        return false
    }

    public mutating func beginSignIn(method: String) {
        state = .signingIn(method: method)
    }

    public mutating func signedIn(userID: String, accessExpiresAt: Date) {
        state = .signedIn(userID: userID)
        self.accessExpiresAt = accessExpiresAt
    }

    public mutating func fail(_ reason: String) {
        state = .failed(reason)
        accessExpiresAt = nil
    }

    /// Called when the access token is close to expiry. Returns whether a
    /// refresh should be attempted.
    @discardableResult
    public mutating func needsRefresh(at moment: Date, margin: TimeInterval = 60) -> Bool {
        guard case .signedIn(let id) = state, let expiry = accessExpiresAt else { return false }
        guard moment.addingTimeInterval(margin) >= expiry else { return false }
        state = .refreshing(userID: id)
        return true
    }

    public mutating func signOut() {
        state = .signedOut
        accessExpiresAt = nil
    }
}
