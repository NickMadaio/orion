import Foundation

/// Reads and writes the contract files (tmp + rename). The directory is injected; the app passes
/// ORION_CONTROLLED_DIR or ~/.openclaw/orion-controlled.
public struct MouseStore {
    public let directory: URL
    public init(controlledDir: URL) { directory = controlledDir.appendingPathComponent("mouse", isDirectory: true) }

    public static func defaultControlledDir() -> URL {
        if let env = ProcessInfo.processInfo.environment["ORION_CONTROLLED_DIR"], !env.isEmpty { return URL(fileURLWithPath: env) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled")
    }

    public var devicesURL: URL { directory.appendingPathComponent("devices.json") }
    public var bindingsURL: URL { directory.appendingPathComponent("bindings.json") }

    public func loadDevices() -> DevicesFile { (try? Data(contentsOf: devicesURL)).map(MouseCodec.decodeDevices) ?? DevicesFile() }
    public func loadBindings() -> BindingsFile { (try? Data(contentsOf: bindingsURL)).map(MouseCodec.decodeBindings) ?? BindingsFile() }

    /// Re-reads before applying the change, so the other writer's edit is not lost.
    @discardableResult
    public func updateBindings(_ change: (BindingsFile) -> BindingsFile) throws -> BindingsFile {
        let next = change(loadBindings())
        try write(MouseCodec.encode(next), to: bindingsURL)
        return next
    }

    @discardableResult
    public func updateDevices(_ change: (DevicesFile) -> DevicesFile) throws -> DevicesFile {
        let next = change(loadDevices())
        try write(MouseCodec.encode(next), to: devicesURL)
        return next
    }

    private func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let tmp = directory.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        try data.write(to: tmp)
        if FileManager.default.fileExists(atPath: url.path) {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
        } else {
            try FileManager.default.moveItem(at: tmp, to: url)
        }
    }
}
