import Foundation

/// Nick's edits to the knowledge graph, in `knowledge-overrides.json`.
///
/// The script applies these on every rebuild (scripts/lib/knowledge/overrides.mjs) and this applies them on load, so
/// an edit shows the instant he makes it rather than at the next rebuild. Two implementations of one rule set is
/// the drift this codebase is written against; it is tolerated here only because both test suites read the same
/// fixture trio in tests/fixtures/knowledge/overrides and must produce the same graph from it.
///
/// Value type: every edit returns a new set of overrides.
struct KnowledgeOverrides: Codable, Equatable {
    struct NodeEdit: Codable, Equatable {
        var label: String?
        var hidden: Bool?
        var deleted: Bool?
        var note: String?
        var mergeInto: String?
    }

    struct EdgeEdit: Codable, Equatable {
        var reason: String?
        var hidden: Bool?
        var deleted: Bool?
        var note: String?
    }

    var schema = "orion.knowledge-overrides.v1"
    var updatedAt: String?
    var nodes: [String: NodeEdit] = [:]
    var edges: [String: EdgeEdit] = [:]

    init() {}

    private enum CodingKeys: String, CodingKey { case schema, updatedAt, nodes, edges }

    /// A malformed file is no overrides, never a crash and never a reason to drop the graph.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = (try? c.decodeIfPresent(String.self, forKey: .schema)) ?? "orion.knowledge-overrides.v1"
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
        nodes = ((try? c.decodeIfPresent([String: NodeEdit].self, forKey: .nodes)) ?? nil) ?? [:]
        edges = ((try? c.decodeIfPresent([String: EdgeEdit].self, forKey: .edges)) ?? nil) ?? [:]
    }

    // MARK: Edits

    private func withNode(_ id: String, _ change: (inout NodeEdit) -> Void) -> KnowledgeOverrides {
        var next = self
        var edit = nodes[id] ?? NodeEdit()
        change(&edit)
        next.nodes[id] = edit
        return next
    }

    private func withEdge(_ id: String, _ change: (inout EdgeEdit) -> Void) -> KnowledgeOverrides {
        var next = self
        var edit = edges[id] ?? EdgeEdit()
        change(&edit)
        next.edges[id] = edit
        return next
    }

    private static func trimmed(_ text: String) -> String? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    func renaming(_ id: String, to label: String) -> KnowledgeOverrides { withNode(id) { $0.label = Self.trimmed(label) } }
    func hiding(_ id: String) -> KnowledgeOverrides { withNode(id) { $0.hidden = true } }
    func unhiding(_ id: String) -> KnowledgeOverrides { withNode(id) { $0.hidden = nil } }
    func deleting(_ id: String) -> KnowledgeOverrides { withNode(id) { $0.deleted = true } }
    func noting(_ id: String, _ note: String) -> KnowledgeOverrides { withNode(id) { $0.note = Self.trimmed(note) } }
    func merging(_ id: String, into target: String) -> KnowledgeOverrides {
        guard id != target else { return self }
        return withNode(id) { $0.mergeInto = target }
    }
    func hidingEdge(_ id: String) -> KnowledgeOverrides { withEdge(id) { $0.hidden = true } }
    func deletingEdge(_ id: String) -> KnowledgeOverrides { withEdge(id) { $0.deleted = true } }
    func notingEdge(_ id: String, _ note: String) -> KnowledgeOverrides { withEdge(id) { $0.note = Self.trimmed(note) } }

    // MARK: Apply — mirrors applyOverrides in scripts/lib/knowledge/overrides.mjs

    func applied(to graph: KnowledgeGraph) -> KnowledgeGraph {
        let ids = Set(graph.nodes.map(\.id))
        let targetOf = Dictionary(graph.nodes.map { ($0.id, resolveMerge($0.id, ids: ids)) }, uniquingKeysWith: { a, _ in a })
        let deleted = Set(graph.nodes.filter { nodes[$0.id]?.deleted == true }.map(\.id))
        let merged = mergeNodes(graph.nodes, targetOf: targetOf)
            .filter { !deleted.contains($0.id) }
            .map { edited($0, nodes[$0.id]) }
        let live = Set(merged.map(\.id))
        let edgeList = remapEdges(graph.edges, targetOf: targetOf)
            .filter { live.contains($0.from) && live.contains($0.to) }
            .filter { edges[$0.id]?.deleted != true }
            .map { edited($0, edges[$0.id]) }
        var result = graph
        result.nodes = merged
        result.edges = edgeList
        return result
    }

    private func resolveMerge(_ id: String, ids: Set<String>) -> String {
        var seen: Set<String> = [id]
        var current = id
        for _ in 0..<16 {
            guard let next = nodes[current]?.mergeInto, ids.contains(next) else { return current }
            if seen.contains(next) { return id }
            seen.insert(next)
            current = next
        }
        return id
    }

    private func mergeNodes(_ list: [KnowledgeNode], targetOf: [String: String]) -> [KnowledgeNode] {
        list.compactMap { node in
            guard targetOf[node.id] == node.id else { return nil }
            let absorbed = list.filter { $0.id != node.id && targetOf[$0.id] == node.id }
            guard !absorbed.isEmpty else { return node }
            var next = node
            let names = (node.aliases ?? []) + absorbed.flatMap { [$0.label] + ($0.aliases ?? []) }
            next.aliases = Array(Set(names)).filter { !$0.isEmpty && $0 != node.label }.sorted()
            next.facts = absorbed.flatMap(\.facts).reduce(node.facts) { acc, fact in
                acc.contains { $0.text == fact.text } ? acc : acc + [fact]
            }
            next.sources = absorbed.flatMap(\.sources).reduce(node.sources) { acc, source in
                acc.contains(source) ? acc : acc + [source]
            }
            return next
        }
    }

    private func remapEdges(_ list: [KnowledgeEdge], targetOf: [String: String]) -> [KnowledgeEdge] {
        struct Moved { let edge: KnowledgeEdge; let index: Int; let remapped: Bool }
        let moved = list.enumerated().compactMap { index, edge -> Moved? in
            let from = targetOf[edge.from] ?? edge.from, to = targetOf[edge.to] ?? edge.to
            guard from != to else { return nil }
            var next = edge
            next.from = from; next.to = to
            next.id = KnowledgeEdge.makeId(from: from, to: to, kind: edge.kind)
            return Moved(edge: next, index: index, remapped: from != edge.from || to != edge.to)
        }
        var kept: [String: Moved] = [:]
        for item in moved {
            if let prior = kept[item.edge.id], !(prior.remapped && !item.remapped) { continue }
            kept[item.edge.id] = item
        }
        return kept.values.sorted { ($0.edge.id, $0.index) < ($1.edge.id, $1.index) }.map(\.edge)
    }

    private func edited(_ node: KnowledgeNode, _ edit: NodeEdit?) -> KnowledgeNode {
        guard let edit else { return node }
        var next = node
        if let label = edit.label.flatMap(Self.trimmed) { next.label = label }
        if edit.hidden == true { next.hidden = true }
        if let note = edit.note.flatMap(Self.trimmed) { next.note = note }
        return next
    }

    private func edited(_ edge: KnowledgeEdge, _ edit: EdgeEdit?) -> KnowledgeEdge {
        guard let edit else { return edge }
        var next = edge
        if let reason = edit.reason.flatMap(Self.trimmed) { next.reason = reason }
        if edit.hidden == true { next.hidden = true }
        if let note = edit.note.flatMap(Self.trimmed) { next.note = note }
        return next
    }
}
