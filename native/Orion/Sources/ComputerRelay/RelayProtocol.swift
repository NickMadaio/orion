import CryptoKit
import Foundation

/// The computer relay's wire contract (2026-10-31).
///
/// The gateway's node process has no Accessibility grant; Orion.app does. The plugin
/// (plugin/orion-control/src/computer-relay.ts) drops a signed request file in the relay
/// directory, this app runs orion-mac-bridge as its own child (macOS attributes a child's
/// TCC checks to the responsible app), and writes a signed response file back.
///
/// The canonical byte strings below are a cross-language contract. Both sides are pinned to
/// the same golden vectors (Tests/ComputerRelayTests/Fixtures/golden-vectors.json), produced
/// by a third, independent implementation. Change the format only with a new version prefix.
public enum RelayProtocol {
    public static let requestPrefix = "orion-computer-relay/v1/req\n"
    public static let responsePrefix = "orion-computer-relay/v1/res\n"

    /// The only bridge actions the relay will run. Everything else the bridge offers
    /// (calendar, reminders, notifications, screen_capture, permission prompts) is refused:
    /// the relay must never become a general way to borrow the app's grants.
    public static let allowedActions: Set<String> = [
        "screen_observe", "screen_click", "screen_type", "screen_key", "screen_press",
        "screen_set_value", "screen_menu", "screen_menu_items", "screen_ocr",
    ]

    /// Every payload key the plugin's computer-bridge.ts sends. Unknown keys are refused.
    public static let allowedPayloadKeys: Set<String> = [
        "expected_bundle_id", "path", "role", "label", "ax_action", "value",
        "menu_path", "menu", "key", "text", "x", "y",
    ]

    public enum Limits {
        public static let maxRequestBytes = 64 * 1024
        public static let maxPayloadKeys = 16
        public static let maxValueBytes = 8 * 1024
        public static let maxBridgeOutputBytes = 4 * 1024 * 1024
        public static let freshnessMs: Int64 = 15_000
        public static let futureSkewMs: Int64 = 2_000
        public static let keyBytes = 32
    }

    static func lengthPrefixed(_ value: String) -> String {
        "\(value.utf8.count):\(value)"
    }

    /// Pairs in UTF-8 byte order, so Node (Buffer.compare) and Swift agree for any key.
    static func pairs(_ map: [String: String]) -> String {
        let keys = map.keys.sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
        return keys.reduce(lengthPrefixed(String(keys.count))) { acc, key in
            acc + lengthPrefixed(key) + lengthPrefixed(map[key] ?? "")
        }
    }

    public static func canonicalRequest(id: String, action: String, createdAt: Int64, nonce: String, payload: [String: String]) -> String {
        requestPrefix + lengthPrefixed(id) + lengthPrefixed(action) + lengthPrefixed(String(createdAt))
            + lengthPrefixed(nonce) + pairs(payload)
    }

    public static func canonicalResponse(id: String, nonce: String, ok: Bool, error: String?, result: [String: String]) -> String {
        responsePrefix + lengthPrefixed(id) + lengthPrefixed(nonce) + lengthPrefixed(ok ? "true" : "false")
            + lengthPrefixed(error ?? "") + pairs(result)
    }

    public static func mac(key: Data, canonical: String) -> String {
        let code = HMAC<SHA256>.authenticationCode(for: Data(canonical.utf8), using: SymmetricKey(data: key))
        return Data(code).map { String(format: "%02x", $0) }.joined()
    }

    /// Constant-time comparison of a presented hex MAC against the expected one.
    public static func verify(key: Data, canonical: String, presented: String) -> Bool {
        guard let presentedBytes = Data(hex: presented), presentedBytes.count == 32 else { return false }
        return HMAC<SHA256>.isValidAuthenticationCode(presentedBytes, authenticating: Data(canonical.utf8), using: SymmetricKey(data: key))
    }

    public static let idPattern = try! NSRegularExpression(pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    public static let noncePattern = try! NSRegularExpression(pattern: "^[0-9a-f]{32}$")
    public static let keyPattern = try! NSRegularExpression(pattern: "^[a-z_]{1,40}$")

    static func matches(_ regex: NSRegularExpression, _ value: String) -> Bool {
        regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    public static func isValidID(_ id: String) -> Bool { matches(idPattern, id) }
}

public extension Data {
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2) else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
