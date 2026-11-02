import SwiftUI

/// One node: its facts with their citations, its connections, and his edits (rename, note, merge, hide, delete).
struct KnowledgeNodeDetail: View {
    @ObservedObject var store: KnowledgeStore
    let node: KnowledgeNode
    var snapshot = false

    @Environment(\.knowledgePalette) private var palette
    @State private var editing: Field?
    @State private var draft = ""
    @State private var confirmDelete = false

    private enum Field { case rename, note }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(.bottom, 22)
            if let note = node.note { noteLine(note).padding(.bottom, 20) }
            if editing != nil { editor.padding(.bottom, 22) }
            if !node.facts.isEmpty {
                KnowledgeSectionLabel(title: "What it knows").padding(.bottom, 10)
                facts.padding(.bottom, 24)
            }
            let links = store.graph.connections(of: node.id)
            if !links.isEmpty {
                KnowledgeSectionLabel(title: "Connected to", trailing: "\(links.count)").padding(.bottom, 10)
                connections(links).padding(.bottom, 24)
            }
            if !node.isSelf { actions }
        }
    }

    // MARK: Header

    private var tint: Color { palette.color(node.kind) }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Circle().strokeBorder(tint, lineWidth: 1).frame(width: 8, height: 8)
                Text(node.isSelf ? "YOU" : node.kind.singular.uppercased())
                    .font(OrionTheme.mono(9, .semibold)).tracking(2.2).foregroundStyle(tint)
                if node.hidden == true {
                    Text("· HIDDEN").font(OrionTheme.mono(9, .semibold)).tracking(2.2).foregroundStyle(palette.textDim)
                }
            }
            Text(node.label)
                .font(OrionTheme.display(30, .semibold)).foregroundStyle(palette.text)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle = node.subtitle {
                Text(subtitle).font(.system(size: 13)).foregroundStyle(palette.textSoft)
            }
            if let aliases = node.aliases, !aliases.isEmpty {
                Text("also “\(aliases.joined(separator: "”, “"))”").font(.system(size: 11.5)).foregroundStyle(palette.textDim)
            }
        }
    }

    private func noteLine(_ note: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle().fill(tint.opacity(0.7)).frame(width: 1)
            VStack(alignment: .leading, spacing: 3) {
                Text("HIS NOTE").font(OrionTheme.mono(8.5, .semibold)).tracking(1.8).foregroundStyle(palette.textDim)
                Text(note).font(.system(size: 12.5)).italic().foregroundStyle(palette.textSoft).fixedSize(horizontal: false, vertical: true)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Facts and connections

    private var facts: some View {
        VStack(alignment: .leading, spacing: 11) {
            ForEach(Array(node.facts.prefix(8).enumerated()), id: \.offset) { _, fact in
                VStack(alignment: .leading, spacing: 3) {
                    Text(fact.text).font(.system(size: 12.5)).foregroundStyle(palette.textSoft)
                        .lineLimit(4).fixedSize(horizontal: false, vertical: true)
                    if let source = fact.source {
                        Text(source.short).font(OrionTheme.mono(9)).foregroundStyle(palette.textDim)
                    }
                }
            }
        }
    }

    private func connections(_ links: [KnowledgeConnection]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(links.prefix(9)) { link in
                Button { select(link.other.id) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(palette.color(link.other.kind)).frame(width: 5, height: 5).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(link.other.label).font(.system(size: 12.5, weight: .medium)).foregroundStyle(palette.text).lineLimit(1)
                            Text(link.edge.reason).font(.system(size: 11)).foregroundStyle(palette.textDim).lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                            if let source = link.edge.source {
                                Text(source.short).font(OrionTheme.mono(8.5)).foregroundStyle(palette.textDim.opacity(0.8))
                            }
                        }
                    }
                    .opacity(link.edge.hidden == true ? 0.45 : 1)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Hide this connection") { store.hideEdge(link.edge.id) }
                    Button("Delete this connection", role: .destructive) { store.deleteEdge(link.edge.id) }
                }
            }
            if links.count > 9 {
                Text("and \(links.count - 9) more").font(OrionTheme.mono(9)).foregroundStyle(palette.textDim)
            }
        }
    }

    private func select(_ id: String) {
        withAnimation(OrionMotion.select) { store.selectedID = id }
    }

    // MARK: Edits

    private var actions: some View {
        KnowledgeFlow(spacing: 6, lineSpacing: 6) {
            action("Rename") { begin(.rename, with: node.label) }
            action("Note") { begin(.note, with: node.note ?? "") }
            mergeMenu
            if node.hidden == true { action("Unhide") { store.unhide(node.id) } } else { action("Hide") { store.hide(node.id) } }
            action(confirmDelete ? "Really delete" : "Delete", tint: OrionTheme.red) {
                if confirmDelete { store.delete(node.id) } else { confirmDelete = true }
            }
        }
    }

    private func action(_ title: String, tint: Color? = nil, run: @escaping () -> Void) -> some View {
        KnowledgeActionPill(title: title, tint: tint, action: run)
    }

    @ViewBuilder private var mergeMenu: some View {
        let targets = store.mergeTargets(for: node.id)
        if snapshot || targets.isEmpty {
            KnowledgePillLabel(title: "Merge", dimmed: targets.isEmpty)
        } else {
            Menu {
                ForEach(targets) { target in Button(target.label) { store.merge(node.id, into: target.id) } }
            } label: {
                KnowledgePillLabel(title: "Merge")
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
    }

    private func begin(_ field: Field, with text: String) {
        draft = text
        withAnimation(OrionMotion.select) { editing = field }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(editing == .rename ? "Name" : "A note for ORION", text: $draft, axis: .vertical)
                .textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(palette.text)
                .onSubmit(save)
            KnowledgeHairline(peak: 0.4)
            HStack(spacing: 8) {
                action("Save", tint: palette.color(node.kind), run: save)
                action("Cancel") { editing = nil }
            }
        }
        .transition(.opacity.combined(with: .offset(y: -6)))
    }

    private func save() {
        switch editing {
        case .rename: store.rename(node.id, to: draft)
        case .note: store.note(node.id, draft)
        case nil: break
        }
        editing = nil
    }
}
