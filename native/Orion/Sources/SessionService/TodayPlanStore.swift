import Foundation
import CryptoKit
import Darwin
import MobileCore

public struct TodayPlanDocument: Codable, Equatable {
    public var schemaVersion = 1
    public var revision = 0
    public var current: TodayPlan?
    public var undo: TodayPlan?
    public var hasUndo = false
    public var receipts: [Receipt] = []
    public struct Receipt: Codable, Equatable {
        let id: String
        let fingerprint: String
    }
    public init() {}
}

/// One atomic revision includes its undo and replay receipts. A kernel lock
/// releases on process death; no timeout can steal it from an active writer.
public final class TodayPlanStore {
    public let url: URL
    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw/orion-controlled/today-plan.json")
    }
    public init(url: URL = TodayPlanStore.defaultURL) { self.url = url }

    public func load() throws -> TodayPlanDocument {
        guard FileManager.default.fileExists(atPath: url.path) else { return TodayPlanDocument() }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular,
                  (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 8 * 1024 * 1024 else { throw TodayPlanError.corruptStore }
            let document = try JSONDecoder().decode(TodayPlanDocument.self, from: Data(contentsOf: url))
            guard document.schemaVersion == 1, document.revision >= 0, document.revision < Int.max,
                  document.receipts.count <= 256,
                  Set(document.receipts.map(\.id)).count == document.receipts.count else { throw TodayPlanError.corruptStore }
            try document.current?.validate()
            try document.undo?.validate()
            return document
        } catch { throw TodayPlanError.corruptStore }
    }

    public func accept(_ proposal: TodayPlan, expectedRevision: Int, operationID: UUID) throws -> TodayPlanDocument {
        try proposal.validate()
        return try mutate(expectedRevision: expectedRevision, operationID: operationID,
                          payload: encoded(proposal), action: "accept") { document in
            document.undo = document.current
            document.hasUndo = true
            document.current = proposal
        }
    }

    public func undo(expectedRevision: Int, operationID: UUID) throws -> TodayPlanDocument {
        try mutate(expectedRevision: expectedRevision, operationID: operationID, payload: Data(), action: "undo") { document in
            guard document.hasUndo else { throw TodayPlanError.nothingToUndo }
            document.current = document.undo
            document.undo = nil
            document.hasUndo = false
        }
    }

    private func mutate(expectedRevision: Int, operationID: UUID, payload: Data, action: String,
                        update: (inout TodayPlanDocument) throws -> Void) throws -> TodayPlanDocument {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let lock = open(url.path + ".lock", O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard lock >= 0 else { throw TodayPlanError.corruptStore }
        defer { close(lock) }
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while flock(lock, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK, ProcessInfo.processInfo.systemUptime < deadline else { throw TodayPlanError.revisionConflict }
            usleep(10_000)
        }
        defer { flock(lock, LOCK_UN) }
        var document = try load()
        let fingerprint = Self.fingerprint(Data("\(action):\(expectedRevision):".utf8) + payload)
        if let receipt = document.receipts.first(where: { $0.id == operationID.uuidString }) {
            guard receipt.fingerprint == fingerprint else { throw TodayPlanError.replayMismatch }
            return document
        }
        guard document.revision == expectedRevision, document.revision < Int.max - 1 else { throw TodayPlanError.revisionConflict }
        try update(&document)
        document.revision += 1
        document.receipts.append(.init(id: operationID.uuidString, fingerprint: fingerprint))
        document.receipts = Array(document.receipts.suffix(256))
        try save(document)
        return document
    }

    private func save(_ document: TodayPlanDocument) throws {
        let data = try encoded(document)
        guard data.count <= 8 * 1024 * 1024 else { throw TodayPlanError.invalidInput }
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".today-plan-\(UUID().uuidString).tmp")
        let fd = open(temporary.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw TodayPlanError.corruptStore }
        defer { close(fd); unlink(temporary.path) }
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), data.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw TodayPlanError.corruptStore }
                offset += count
            }
        }
        guard fsync(fd) == 0, rename(temporary.path, url.path) == 0 else { throw TodayPlanError.corruptStore }
        // Persist the rename itself, as well as the new file's content.
        let directory = open(url.deletingLastPathComponent().path, O_RDONLY)
        if directory >= 0 { defer { close(directory) }; _ = fsync(directory) }
    }

    private func encoded<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
    public static func fingerprint(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}
