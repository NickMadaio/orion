import Foundation

/// Local secure storage, as a port whose default refuses.
///
/// The same position Phase 12 took with the cipher and Phase 14 with the
/// signature verifier, for the same reason: the Keychain adapter needs an SDK
/// that is not installed here, and a placeholder that silently stores things in
/// memory would be indistinguishable from working until the day it mattered.
public protocol SecureStore: Sendable {
    func store(_ value: Data, forKey key: String) throws
    func read(_ key: String) throws -> Data?
    func remove(_ key: String) throws
}

public enum SecureStorageError: Error, Equatable {
    case unavailable(String)
    case notFound(String)
    case refusedPlaintextFallback
    /// Sign-out could not remove these keys. Named rather than swallowed: a
    /// `throws` method that reports success while removing nothing is worse than
    /// one that does not compile.
    case clearIncomplete([String])
}

/// The default. Raises rather than storing.
public struct RefusingSecureStore: SecureStore {
    public init() {}

    public func store(_ value: Data, forKey key: String) throws {
        throw SecureStorageError.unavailable(
            "no secure store is installed: iOS uses the Keychain with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly"
        )
    }

    public func read(_ key: String) throws -> Data? {
        throw SecureStorageError.unavailable("no secure store is installed")
    }

    public func remove(_ key: String) throws {
        throw SecureStorageError.unavailable("no secure store is installed")
    }
}

/// What the app keeps locally, and what it must never keep.
///
/// The session token is here because the alternative is asking somebody to sign
/// in every time they open the app, which is how people end up choosing a
/// shorter password. The device private key is NOT here: it lives in the Secure
/// Enclave and never becomes `Data` this type could hold.
public enum SecureKey: String, CaseIterable, Sendable {
    case sessionToken = "session_token"
    case refreshToken = "refresh_token"
    case deviceKeyReference = "device_key_reference"
    case pushToken = "push_token"
}

public struct SecureStorage: Sendable {
    private let store: SecureStore

    public init(store: SecureStore = RefusingSecureStore()) {
        self.store = store
    }

    public func save(_ value: String, for key: SecureKey) throws {
        guard let data = value.data(using: .utf8) else {
            throw SecureStorageError.unavailable("value is not utf-8")
        }
        try store.store(data, forKey: key.rawValue)
    }

    public func load(_ key: SecureKey) throws -> String? {
        guard let data = try store.read(key.rawValue) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func clear() throws {
        // Sign-out removes everything, in one call. Removing tokens and leaving
        // the push token behind is how a signed-out phone keeps buzzing.
        //
        // Every removal is attempted before anything is thrown, so one failing
        // key does not strand the rest -- but a failure IS thrown. This method
        // is `throws` and used to swallow every error with `try?`, so against
        // the refusing store this package ships, sign-out was a no-op that
        // reported success. Harmless only while nothing was ever stored; it
        // becomes live the moment a real Keychain adapter lands, which is
        // exactly when nobody re-reads sign-out.
        var failures: [String] = []
        for key in SecureKey.allCases {
            do { try store.remove(key.rawValue) } catch { failures.append(key.rawValue) }
        }
        if !failures.isEmpty { throw SecureStorageError.clearIncomplete(failures) }
    }
}
