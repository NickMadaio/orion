import SwiftUI

/// The left column: search, the ten types as a legend that filters, and every node as a plain list.
/// No boxes: grouping is spacing, type scale and a fading rule.
struct KnowledgeIndex: View {
    @ObservedObject var store: KnowledgeStore
    let ring: Namespace.ID
    @Binding var ringInList: Bool
    var snapshot = false

    @Environment(\.knowledgePalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            search.padding(.bottom, 26)
            KnowledgeSectionLabel(title: "Kinds", trailing: allOn ? nil : "all").padding(.bottom, 10)
                .onTapGesture { store.query.types = Set(KnowledgeNodeType.allCases) }
            legend.padding(.bottom, 28)
            KnowledgeSectionLabel(title: "Everything", trailing: "\(store.visibleNodes.count)").padding(.bottom, 8)
            Group {
                if snapshot { list.frame(minHeight: 0, maxHeight: .infinity, alignment: .top).clipped() }
                else { ScrollView(.vertical, showsIndicators: false) { list } }
            }
            // The list dissolves at its foot instead of stopping at an edge.
            .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.86), .init(color: .clear, location: 1)],
                                 startPoint: .top, endPoint: .bottom))
            if hiddenCount > 0 { hiddenToggle.padding(.top, 12) }
        }
    }

    private var allOn: Bool { store.query.types.count == KnowledgeNodeType.allCases.count }
    private var hiddenCount: Int { store.graph.nodes.filter { $0.hidden == true }.count }

    // MARK: Search

    private var search: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 11, weight: .semibold)).foregroundStyle(palette.textDim)
                if snapshot {
                    Text(store.query.text.isEmpty ? "Search what ORION knows" : store.query.text)
                        .font(.system(size: 13)).foregroundStyle(store.query.text.isEmpty ? palette.textDim : palette.text).lineLimit(1)
                } else {
                    TextField("Search what ORION knows", text: $store.query.text)
                        .textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(palette.text).lineLimit(1)
                }
            }
            KnowledgeHairline(peak: store.query.text.isEmpty ? 0.16 : 0.4)
        }
    }

    // MARK: Legend

    private var legend: some View {
        // He counts among the people: "People 0" next to his own name read as if ORION knew no one.
        let counts = Dictionary(grouping: store.graph.nodes.filter { $0.hidden != true }, by: \.kind).mapValues(\.count)
        return VStack(alignment: .leading, spacing: 7) {
            ForEach(KnowledgeNodeType.allCases) { type in
                let on = store.query.types.contains(type)
                Button { toggle(type) } label: {
                    HStack(spacing: 9) {
                        ZStack {
                            Circle().strokeBorder(palette.color(type).opacity(on ? 0.9 : 0.4), lineWidth: 1)
                            Circle().fill(palette.color(type)).padding(2.5).opacity(on ? 1 : 0)
                        }
                        .frame(width: 9, height: 9)
                        Text(type.title).font(.system(size: 12, weight: on ? .medium : .regular)).foregroundStyle(on ? palette.textSoft : palette.textDim)
                        Spacer(minLength: 8)
                        Text("\(counts[type] ?? 0)").font(OrionTheme.mono(10)).foregroundStyle(palette.textDim)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity((counts[type] ?? 0) == 0 ? 0.45 : 1)
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: store.query.types)
    }

    /// One click shows only that kind; a second click on a lone kind brings everything back.
    private func toggle(_ type: KnowledgeNodeType) {
        let all = Set(KnowledgeNodeType.allCases)
        let next: Set<KnowledgeNodeType>
        if store.query.types == [type] { next = all }
        else if store.query.types == all { next = [type] }
        else if store.query.types.contains(type) { next = store.query.types.subtracting([type]).isEmpty ? all : store.query.types.subtracting([type]) }
        else { next = store.query.types.union([type]) }
        store.query.types = next
    }

    // MARK: List

    @ViewBuilder private var list: some View {
        // Lazy only where it scrolls: ImageRenderer draws nothing of a LazyVStack outside a ScrollView.
        if snapshot {
            VStack(alignment: .leading, spacing: 0) { ForEach(store.visibleNodes) { node in row(node) } }.padding(.trailing, 6)
        } else {
            LazyVStack(alignment: .leading, spacing: 0) { ForEach(store.visibleNodes) { node in row(node) } }.padding(.trailing, 6)
        }
    }

    private func row(_ node: KnowledgeNode) -> some View {
        let selected = store.selectedID == node.id
        let tint = palette.color(node.kind)
        return Button { pick(node.id) } label: {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(tint.opacity(node.hidden == true ? 0.35 : 0.9)).frame(width: 5, height: 5)
                    if selected && ringInList {
                        Circle().stroke(tint, lineWidth: 1.2).frame(width: 13, height: 13)
                            .matchedGeometryEffect(id: "knowledge.ring", in: ring)
                    }
                }
                .frame(width: 13, height: 13)
                VStack(alignment: .leading, spacing: 1) {
                    Text(node.label).font(.system(size: 12.5, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? palette.text : palette.textSoft).lineLimit(1)
                    if let subtitle = node.subtitle, selected || !store.query.text.isEmpty {
                        Text(subtitle).font(.system(size: 10.5)).foregroundStyle(palette.textDim).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 5)
            .offset(x: selected ? 4 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : OrionMotion.select, value: selected)
    }

    /// Selecting from the list: the ring appears on the row, then flies to the node in the graph.
    private func pick(_ id: String) {
        guard !reduceMotion else { store.selectedID = id; ringInList = false; return }
        ringInList = true
        store.selectedID = id
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
            withAnimation(OrionMotion.select) { ringInList = false }
        }
    }

    private var hiddenToggle: some View {
        Button { store.query.showHidden.toggle() } label: {
            Text(store.query.showHidden ? "Hide the \(hiddenCount) hidden" : "Show \(hiddenCount) hidden")
                .font(OrionTheme.mono(9, .medium)).tracking(1.2).foregroundStyle(palette.textDim)
        }
        .buttonStyle(.plain)
    }
}
