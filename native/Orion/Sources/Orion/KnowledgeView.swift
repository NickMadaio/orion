import SwiftUI

/// The Knowledge tab (2026-10-30): what ORION knows about Nick and his Mac, as a graph he can explore and edit.
///
/// Three unequal columns and no boxes: a narrow index (search, the kinds, everything as a list), the graph taking
/// what is left, and a reading column that starts lower than the other two. Grouping is spacing, type scale and
/// hairlines that fade; the window behind stays real alpha through to the desktop — nothing here paints a plate.
///
/// The data is `knowledge-graph.json` from `scripts/orion-knowledge`; his edits go to `knowledge-overrides.json`
/// (`KnowledgeStore`). `snapshot` swaps the live controls (text field, scroll view, menu) for static stand-ins and
/// settles the layout at once, so `ImageRenderer` can draw it.
struct KnowledgeView: View {
    @ObservedObject var store: KnowledgeStore
    var availableHeight: CGFloat = 720
    var snapshot = false
    /// Renders only: the first frame of a selection made from the list, ring still on the row.
    var snapshotRingInList = false

    @StateObject private var simulation = KnowledgeSimulation()
    @Namespace private var ring
    @State private var ringInList = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { proxy in
            // A narrow window gives the graph the space: the side columns tighten before it does.
            let narrow = proxy.size.width < 1060
            HStack(alignment: .top, spacing: 0) {
                KnowledgeIndex(store: store, ring: ring, ringInList: snapshot ? .constant(snapshotRingInList) : $ringInList, snapshot: snapshot)
                    .frame(width: narrow ? 176 : 214)
                    .padding(.top, 6)
                KnowledgeHairline(vertical: true, peak: 0.12).padding(.vertical, 30).padding(.horizontal, narrow ? 12 : 18)
                KnowledgeGraphCanvas(store: store, simulation: simulation, ring: ring, ringInList: snapshot ? snapshotRingInList : ringInList, snapshot: snapshot)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                KnowledgeHairline(vertical: true, peak: 0.12).padding(.top, 70).padding(.bottom, 30).padding(.horizontal, narrow ? 12 : 18)
                detailColumn
                    .frame(width: narrow ? 236 : 286, alignment: .topLeading)
                    .padding(.top, 46)
            }
        }
        .frame(height: max(420, availableHeight))
        .environment(\.knowledgePalette, KnowledgePalette(scheme: scheme))
        .onAppear { store.load() }
        .onExitCommand { store.selectedID = nil }
    }

    @ViewBuilder private var detailColumn: some View {
        if snapshot {
            KnowledgeDetail(store: store, snapshot: true)
        } else {
            ScrollView(.vertical, showsIndicators: false) {
                KnowledgeDetail(store: store).padding(.bottom, 30)
            }
        }
    }
}
