import SwiftUI

/// The Knowledge tab's round pieces (wave 14, the "circles and bubbles" pass): pill chips that filter by kind, a
/// wrapping flow to hold them, a small outline pill for actions, and a ring meter for a kind's share. All outline and
/// light, no filled plates, in the palette's ink so they read in light mode too.

/// Lays children left to right and wraps, like words: the chips take only the width they need.
struct KnowledgeFlow: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 7

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: min(width, proposal.width ?? width), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for (index, size) in row.items {
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var items: [(Int, CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for (index, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            let next = row.items.isEmpty ? size.width : row.width + spacing + size.width
            if next > width, !row.items.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append((index, size))
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}

/// One kind as a pill bubble: a small orb in its hue, the name, the count. On, it glows softly in its hue; off, it
/// is a hairline outline with dim type.
struct KnowledgeKindChip: View {
    let type: KnowledgeNodeType
    let count: Int
    let on: Bool
    let action: () -> Void

    @Environment(\.knowledgePalette) private var palette
    @State private var hovering = false

    var body: some View {
        let hue = palette.color(type)
        Button(action: action) {
            HStack(spacing: 6) {
                Circle()
                    .fill(RadialGradient(colors: [palette.isDark ? .white.opacity(on ? 0.9 : 0.35) : hue, hue.opacity(on ? 0.9 : 0.4)],
                                         center: UnitPoint(x: 0.35, y: 0.32), startRadius: 0, endRadius: 4.5))
                    .frame(width: 7, height: 7)
                    .shadow(color: hue.opacity(on ? 0.7 : 0), radius: 3)
                Text(type.title).font(.system(size: 11.5, weight: on ? .medium : .regular))
                    .foregroundStyle(on ? palette.text : palette.textDim)
                Text("\(count)").font(OrionTheme.mono(9.5)).foregroundStyle(on ? palette.textSoft : palette.textDim)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(hue.opacity(on ? (hovering ? 0.14 : 0.09) : (hovering ? 0.05 : 0))))
            .overlay(Capsule().strokeBorder(on ? hue.opacity(hovering ? 0.8 : 0.55) : palette.hairline.opacity(hovering ? 0.3 : 0.14), lineWidth: 0.8))
            .shadow(color: hue.opacity(on ? 0.22 : 0), radius: 6)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .opacity(count == 0 ? 0.45 : 1)
        .accessibilityLabel("\(type.title), \(count)")
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }
}

/// A small outline pill for the detail column's actions (rename, note, hide, delete).
struct KnowledgeActionPill: View {
    let title: String
    var tint: Color?
    let action: () -> Void

    @Environment(\.knowledgePalette) private var palette
    @State private var hovering = false

    var body: some View {
        Button(action: action) { KnowledgePillLabel(title: title, tint: tint, hovering: hovering) }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
    }
}

/// The pill's face, shared with the merge menu's label.
struct KnowledgePillLabel: View {
    let title: String
    var tint: Color?
    var hovering = false
    var dimmed = false

    @Environment(\.knowledgePalette) private var palette

    var body: some View {
        let ink = tint ?? palette.textSoft
        Text(title.uppercased()).font(OrionTheme.mono(8.5, .semibold)).tracking(1.4)
            .foregroundStyle(ink.opacity(dimmed ? 0.4 : 1))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .overlay(Capsule().strokeBorder((tint ?? palette.hairline).opacity(hovering ? 0.6 : (tint == nil ? 0.2 : 0.4)), lineWidth: 0.8))
            .contentShape(Capsule())
    }
}

/// A kind's share as a thin ring meter: a faint track and an arc in its hue, drawn in from the top.
struct KnowledgeShareRing: View {
    let share: Double
    let hue: Color
    var diameter: CGFloat = 22
    /// Off for renders: ImageRenderer has no onAppear, so the arc must start full.
    var drawsIn = true

    @Environment(\.knowledgePalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn: Double?

    private var shown: Double { drawn ?? (drawsIn ? 0 : Self.clamp(share)) }
    private static func clamp(_ v: Double) -> Double { min(1, max(0.02, v)) }

    var body: some View {
        ZStack {
            Circle().stroke(palette.hairline.opacity(0.1), lineWidth: 1.6)
            Circle().trim(from: 0, to: shown)
                .stroke(hue, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: hue.opacity(0.5), radius: 2.5)
        }
        .frame(width: diameter, height: diameter)
        .onAppear { reveal(share) }
        .onChange(of: share) { _, next in reveal(next) }
    }

    private func reveal(_ value: Double) {
        let target = Self.clamp(value)
        if reduceMotion || !drawsIn { drawn = target; return }
        withAnimation(.spring(response: 0.9, dampingFraction: 0.85)) { drawn = target }
    }
}
