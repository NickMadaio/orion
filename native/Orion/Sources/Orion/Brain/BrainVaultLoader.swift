import Foundation

/// Reads the vault off the main thread and remembers what it read. Per file the cache is keyed by modification time
/// and size, so a reload re-reads only notes that changed; when no file changed at all, the finished graph is
/// returned as it stands. Read-only: nothing here ever writes to the vault.
final class BrainVaultLoader: @unchecked Sendable {
    private struct Stamp: Equatable { let modified: Date; let size: Int }

    private let lock = NSLock()
    private var cache: [String: (stamp: Stamp, note: BrainNote)] = [:]
    private var lastSignature: [String: Stamp]?
    private var lastRoot: URL?
    private var lastGraph: KnowledgeGraph = .empty
    /// How many files the last load actually read (the rest came from the cache); tests watch this.
    private(set) var filesRead = 0

    func load(root: URL) -> KnowledgeGraph {
        lock.lock(); defer { lock.unlock() }
        let files = Self.markdownFiles(under: root)
        let signature = files.mapValues(\.stamp)
        if signature == lastSignature, root == lastRoot { filesRead = 0; return lastGraph }
        var next: [String: (stamp: Stamp, note: BrainNote)] = [:]
        var read = 0
        for (path, file) in files {
            if let hit = cache[path], hit.stamp == file.stamp { next[path] = hit; continue }
            guard let text = try? String(contentsOf: file.url, encoding: .utf8) else { continue }
            next[path] = (file.stamp, BrainVault.parse(path: path, text: text))
            read += 1
        }
        cache = next
        filesRead = read
        lastRoot = root
        lastSignature = signature
        lastGraph = BrainVault.graph(from: next.values.map(\.note), vaultName: root.lastPathComponent)
        return lastGraph
    }

    private static func markdownFiles(under root: URL) -> [String: (url: URL, stamp: Stamp)] {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys,
                                                          options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [:] }
        let base = root.resolvingSymlinksInPath().path
        var out: [String: (url: URL, stamp: Stamp)] = [:]
        for case let url as URL in walker where url.pathExtension.lowercased() == "md" {
            guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { continue }
            let full = url.resolvingSymlinksInPath().path
            guard full.hasPrefix(base + "/") else { continue }
            let relative = String(full.dropFirst(base.count + 1).dropLast(3))
            out[relative] = (url, Stamp(modified: values.contentModificationDate ?? .distantPast, size: values.fileSize ?? 0))
        }
        return out
    }
}
