import SwiftUI

/// ORION's knowledge as the graph tab draws it (wave 17: the hub layout). The store keeps the real graph; this
/// wrapper hands the sky `KnowledgeHubGraph.build` of it, so he links to one hub per kind and each thing to its hub.
/// All drawing and input is `SkyGraphView`, shared with the Brain view.
struct KnowledgeGraphCanvas: View {
    @ObservedObject var store: KnowledgeStore
    let ring: Namespace.ID
    let ringInList: Bool
    var snapshot = false
    /// Renders only: the instant the snapshot is drawn.
    var snapshotDate = Date()

    private var searchActive: Bool { !store.query.text.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SkyGraphView(sky: store.sky, graph: KnowledgeHubGraph.build(store.graph), visibleIDs: visibleIDs,
                     selectedID: store.selectedID, searchActive: searchActive,
                     onSelect: { store.selectedID = $0 }, ring: ring, ringInList: ringInList,
                     snapshot: snapshot, snapshotDate: snapshotDate)
    }

    /// The nodes the index's filters leave on the canvas: him always, hidden ones only when asked for. A hub shows
    /// while its kind is on and at least one of its things does, so switching a kind off takes its hub with it.
    private var visibleIDs: Set<String> {
        let shown = Set(store.query.visibleNodes(in: store.graph).map(\.id) + ["person:self"])
        let things = store.graph.nodes.filter { shown.contains($0.id) && ($0.hidden != true || store.query.showHidden) }
        let hubs = Set(things.filter { !$0.isSelf && store.query.types.contains($0.kind) }.map { KnowledgeHubGraph.hubID(of: $0) })
        return Set(things.map(\.id)).union(hubs)
    }
}
