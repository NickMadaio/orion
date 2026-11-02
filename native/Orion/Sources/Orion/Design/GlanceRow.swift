import SwiftUI

/// One stat in a glance row: a dim mono caps label, a brighter mono value, and optionally somewhere to go.
struct GlanceStat: Identifiable {
    let label: String
    let value: String
    var tint: Color? = nil
    var action: (() -> Void)? = nil
    var id: String { label }
}

/// The quiet row of numbers under a page's headline, after Home's glance row: mono, no boxes, a fading vertical
/// hairline between items. A stat with an action is a link; one without is just text.
struct GlanceRow: View {
    let stats: [GlanceStat]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(stats.enumerated()), id: \.element.id) { index, stat in
                if index > 0 { separator }
                GlanceStatView(stat: stat)
            }
        }
        .fixedSize()
    }

    private var separator: some View {
        Rectangle()
            .fill(LinearGradient(colors: [.clear, Color.white.opacity(0.22), .clear], startPoint: .top, endPoint: .bottom))
            .frame(width: 1, height: 16)
            .padding(.horizontal, 20)
    }
}

private struct GlanceStatView: View {
    let stat: GlanceStat
    @State private var hovering = false

    var body: some View {
        if let action = stat.action {
            Button(action: action) { content.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .animation(OrionMotion.hover, value: hovering)
        } else {
            content
        }
    }

    private var content: some View {
        HStack(spacing: 9) {
            Text(stat.label.uppercased())
                .font(OrionTheme.mono(9, .semibold))
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(hovering ? 0.62 : 0.36))
            Text(stat.value)
                .font(OrionTheme.mono(10.5))
                .foregroundStyle((stat.tint ?? .white).opacity(hovering ? 0.95 : 0.72))
        }
    }
}
