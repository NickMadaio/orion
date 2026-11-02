import SwiftUI

/*
 The dashboard's navigation row, split out of DashboardView (wave 12).

 Two fixes live here. The items now take their text's width: each used to carry a greedy full-width underline
 `Capsule`, so the HStack handed every item an equal share of the window and the trailing Spacer got one too.
 That is what spread the live tabs evenly across the whole width like an equal grid, although the code said
 "left-aligned". `fixedSize` makes the row pack to the left as designed.

 And each item reports where its centre is, as a fraction of the row's width, so a page can grow from the item
 that opened it (see PageTransition.swift).
*/

/// Where each tab's centre sits, as a fraction (0…1) of the nav row's width.
struct NavCentersKey: PreferenceKey {
    static let defaultValue: [DashboardTab: CGFloat] = [:]
    static func reduce(value: inout [DashboardTab: CGFloat], nextValue: () -> [DashboardTab: CGFloat]) {
        value.merge(nextValue()) { _, new in new }
    }
}

struct DashboardNavBar: View {
    let selected: DashboardTab
    let namespace: Namespace.ID
    let onSelect: (DashboardTab) -> Void

    private static let space = "orion.dashboard.nav"

    var body: some View {
        GeometryReader { row in
            HStack(spacing: 30) {
                ForEach(DashboardTab.allCases) { tab in
                    NavItem(tab: tab, isSelected: selected == tab, namespace: namespace) { onSelect(tab) }
                        .background(GeometryReader { item in
                            Color.clear.preference(
                                key: NavCentersKey.self,
                                value: [tab: item.frame(in: .named(Self.space)).midX / max(1, row.size.width)])
                        })
                }
                Spacer(minLength: 0)
            }
            .coordinateSpace(name: Self.space)
        }
        .frame(height: 30)
        .padding(.horizontal, 46)
        .padding(.bottom, 2)
        .overlay(alignment: .bottom) { FadingRule() }
    }
}

struct NavItem: View {
    let tab: DashboardTab
    let isSelected: Bool
    let namespace: Namespace.ID
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: tab.icon)
                        .font(.system(size: 11, weight: .semibold))
                    Text(tab.title)
                        .font(.system(size: 12, weight: isSelected ? .semibold : .medium))
                }
                .foregroundStyle(tint)

                // The underline is one view that moves between tabs, not one
                // per tab being shown and hidden.
                ZStack {
                    // Hover previews where the underline would go: a faint
                    // hairline that grows from the centre, so pointing at a tab
                    // answers "is this clickable" before the click.
                    Capsule()
                        .fill(OrionTheme.textSoft.opacity(0.35))
                        .frame(height: 1)
                        .scaleEffect(x: hovering && !isSelected ? 1 : 0.2, anchor: .center)
                        .opacity(hovering && !isSelected ? 1 : 0)
                    if isSelected {
                        Capsule()
                            .fill(OrionTheme.accent)
                            .frame(height: 2)
                            .matchedGeometryEffect(id: "nav.underline", in: namespace)
                            .shadow(color: OrionTheme.accent.opacity(0.7), radius: 5)
                    }
                }
                .frame(height: 2)
            }
            .padding(.top, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Text width, not an equal share of the row (see the header comment).
        .fixedSize(horizontal: true, vertical: false)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
    }

    private var tint: Color {
        if isSelected { return OrionTheme.text }
        return hovering ? OrionTheme.textSoft : OrionTheme.textDim
    }
}
