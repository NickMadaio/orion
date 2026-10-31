import Foundation

/// A request that passed every check, rebuilt from validated fields only. What reaches the
/// bridge is serialized from this value, never the raw bytes that arrived on disk.
public struct RelayRequest: Equatable {
    public let id: String
    public let action: String
    public let payload: [String: String]
    public let createdAt: Int64
    public let nonce: String

    /// The single line orion-mac-bridge reads on stdin.
    public func bridgeLine() throws -> Data {
        let object: [String: Any] = ["id": id, "action": action, "payload": payload]
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0A)
        return data
    }
}

public enum RelayRejection: Error, Equatable, CustomStringConvertible {
    case tooLarge
    case malformed
    case badID
    case idMismatch
    case badNonce
    case tooManyKeys
    case badKey(String)
    case valueTooLarge(String)
    case badMAC
    case actionNotAllowed(String)
    case stale
    case fromTheFuture
    case replay

    public var description: String {
        switch self {
        case .tooLarge: return "the request is larger than the relay accepts"
        case .malformed: return "the request is not valid relay JSON"
        case .badID: return "the request id is not a lowercase UUID"
        case .idMismatch: return "the request id does not match its file name"
        case .badNonce: return "the nonce is not 32 hex characters"
        case .tooManyKeys: return "the payload has too many keys"
        case .badKey(let key): return "payload key '\(key.prefix(40))' is not allowed"
        case .valueTooLarge(let key): return "payload value '\(key)' is too large"
        case .badMAC: return "the request signature does not verify"
        case .actionNotAllowed(let action): return "action '\(action.prefix(40))' is not a screen action the relay runs"
        case .stale: return "the request expired before the app picked it up"
        case .fromTheFuture: return "the request's timestamp is in the future"
        case .replay: return "the request's nonce was already used"
        }
    }

    /// Whether the id is trustworthy enough to name a response file after.
    public var canAnswer: Bool {
        switch self {
        case .tooLarge, .malformed, .badID, .idMismatch: return false
        default: return true
        }
    }
}

/// Validates request files. Holds the replay cache, so one instance lives as long as the relay.
/// Not thread-safe by design: the relay processes requests one at a time on one queue.
public final class RelayValidator {
    private let key: () -> Data?
    private let now: () -> Date
    private var seenNonces: [String: Int64] = [:]

    public init(key: @escaping () -> Data?, now: @escaping () -> Date = Date.init) {
        self.key = key
        self.now = now
    }

    private struct Wire: Decodable {
        let id: String
        let action: String
        let payload: [String: String]
        let createdAt: Int64
        let nonce: String
        let mac: String
    }

    /// The id and nonce a request file claims, if the id is safe to name a file after (for a signed refusal).
    public static func claimed(fileStem: String, data: Data) -> (id: String, nonce: String)? {
        guard data.count <= RelayProtocol.Limits.maxRequestBytes,
              let wire = try? JSONDecoder().decode(Wire.self, from: data),
              RelayProtocol.isValidID(wire.id), wire.id == fileStem else { return nil }
        return (wire.id, String(wire.nonce.prefix(64)))
    }

    public func validate(fileStem: String, data: Data) -> Result<RelayRequest, RelayRejection> {
        guard data.count <= RelayProtocol.Limits.maxRequestBytes else { return .failure(.tooLarge) }
        guard let wire = try? JSONDecoder().decode(Wire.self, from: data) else { return .failure(.malformed) }
        guard RelayProtocol.isValidID(wire.id) else { return .failure(.badID) }
        guard wire.id == fileStem else { return .failure(.idMismatch) }
        guard RelayProtocol.matches(RelayProtocol.noncePattern, wire.nonce) else { return .failure(.badNonce) }
        if let rejection = Self.checkPayload(wire.payload) { return .failure(rejection) }
        guard let key = key(), key.count == RelayProtocol.Limits.keyBytes else { return .failure(.badMAC) }
        let canonical = RelayProtocol.canonicalRequest(
            id: wire.id, action: wire.action, createdAt: wire.createdAt, nonce: wire.nonce, payload: wire.payload)
        guard RelayProtocol.verify(key: key, canonical: canonical, presented: wire.mac) else { return .failure(.badMAC) }
        guard RelayProtocol.allowedActions.contains(wire.action) else { return .failure(.actionNotAllowed(wire.action)) }
        let nowMs = Int64((now().timeIntervalSince1970 * 1000).rounded())
        guard wire.createdAt - nowMs <= RelayProtocol.Limits.futureSkewMs else { return .failure(.fromTheFuture) }
        guard nowMs - wire.createdAt <= RelayProtocol.Limits.freshnessMs else { return .failure(.stale) }
        seenNonces = seenNonces.filter { $0.value >= nowMs }
        guard seenNonces[wire.nonce] == nil else { return .failure(.replay) }
        seenNonces[wire.nonce] = wire.createdAt + RelayProtocol.Limits.freshnessMs + RelayProtocol.Limits.futureSkewMs
        return .success(RelayRequest(id: wire.id, action: wire.action, payload: wire.payload, createdAt: wire.createdAt, nonce: wire.nonce))
    }

    static func checkPayload(_ payload: [String: String]) -> RelayRejection? {
        guard payload.count <= RelayProtocol.Limits.maxPayloadKeys else { return .tooManyKeys }
        for (key, value) in payload {
            guard RelayProtocol.matches(RelayProtocol.keyPattern, key),
                  RelayProtocol.allowedPayloadKeys.contains(key) else { return .badKey(key) }
            guard value.utf8.count <= RelayProtocol.Limits.maxValueBytes else { return .valueTooLarge(key) }
        }
        return nil
    }
}
