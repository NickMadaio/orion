import SwiftUI

/// The right column. With nothing selected: one large number and where it came from. With a node selected: what
/// ORION knows about it, where each fact came from, what it connects to, and his edits.
struct KnowledgeDetail: View {
    @ObservedObject var store: KnowledgeStore
    var snapshot = false

    @Environment(\.knowledgePalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let node = store.selected {
                KnowledgeNodeDetail(store: store, node: node, snapshot: snapshot).id(node.id)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(x: 14)))
            } else {
                overview.transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : OrionMotion.page, value: store.selectedID)
    }

    // MARK: Overview

    private var known: [KnowledgeNode] { store.graph.nodes.filter { !$0.isSelf && $0.hidden != true } }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(known.count)")
                .font(OrionTheme.display(76, .light)).monospacedDigit()
                .foregroundStyle(palette.text)
                .contentTransition(.numericText())
            Text("THINGS ORION KNOWS ABOUT \(selfName.uppercased())")
                .font(OrionTheme.mono(9, .semibold)).tracking(2.2).foregroundStyle(palette.textDim)
                .padding(.bottom, 10)
            Text("\(store.graph.edges.filter { $0.hidden != true }.count) connections, each with the line it came from.")
                .font(.system(size: 12.5)).foregroundStyle(palette.textSoft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 30)
            largest.padding(.bottom, 30)
            KnowledgeSectionLabel(title: "Read from", trailing: generated).padding(.bottom, 10)
            sources
            if let error = store.loadError {
                Text(error).font(.system(size: 11.5)).foregroundStyle(OrionTheme.orange.opacity(0.9)).padding(.top, 14)
            }
            if store.canRebuild {
                Button(store.rebuilding ? "REBUILDING…" : "REBUILD") { store.rebuild() }
                    .buttonStyle(OutlineButtonStyle(tint: palette.isDark ? OrionTheme.accent : palette.color(.person)))
                    .disabled(store.rebuilding)
                    .padding(.top, 18)
            }
        }
    }

    private var selfName: String { store.graph.node("person:self")?.label ?? "you" }

    private var generated: String? {
        guard let at = store.graph.generatedAt, at.count >= 16 else { return nil }
        return String(at.prefix(10))
    }

    /// The biggest kinds, as a short typographic ladder — colour carries the kind, size stays quiet.
    private var largest: some View {
        let groups = Dictionary(grouping: known, by: \.kind).map { ($0.key, $0.value.count) }
            .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0.rawValue < $1.0.rawValue }
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(groups.prefix(5)), id: \.0) { type, count in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(count)").font(OrionTheme.mono(13, .medium)).foregroundStyle(palette.color(type)).frame(width: 28, alignment: .trailing)
                    Text(type.title.lowercased()).font(.system(size: 12.5)).foregroundStyle(palette.textSoft)
                }
            }
        }
    }

    /// One sentence for what was read; a line each only for what was not (or was read from a cache).
    private var sources: some View {
        let read = store.graph.sources.filter(\.ok)
        let notable = store.graph.sources.filter { !$0.ok || ($0.id == "calendar" && $0.note?.hasPrefix("live") == false) }
        return VStack(alignment: .leading, spacing: 5) {
            Text("\(read.count) of \(store.graph.sources.count) sources read — notes, places, routines, calendar, focus and health.")
                .font(.system(size: 12)).foregroundStyle(palette.textSoft).fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)
            ForEach(notable, id: \.id) { row in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Circle().fill(row.ok ? palette.color(.place).opacity(0.8) : palette.textDim.opacity(0.5)).frame(width: 4, height: 4)
                    Text(row.file.split(separator: "/").last.map(String.init) ?? row.file)
                        .font(OrionTheme.mono(10)).foregroundStyle(row.ok ? palette.textSoft : palette.textDim).lineLimit(1)
                    Spacer(minLength: 4)
                    if row.id == "calendar", row.note?.hasPrefix("live") == false {
                        Text("cached").font(OrionTheme.mono(9)).foregroundStyle(palette.textDim)
                    } else if !row.ok {
                        Text("missing").font(OrionTheme.mono(9)).foregroundStyle(palette.textDim)
                    }
                }
            }
        }
    }
}
