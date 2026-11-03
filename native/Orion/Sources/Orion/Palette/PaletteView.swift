//
//  The palette's face (w18). A near-black panel with real transparency, a thin outline, a faint inner gradient and a
//  blue radial; a large field with the drifting rim; kickers per section; rows with round bubbles and a soft glow
//  pill; a right-hand preview. About 760 pt wide.
//

import OrionViews
import PaletteKit
import SwiftUI

struct PaletteView: View {
    static let width: CGFloat = 760
    static let height: CGFloat = 672
    private static let listWidth: CGFloat = 462
    private static let corner: CGFloat = 26

    @ObservedObject var model: PaletteModel
    var onRun: (Int) -> Void = { _ in }
    /// Renders: still rim, no text field, no scroll views, a held clock.
    var isStatic = false
    var clockDate: Date?

    @FocusState private var focused: Bool
    @Namespace private var glow
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            PaletteStrip(glance: model.glance, session: model.session, problem: model.hotKeyProblem, clockDate: clockDate)
            PaletteField(model: model, focus: $focused, animated: !isStatic)
                .padding(.horizontal, 18)
            HStack(spacing: 0) {
                list.frame(width: Self.listWidth)
                Rectangle().fill(Color.white.opacity(0.07)).frame(width: 0.6).padding(.vertical, 8)
                PalettePreview(item: model.nav.selectedItem, output: model.output, running: model.context.running, animated: !isStatic)
            }
            .padding(.top, 10)
            footer
        }
        .frame(width: Self.width, height: Self.height, alignment: .topLeading)
        .background(panel)
        .softReveal(rise: 10)
        .id(isStatic ? 0 : model.showCount)
        .onAppear { focus() }
        .onChange(of: model.showCount) { _ in focus() }
    }

    private func focus() {
        guard !isStatic else { return }
        focused = true
        DispatchQueue.main.async { focused = true }
    }

    // MARK: Panel

    private var panel: some View {
        let shape = RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
        return ZStack {
            shape.fill(OrionTheme.ink.opacity(0.84))
            shape.fill(LinearGradient(colors: [Color.white.opacity(0.05), Color.white.opacity(0.0), Color.white.opacity(0.015)],
                                      startPoint: .top, endPoint: .bottom))
            shape.fill(RadialGradient(colors: [OrionTheme.accent.opacity(0.12), Color(red: 0.2, green: 0.4, blue: 1).opacity(0.05), .clear],
                                      center: UnitPoint(x: 0.12, y: 0.0), startRadius: 0, endRadius: 420))
            shape.strokeBorder(Color.white.opacity(0.11), lineWidth: 0.8)
            shape.inset(by: 1.5).strokeBorder(LinearGradient(colors: [OrionTheme.accent.opacity(0.22), Color.white.opacity(0.0)],
                                                             startPoint: .topLeading, endPoint: .center), lineWidth: 0.6)
        }
    }

    // MARK: List

    private var list: some View {
        let rows = model.nav.rows
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                if index == 0 || rows[index - 1].section != item.section { PaletteKicker(section: item.section) }
                PaletteRow(item: item, selected: index == model.nav.selected, quickPick: index < 9 ? index + 1 : nil, glow: glow)
                    .onTapGesture { onRun(index) }
                    .onHover { inside in if inside, model.nav.selected != index { model.select(index) } }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .animation(OrionMotion.resolved(OrionMotion.select, reduceMotion: reduceMotion), value: model.nav.selected)
        .animation(OrionMotion.resolved(OrionMotion.fade, reduceMotion: reduceMotion), value: rows.map(\.id))
        .overlay(alignment: .bottomTrailing) {
            if let sub = model.nav.subMenu {
                PaletteSubMenu(actions: sub, selected: model.nav.subSelected)
                    .padding(10)
                    .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .bottomTrailing)))
            }
        }
        .animation(OrionMotion.resolved(OrionMotion.select, reduceMotion: reduceMotion), value: model.nav.subMenu != nil)
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 16) {
            ForEach(Self.keys, id: \.0) { key, what in
                HStack(spacing: 5) {
                    Text(key).font(OrionTheme.mono(10, .semibold)).foregroundStyle(OrionTheme.textSoft)
                    Text(what).font(.system(size: 10.5)).foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer()
            if model.query.isEmpty {
                Text("? ask   + to-do   = calc   > action").font(OrionTheme.mono(9.5)).foregroundStyle(OrionTheme.textDim)
            } else {
                Text("⌥⇥").font(OrionTheme.mono(10, .semibold)).foregroundStyle(OrionTheme.accent.opacity(0.7))
            }
        }
        .padding(.horizontal, 24)
        .frame(height: 38)
        .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.06)).frame(height: 0.6).padding(.horizontal, 18) }
    }

    private static let keys = [("↑↓", "move"), ("↩", "run"), ("⇥", "section"), ("⌘K", "actions"), ("⌘1–9", "pick"), ("esc", "close")]
}
