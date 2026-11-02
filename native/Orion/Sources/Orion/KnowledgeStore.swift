import Foundation
import SwiftUI

/// What the Knowledge tab is showing: search text, the types switched on, and whether hidden nodes are listed.
struct KnowledgeQuery: Equatable {
    var text: String = ""
    var types: Set<KnowledgeNodeType> = Set(KnowledgeNodeType.allCases)
    var showHidden = false

    func matches(_ node: KnowledgeNode) -> Bool {
        guard types.contains(node.kind) || node.isSelf else { return false }
        guard showHidden || node.hidden != true else { return false }
        let needle = text.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return true }
        let haystack = [node.label, node.subtitle ?? "", node.note ?? ""] + (node.aliases ?? []) + node.facts.map(\.text)
        return haystack.contains { $0.lowercased().contains(needle) }
    }

    /// The nodes a list shows. Him only when nothing narrower is asked for.
    func visibleNodes(in graph: KnowledgeGraph) -> [KnowledgeNode] {
        let narrowed = !text.trimmingCharacters(in: .whitespaces).isEmpty || types.count < KnowledgeNodeType.allCases.count
        return graph.nodes.filter { matches($0) && !(narrowed && $0.isSelf) }
    }
}

/// Loads the graph and his overrides, applies them, and turns his edits into overrides on disk.
///
/// Reads `knowledge-graph.json` (written by `orion-knowledge`); writes only `knowledge-overrides.json`. After an
/// edit it asks the installed script to rebuild, so the file catches up with what the screen already shows.
@MainActor
final class KnowledgeStore: ObservableObject {
    @Published private(set) var graph: KnowledgeGraph = .empty
    @Published private(set) var overrides = KnowledgeOverrides()
    @Published private(set) var loadError: String?
    @Published private(set) var rebuilding = false
    @Published var query = KnowledgeQuery()
    @Published var selectedID: String?
    /// The graph's living model: layout, camera, blends. Deliberately not published (it changes every frame and is
    /// drawn by a Canvas that reads it directly). It lives here because the dashboard owns this store across tab
    /// switches, so the graph keeps its shape and camera and never replays its entrance.
    let sky = KnowledgeSky()

    private var raw: KnowledgeGraph = .empty
    private let directory: URL?
    private let rebuildCommand: [String]?

    nonisolated static var defaultDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled")
    }

    /// `directory` nil is a preview or a render: nothing is read from or written to disk.
    init(directory: URL? = KnowledgeStore.defaultDirectory, rebuildCommand: [String]? = KnowledgeStore.installedRebuild()) {
        self.directory = directory
        self.rebuildCommand = rebuildCommand
    }

    /// A store over a fixed graph (previews, renders, tests).
    convenience init(graph: KnowledgeGraph, overrides: KnowledgeOverrides = KnowledgeOverrides()) {
        self.init(directory: nil, rebuildCommand: nil)
        raw = graph
        self.overrides = overrides
        self.graph = overrides.applied(to: graph)
    }

    nonisolated static func installedRebuild() -> [String]? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let node = home + "/.openclaw/tools/node-v24.15.0/bin/node"
        let script = home + "/.openclaw/orion-remote/scripts/orion-knowledge"
        guard FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: script) else { return nil }
        return [node, script]
    }

    var selected: KnowledgeNode? { selectedID.flatMap(graph.node) }
    var visibleNodes: [KnowledgeNode] { query.visibleNodes(in: graph) }
    var canRebuild: Bool { rebuildCommand != nil }

    // MARK: Disk

    func load() {
        guard let directory else { return }
        let decoder = JSONDecoder()
        do {
            let data = try Data(contentsOf: directory.appendingPathComponent("knowledge-graph.json"))
            raw = try decoder.decode(KnowledgeGraph.self, from: data)
            loadError = nil
        } catch {
            raw = .empty
            loadError = canRebuild ? "No knowledge graph yet — rebuild to make one." : "No knowledge graph yet. Run scripts/orion-knowledge."
        }
        if let data = try? Data(contentsOf: directory.appendingPathComponent("knowledge-overrides.json")),
           let decoded = try? decoder.decode(KnowledgeOverrides.self, from: data) {
            overrides = decoded
        }
        graph = overrides.applied(to: raw)
        if let id = selectedID, graph.node(id) == nil { selectedID = nil }
    }

    private func save() {
        guard let directory else { return }
        var stamped = overrides
        stamped.updatedAt = ISO8601DateFormatter().string(from: Date())
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try encoder.encode(stamped).write(to: directory.appendingPathComponent("knowledge-overrides.json"), options: .atomic)
        } catch {
            OrionLog.write("[knowledge] could not save overrides: \(error.localizedDescription)")
            loadError = "Couldn't save that edit."
        }
    }

    func rebuild() {
        guard let command = rebuildCommand, !rebuilding else { return }
        rebuilding = true
        DispatchQueue.global(qos: .utility).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: command[0])
            process.arguments = Array(command.dropFirst())
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            let ok = (try? process.run()) != nil
            if ok { process.waitUntilExit() }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.rebuilding = false
                if !ok || process.terminationStatus != 0 { OrionLog.write("[knowledge] rebuild failed") }
                self.load()
            }
        }
    }

    // MARK: Edits — each one is an override, saved, applied at once, then rebuilt behind the screen

    private func commit(_ next: KnowledgeOverrides, raw changedRaw: KnowledgeGraph? = nil) {
        if let changedRaw { raw = changedRaw }
        overrides = next
        graph = next.applied(to: raw)
        if let id = selectedID, graph.node(id) == nil { selectedID = nil }
        save()
        rebuild()
    }

    func rename(_ id: String, to label: String) { commit(overrides.renaming(id, to: label)) }
    func note(_ id: String, _ text: String) { commit(overrides.noting(id, text)) }
    func hide(_ id: String) { commit(overrides.hiding(id)) }
    func delete(_ id: String) { commit(overrides.deleting(id)) }
    func merge(_ id: String, into target: String) {
        commit(overrides.merging(id, into: target))
        selectedID = target
    }
    func hideEdge(_ id: String) { commit(overrides.hidingEdge(id)) }
    func deleteEdge(_ id: String) { commit(overrides.deletingEdge(id)) }

    /// The script already applied "hidden" to the file it wrote, so unhiding clears it there too.
    func unhide(_ id: String) {
        var changed = raw
        changed.nodes = raw.nodes.map { node in
            guard node.id == id else { return node }
            var next = node
            next.hidden = nil
            return next
        }
        commit(overrides.unhiding(id), raw: changed)
    }

    /// Same-type nodes he could merge this one into.
    func mergeTargets(for id: String) -> [KnowledgeNode] {
        guard let node = graph.node(id) else { return [] }
        return graph.nodes.filter { $0.type == node.type && $0.id != id }.sorted { $0.label < $1.label }
    }
}
