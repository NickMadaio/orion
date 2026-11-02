import SwiftUI

/*
 The project's model choice: one pill per role. "Default (name)" follows the global role model; picking a model
 pins THIS project to it. A pinned model Ollama no longer has reads "missing", and the run falls back to the default
 and says so in the run log (scripts/orion-agent).
*/

/// Row builders shared by the section and the renders.
enum ProjectModelRows {
    static func items(_ catalog: ProjectModelCatalog?, chosen: String?) -> [ProjectPickItem] {
        var rows = (catalog?.models ?? []).map { info in
            ProjectPickItem(id: info.name, title: info.name, detail: info.sizeLabel, badges: info.badges)
        }
        // A pinned model that is gone stays visible (checked, marked) rather than silently vanishing from the list.
        if let chosen, !rows.contains(where: { $0.id == chosen }), catalog != nil {
            rows.insert(ProjectPickItem(id: chosen, title: chosen, detail: "Not in Ollama any more", missing: true), at: 0)
        }
        return rows
    }
    static func defaultRow(_ name: String?) -> ProjectPickItem {
        ProjectPickItem(id: "", title: "Default", detail: name.map { "Follows the global model · \($0)" } ?? "Follows the global model")
    }
}

struct ProjectModelSection: View {
    @ObservedObject var store: ProjectModelStore

    var body: some View {
        HairlineSection(title: "Models", spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(["worker", "reviewer"], id: \.self) { role in line(role) }
                if let error = store.error {
                    Text(error).font(.system(size: 11.5)).foregroundStyle(OrionTheme.orange)
                }
            }
        }
    }

    private func line(_ role: String) -> some View {
        let resolution = store.resolution(role: role)
        let defaultName = store.catalog?.defaults[role]
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 14) {
                Text(role.uppercased()).font(OrionTheme.mono(9, .semibold)).tracking(2)
                    .foregroundStyle(OrionTheme.textDim).frame(width: 74, alignment: .leading)
                ProjectPickerPill(
                    label: resolution.source == .chosen ? (resolution.chosen ?? "") : resolution.source == .missing ? (resolution.chosen ?? "") : "Default",
                    note: resolution.source == .defaulted ? defaultName.map { "(\($0))" } : resolution.source == .missing ? "missing" : nil,
                    noteHue: resolution.source == .missing ? OrionTheme.orange : OrionTheme.textDim,
                    missing: resolution.source == .missing,
                    defaultRow: ProjectModelRows.defaultRow(defaultName),
                    items: ProjectModelRows.items(store.catalog, chosen: store.models[role]),
                    selection: store.models[role], emptyText: "No models found. Is Ollama running?",
                    onRefresh: { store.refresh() }, refreshing: store.refreshing,
                    onSelect: { store.choose(role: role, model: $0) })
                Button { store.refresh() } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(OrionTheme.textSoft).frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.8))
                        .rotationEffect(.degrees(store.refreshing ? 360 : 0))
                        .animation(store.refreshing ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: store.refreshing)
                }.buttonStyle(.plain).help("Look for newly pulled models")
            }
            if resolution.source == .missing, let chosen = resolution.chosen {
                Text("\(chosen) is no longer in Ollama. Runs use \(resolution.effective ?? "the default") instead and say so in the log.")
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.orange.opacity(0.9)).padding(.leading, 88)
            }
        }
    }
}
