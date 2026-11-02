import SwiftUI

/*
 The window's header (wave 12 U4 redesign, 2026-11-02): the ORION wordmark with its small glowing orb at the left,
 a few quiet text links and a gear at the right. It replaces the row of eight tabs and the dense status strip.

   · The wordmark is Home.
   · Plan, Knowledge and Health are first-class links; Projects, Finances and Brand sit in "More", with the two
     session previews that used to be a "TEMPORARY PREVIEW" row under the Home composer.
   · The gear is Settings.
   · The status strip is gone. One small capsule appears only when something is wrong (gateway down, overdue
     items, the phone link offline) and is absent otherwise.

 Each item still reports where its centre is, as a fraction of the header's width, so a page grows from the item
 that opened it (PageTransition.swift).
*/

/// Where each tab's centre sits, as a fraction (0…1) of the header's width.
struct NavCentersKey: PreferenceKey {
    static let defaultValue: [DashboardTab: CGFloat] = [:]
    static func reduce(value: inout [DashboardTab: CGFloat], nextValue: () -> [DashboardTab: CGFloat]) {
        value.merge(nextValue()) { _, new in new }
    }
}

extension DashboardTab {
    /// Always visible in the header.
    static let primaryLinks: [DashboardTab] = [.tasks, .knowledge, .health]
    /// In the "More" menu.
    static let moreLinks: [DashboardTab] = [.project, .finance, .brand]
}

struct DashboardHeader: View {
    let selected: DashboardTab
    let issues: [HomeStatus.Issue]
    let onSelect: (DashboardTab) -> Void
    var onPreviewFocus: () -> Void = {}
    var onPreviewBreak: () -> Void = {}
    var onDismiss: () -> Void = {}

    private static let space = "orion.dashboard.header"

    var body: some View {
        GeometryReader { row in
            HStack(alignment: .center, spacing: 0) {
                Button { onSelect(.home) } label: { OrionWordmark(lit: selected == .home) }
                    .buttonStyle(.plain)
                    .help("Home")
                    .reportCenter(for: [.home], in: Self.space, width: row.size.width)

                Spacer(minLength: 24)

                if !issues.isEmpty {
                    HomeStatusCapsule(issues: issues)
                        .padding(.trailing, 30)
                        .transition(.opacity)
                }

                HStack(spacing: 30) {
                    ForEach(DashboardTab.primaryLinks) { tab in
                        HeaderLink(title: tab.title, isSelected: selected == tab) { onSelect(tab) }
                            .reportCenter(for: [tab], in: Self.space, width: row.size.width)
                    }
                    moreMenu
                        .reportCenter(for: DashboardTab.moreLinks, in: Self.space, width: row.size.width)
                    HeaderIcon(systemName: "gearshape", isSelected: selected == .settings, help: "Settings") { onSelect(.settings) }
                        .reportCenter(for: [.settings], in: Self.space, width: row.size.width)
                }

                HeaderIcon(systemName: "xmark", isSelected: false, help: "Close", size: 11, action: onDismiss)
                    .padding(.leading, 18)
            }
            .frame(height: row.size.height)
            .coordinateSpace(name: Self.space)
        }
        .frame(height: 44)
        .padding(.horizontal, 46)
        .padding(.top, 18)
        .padding(.bottom, 8)
        .animation(OrionMotion.fade, value: issues)
    }

    private var moreMenu: some View {
        MoreLink(selected: selected, onSelect: onSelect, onPreviewFocus: onPreviewFocus, onPreviewBreak: onPreviewBreak)
    }
}

/// "More": the secondary sections and the session previews, in a small popover. A plain button rather than a
/// `Menu`, so it draws in the same quiet type as the links beside it (and in renders, where a Menu is a placeholder).
private struct MoreLink: View {
    let selected: DashboardTab
    let onSelect: (DashboardTab) -> Void
    let onPreviewFocus: () -> Void
    let onPreviewBreak: () -> Void

    @State private var open = false
    @State private var hovering = false

