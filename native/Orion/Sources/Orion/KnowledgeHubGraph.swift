import Foundation

/// The hub layout (wave 17): a view-only rewrite of the graph the sky draws. Nearly every node used to link straight
/// to him, a starburst of crossing lines. Now there is one virtual hub per kind present: he links to each hub, each
/// thing links to its hub, and the direct links from him are no longer drawn (the hub implies them). The real
/// cross-links between things are kept untouched.
///
/// Nothing is written anywhere: the data files, recall and memory never see a hub. The store keeps the real graph.
enum KnowledgeHubGraph {
    static let prefix = "hub:"
    static let edgeKind = "hub"

    static func hubID(_ kind: KnowledgeNodeType) -> String { prefix + kind.rawValue }

    static func build(_ graph: KnowledgeGraph) -> KnowledgeGraph {
        let things = graph.nodes.filter { !$0.isSelf && !$0.isHub }
        guard !things.isEmpty else { return graph }
        let byKind = Dictionary(grouping: things, by: \.kind)
        let kinds = KnowledgeNodeType.allCases.filter { byKind[$0] != nil }
        let hubs = kinds.map { hub($0, members: byKind[$0] ?? []) }
        let me = graph.nodes.first(where: \.isSelf)?.id
        let kept = graph.edges.filter { edge in
            guard let me else { return true }
            return edge.from != me && edge.to != me
        }
        let toHubs = me.map { me in
            kinds.map { KnowledgeEdge(from: me, to: hubID($0), kind: edgeKind, reason: "\($0.title) hub") }
        } ?? []
        let toMembers = things.map { thing in
            KnowledgeEdge(from: hubID(thing.kind), to: thing.id, kind: edgeKind, reason: "in \(thing.kind.title)")
        }
        return KnowledgeGraph(nodes: graph.nodes.filter(\.isSelf) + hubs + things, edges: toHubs + toMembers + kept,
                              sources: graph.sources, generatedAt: graph.generatedAt)
    }

    /// The hub's card reads as a roll call: the first few names, then how many more.
    private static func hub(_ kind: KnowledgeNodeType, members: [KnowledgeNode]) -> KnowledgeNode {
        let shown = members.filter { $0.hidden != true }
        let names = shown.prefix(4).map(\.label).joined(separator: ", ")
        let more = shown.count > 4 ? " and \(shown.count - 4) more" : ""
        return KnowledgeNode(id: hubID(kind), type: kind.rawValue, label: kind.title,
                             subtitle: shown.isEmpty ? nil : names + more, badge: shown.count)
    }

    /// The hub the view puts a thing under.
    static func hubID(of node: KnowledgeNode) -> String { hubID(node.kind) }
}
