import Foundation

/// The shared mouse contract (w18): ~/.openclaw/orion-controlled/mouse/{devices,bindings}.json.
/// Pure Codable value types; the JSON shape is read by orion-mouse (plugin), so key names are load-bearing.

public enum MouseSetupState: String, Codable, Equatable {
    case new, asked, declined, configured
}

public struct MouseDevice: Codable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var vendorId: Int
    public var productId: Int
    public var transport: String
    public var buttonCount: Int
    public var extraButtons: [Int]
    public var firstSeen: String
    public var lastSeen: String
    public var connected: Bool
    public var setupState: MouseSetupState

    public init(id: String, name: String, vendorId: Int, productId: Int, transport: String, buttonCount: Int,
                extraButtons: [Int], firstSeen: String, lastSeen: String, connected: Bool, setupState: MouseSetupState) {
        self.id = id; self.name = name; self.vendorId = vendorId; self.productId = productId
        self.transport = transport; self.buttonCount = buttonCount; self.extraButtons = extraButtons
        self.firstSeen = firstSeen; self.lastSeen = lastSeen; self.connected = connected; self.setupState = setupState
    }
}

public struct DevicesFile: Codable, Equatable {
    public var version: Int = 1
    public var devices: [MouseDevice] = []
    public init(devices: [MouseDevice] = []) { self.devices = devices }
}

public enum MouseAction: Equatable, Hashable {
    case system(String)
    case shortcut(String)
    case openApp(String)
    case orion(String)
    case passthrough

    public static let systemNames = ["missionControl", "appExpose", "stageManager", "showDesktop", "launchpad",
                                     "desktopLeft", "desktopRight", "notificationCenter"]
    public static let orionCommands = ["summon", "talk", "dashboard"]
}

extension MouseAction: Codable {
    private enum Key: String, CodingKey { case kind, name, keys, bundleId, command }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "system": self = .system(try c.decode(String.self, forKey: .name))
        case "shortcut": self = .shortcut(try c.decode(String.self, forKey: .keys))
        case "openApp": self = .openApp(try c.decode(String.self, forKey: .bundleId))
        case "orion": self = .orion(try c.decode(String.self, forKey: .command))
        case "passthrough": self = .passthrough
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        switch self {
        case .system(let n): try c.encode("system", forKey: .kind); try c.encode(n, forKey: .name)
        case .shortcut(let k): try c.encode("shortcut", forKey: .kind); try c.encode(k, forKey: .keys)
        case .openApp(let b): try c.encode("openApp", forKey: .kind); try c.encode(b, forKey: .bundleId)
        case .orion(let cmd): try c.encode("orion", forKey: .kind); try c.encode(cmd, forKey: .command)
        case .passthrough: try c.encode("passthrough", forKey: .kind)
        }
    }
}

public struct BindingsFile: Codable, Equatable {
    public var version: Int = 1
    public var enabled: Bool = true
    public var `default`: [String: MouseAction] = [:]
    public var apps: [String: [String: MouseAction]] = [:]
    public var passthroughApps: [String] = []
    public var autoPassthroughGames: Bool = true

    public init() {}

    private enum CodingKeys: String, CodingKey { case version, enabled, `default`, apps, passthroughApps, autoPassthroughGames }

    /// Tolerant decode: a hand- or chat-written file may omit any field.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? true
        `default` = (try? c.decode([String: MouseAction].self, forKey: .default)) ?? [:]
        apps = (try? c.decode([String: [String: MouseAction]].self, forKey: .apps)) ?? [:]
        passthroughApps = (try? c.decode([String].self, forKey: .passthroughApps)) ?? []
        autoPassthroughGames = (try? c.decode(Bool.self, forKey: .autoPassthroughGames)) ?? true
    }

    public func settingDefault(_ button: Int, _ action: MouseAction?) -> BindingsFile {
        var next = self
        next.default[String(button)] = action
        return next
    }

    public func settingApp(_ bundleId: String, button: Int, _ action: MouseAction?) -> BindingsFile {
        var next = self
        var map = next.apps[bundleId] ?? [:]
        map[String(button)] = action
        if map.isEmpty { next.apps[bundleId] = nil } else { next.apps[bundleId] = map }
        return next
    }

    public func togglingPassthrough(_ bundleId: String) -> BindingsFile {
        var next = self
        if next.passthroughApps.contains(bundleId) { next.passthroughApps.removeAll { $0 == bundleId } }
        else { next.passthroughApps.append(bundleId) }
        return next
    }
}

public enum MouseCodec {
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try e.encode(value)
    }
    public static func decodeBindings(_ data: Data) -> BindingsFile {
        (try? JSONDecoder().decode(BindingsFile.self, from: data)) ?? BindingsFile()
    }
    public static func decodeDevices(_ data: Data) -> DevicesFile {
        (try? JSONDecoder().decode(DevicesFile.self, from: data)) ?? DevicesFile()
    }
}