    private var isSelected: Bool { DashboardTab.moreLinks.contains(selected) }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                if isSelected { SelectedDot() }
                Text(isSelected ? selected.title : "More")
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold)).opacity(0.7)
            }
            .font(.system(size: 13.5, weight: .medium))
            .foregroundStyle(isSelected ? OrionTheme.text : Color.white.opacity(hovering || open ? 0.88 : 0.62))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .onHover { hovering = $0 }
        .help("Projects, Finances, Brand")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(DashboardTab.moreLinks) { tab in
                    row(tab.title, icon: tab.icon, lit: tab == selected) { onSelect(tab) }
                }
                Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1).padding(.vertical, 6)
                Text("PREVIEW").font(OrionTheme.mono(8.5, .semibold)).tracking(2).foregroundStyle(OrionTheme.textDim)
                    .padding(.horizontal, 10).padding(.bottom, 2)
                row("Focus screen", icon: "scope", lit: false, action: onPreviewFocus)
                row("Break", icon: "leaf", lit: false, action: onPreviewBreak)
            }
            .padding(10)
            .frame(width: 200)
        }
    }

    private func row(_ title: String, icon: String, lit: Bool, action: @escaping () -> Void) -> some View {
        Button {
            open = false
            action()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 11)).frame(width: 16).foregroundStyle(lit ? OrionTheme.accent : OrionTheme.textSoft)
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(lit ? OrionTheme.text : Color.white.opacity(0.8))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pieces

/// The small glowing orb and the wordmark.
struct OrionWordmark: View {
    var lit = true

    var body: some View {
        HStack(spacing: 11) {
            ZStack {
                Circle()
                    .strokeBorder(OrionTheme.accent.opacity(0.35), lineWidth: 1)
                    .frame(width: 22, height: 22)
                Circle()
                    .fill(RadialGradient(colors: [Color.white, OrionTheme.accent, OrionTheme.accent.opacity(0)],
                                         center: .center, startRadius: 0, endRadius: 7))
                    .frame(width: 12, height: 12)
                    .shadow(color: OrionTheme.accent.opacity(lit ? 0.85 : 0.5), radius: 6)
            }
            Text("ORION")
                .font(.system(size: 15, weight: .semibold))
                .tracking(4.5)
                .foregroundStyle(Color.white.opacity(0.92))
        }
        .contentShape(Rectangle())
    }
}

private struct SelectedDot: View {
    var body: some View {
        Circle().fill(OrionTheme.accent).frame(width: 5, height: 5).shadow(color: OrionTheme.accent.opacity(0.8), radius: 3)
    }
}

private struct HeaderLink: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if isSelected { SelectedDot().transition(.scale.combined(with: .opacity)) }
                Text(title)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(isSelected ? OrionTheme.text : Color.white.opacity(hovering ? 0.88 : 0.62))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
        .animation(OrionMotion.select, value: isSelected)
    }
}

private struct HeaderIcon: View {
    let systemName: String
    let isSelected: Bool
    let help: String
    var size: CGFloat = 16
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: size, weight: .regular))
                .foregroundStyle(isSelected ? OrionTheme.accent : Color.white.opacity(hovering ? 0.88 : 0.55))
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(help)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
    }
}

/// The only status left in the chrome, and only when something is wrong.
struct HomeStatusCapsule: View {
    let issues: [HomeStatus.Issue]

    private var tint: Color { issues.contains(where: \.severe) ? OrionTheme.red : OrionTheme.orange }

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(tint).frame(width: 5, height: 5).shadow(color: tint.opacity(0.9), radius: 3)
            Text(issues.first?.text ?? "")
            if issues.count > 1 { Text("+\(issues.count - 1)").foregroundStyle(tint.opacity(0.7)) }
        }
        .font(OrionTheme.mono(9, .semibold))
        .tracking(1.8)
        .foregroundStyle(tint)
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(Capsule().fill(tint.opacity(0.07)))
        .overlay(Capsule().strokeBorder(tint.opacity(0.45), lineWidth: 0.8))
        .help(issues.map(\.text).joined(separator: " · "))
        .fixedSize()
    }
}

private extension View {
    /// Reports this view's centre, as a fraction of `width`, for each of `tabs`.
    func reportCenter(for tabs: [DashboardTab], in space: String, width: CGFloat) -> some View {
        background(GeometryReader { item in
            let fraction = item.frame(in: .named(space)).midX / max(1, width)
            Color.clear.preference(key: NavCentersKey.self, value: Dictionary(uniqueKeysWithValues: tabs.map { ($0, fraction) }))
        })
    }
}
