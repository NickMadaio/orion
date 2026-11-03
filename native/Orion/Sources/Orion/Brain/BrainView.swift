import AppKit
import SwiftUI

/// The Brain view (wave 17): Nick's whole Obsidian vault as the same living sky. A thin folder key on the left
/// (it doubles as the filter), the graph taking the rest. Hovering a note floats its card; a click opens it in Obsidian.
struct BrainView: View {
    @ObservedObject var brain: BrainStore
    let ring: Namespace.ID
    var snapshot = false

    @Environment(\.knowledgePalette) private var palette

    var body: some View {
        GeometryReader { proxy in
            let narrow = proxy.size.width < 1060
            HStack(alignment: .top, spacing: 0) {
                folderKey.frame(width: narrow ? 176 : 214).padding(.top, 6)
                KnowledgeHairline(vertical: true, peak: 0.12).padding(.vertical, 30).padding(.horizontal, narrow ? 12 : 18)
                ZStack {
                    SkyGraphView(sky: brain.sky, graph: brain.graph, visibleIDs: brain.visibleIDs, selectedID: brain.selectedID,
                                 searchActive: false, onSelect: open, ring: ring, ringInList: false, snapshot: snapshot)
                    if brain.graph.nodes.isEmpty { emptyNote }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var emptyNote: some View {
        Text((brain.loading ? "Reading the vault" : brain.loadError ?? "No notes in the vault yet").uppercased())
            .font(OrionTheme.mono(10, .medium)).tracking(2.4).foregroundStyle(palette.textDim)
    }

    /// A click selects (so its neighbours light), then hands the note to Obsidian. Obsidian only reads from here.
    private func open(_ id: String?) {
        brain.selectedID = id
        guard let id, let url = brain.graph.node(id)?.openURL else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: Folder key

    private var folderKey: some View {
        VStack(alignment: .leading, spacing: 0) {
            KnowledgeSectionLabel(title: "Folders", trailing: brain.hiddenFolders.isEmpty ? nil : "reset")
                .padding(.bottom, 12)
                .onTapGesture { brain.hiddenFolders = [] }
            VStack(alignment: .leading, spacing: 9) {
                ForEach(brain.folders, id: \.name) { folder in row(folder.name, folder.count) }
            }
            Text("Colour is the top folder. Bigger notes have more links. Zoom in to name more of them.")
                .font(.system(size: 11)).foregroundStyle(palette.textDim)
                .fixedSize(horizontal: false, vertical: true).padding(.top, 26)
        }
    }

    private func row(_ name: String, _ count: Int) -> some View {
        let on = !brain.hiddenFolders.contains(name)
        let hue = palette.folderColor(name)
        let title = name == BrainVault.ghostGroup ? "Unresolved links" : name
        return Button { brain.toggle(folder: name) } label: {
            HStack(spacing: 9) {
                Circle().fill(hue.opacity(on ? 0.95 : 0.28)).frame(width: 7, height: 7).shadow(color: hue.opacity(on ? 0.6 : 0), radius: 3)
                Text(title).font(.system(size: 12, weight: on ? .medium : .regular))
                    .foregroundStyle(on ? palette.text : palette.textDim).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(count)").font(OrionTheme.mono(9.5)).foregroundStyle(palette.textDim)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The pill that flips the tab between what ORION knows and the whole vault: a hairline capsule, the chosen half lit.
struct KnowledgeModeSwitch: View {
    @Binding var mode: KnowledgeMode
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var lit

    var body: some View {
        HStack(spacing: 2) {
            ForEach(KnowledgeMode.allCases) { option in
                Button { withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.8)) { mode = option } } label: {
                    Text(option.title.uppercased())
                        .font(OrionTheme.mono(9.5, .semibold)).tracking(1.8)
                        .foregroundStyle(mode == option ? OrionTheme.text : OrionTheme.textDim)
                        .padding(.horizontal, 13).padding(.vertical, 6)
                        .background {
                            if mode == option {
                                Capsule().fill(OrionTheme.accent.opacity(0.12))
                                    .overlay(Capsule().strokeBorder(OrionTheme.accent.opacity(0.6), lineWidth: 0.8))
                                    .shadow(color: OrionTheme.accent.opacity(0.28), radius: 6)
                                    .matchedGeometryEffect(id: "mode.lit", in: lit)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 0.7))
        .accessibilityElement(children: .contain)
    }
}
