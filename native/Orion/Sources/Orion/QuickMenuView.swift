//
//  The ⌥Tab menu's face (7 Oct 2026). Type and hairlines, no boxes: the day at
//  a glance on top (or the running session, large), the field, then commands
//  marked by an accent rule when selected. Real alpha, so the desktop shows.
//

import SwiftUI

struct QuickMenuView: View {
    static let width: CGFloat = 640

    @ObservedObject var controller: ConsoleController
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 26).padding(.top, 22).padding(.bottom, 16)
            FadingRule()
            field
            FadingRule()
            results
            footer
        }
        .frame(width: Self.width, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(OrionTheme.ink.opacity(0.86))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [OrionTheme.accent.opacity(0.35), Color.white.opacity(0.04)],
                                                 startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
        )
        .onAppear { focused = true }
        .onExitCommand { controller.hide() }
        .animation(.easeOut(duration: 0.14), value: controller.selection)
        .animation(.easeOut(duration: 0.18), value: controller.glance)
    }

    // MARK: Header — the session if one runs, otherwise now / next

    @ViewBuilder private var header: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 5) {
                if let session = controller.session {
                    label(session.paused ? "PAUSED" : session.onBreak ? "ON A BREAK" : "FOCUSING",
                          tint: session.onBreak ? OrionTheme.violet : OrionTheme.accent)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(clock(session.remaining(at: context.date)))
                            .font(.system(size: 34, weight: .ultraLight, design: .rounded).monospacedDigit())
                            .foregroundStyle(OrionTheme.text)
                    }
                    Text(session.label).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
                } else if let now = controller.glance?.now {
                    label("NOW", tint: OrionTheme.accent)
                    Text(now.title).font(.system(size: 17, weight: .medium)).foregroundStyle(OrionTheme.text).lineLimit(1)
                    Text("until \(now.until)").font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
                } else {
                    label("NOW", tint: OrionTheme.accent)
                    Text(controller.glance == nil ? "…" : "Nothing planned right now")
                        .font(.system(size: 17, weight: .medium)).foregroundStyle(OrionTheme.textSoft)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 9) {
                if let next = controller.glance?.next {
                    fact("NEXT", "\(next.at) · \(next.title)")
                }
                if let focus = controller.glance?.focusToday { fact("FOCUS TODAY", focus) }
                if let phone = controller.glance?.phone { fact("PHONE", phone) }
            }
            .frame(width: 236, alignment: .leading)
            .padding(.top, 2)
        }
    }

    private func label(_ text: String, tint: Color) -> some View {
        Text(text).font(OrionTheme.mono(9, .semibold)).tracking(1.6).foregroundStyle(tint)
    }

    private func fact(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(OrionTheme.mono(8.5, .semibold)).tracking(1.4).foregroundStyle(OrionTheme.textDim)
            Text(value).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
        }
    }

    // MARK: Field

    private var field: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkle")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(OrionTheme.accent)
            TextField("Ask ORION, or type a command — focus 90, todo call mum, open Xcode",
                      text: $controller.query)
                .textFieldStyle(.plain)
                .font(.system(size: 19, weight: .light))
                .foregroundStyle(OrionTheme.text)
                .focused($focused)
                .onSubmit { controller.runSelected() }
                .onKeyPress(.upArrow) { controller.moveSelection(-1); return .handled }
                .onKeyPress(.downArrow) { controller.moveSelection(1); return .handled }
                .onKeyPress(.return, phases: .down) { press in
                    guard press.modifiers.contains(.command) else { return .ignored }
                    controller.askTyped(); return .handled
                }
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 16)
    }

    // MARK: Results

    private var results: some View {
        let rows = controller.matches
        return VStack(alignment: .leading, spacing: 0) {
            if let problem = controller.hotKeyProblem {
                Text(problem).font(.system(size: 11)).foregroundStyle(OrionTheme.orange)
                    .padding(.horizontal, 26).padding(.top, 10).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, command in
                if controller.query.isEmpty, command.section != .typed,
                   index == 0 || rows[index - 1].section != command.section {
                    label(command.section.rawValue, tint: OrionTheme.textDim)
                        .padding(.horizontal, 26).padding(.top, index == 0 ? 12 : 14).padding(.bottom, 3)
                }
                row(command, selected: index == controller.selection)
                    .onTapGesture { controller.run(command) }
                    .onHover { inside in if inside { controller.selection = index } }
            }
        }
        .padding(.bottom, 6)
    }

    private func row(_ command: ConsoleCommand, selected: Bool) -> some View {
        HStack(spacing: 14) {
            Rectangle()
                .fill(selected ? OrionTheme.accent : Color.clear)
                .frame(width: 2, height: 22)
            Image(systemName: command.symbol)
                .font(.system(size: 12.5, weight: .regular))
                .foregroundStyle(selected ? OrionTheme.accent : OrionTheme.textDim)
                .frame(width: 18)
            Text(command.title)
                .font(.system(size: 14, weight: selected ? .medium : .regular))
                .foregroundStyle(selected ? OrionTheme.text : OrionTheme.text.opacity(0.78))
                .lineLimit(1)
            if !command.hint.isEmpty {
                Text(command.hint).font(.system(size: 11.5)).foregroundStyle(OrionTheme.textDim).lineLimit(1)
            }
            Spacer(minLength: 8)
            if command.tier == .notify {
                Text("TELLS YOU").font(OrionTheme.mono(8, .semibold)).tracking(1.2).foregroundStyle(OrionTheme.textDim)
            }
            if selected {
                Text("↩").font(.system(size: 12, weight: .medium)).foregroundStyle(OrionTheme.textSoft)
            }
        }
        .padding(.leading, 24).padding(.trailing, 26)
        .frame(height: 34)
        .contentShape(Rectangle())
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 18) {
            ForEach([("↑↓", "move"), ("↩", "run"), ("⌘↩", "ask ORION"), ("esc", "close")], id: \.0) { key, what in
                HStack(spacing: 5) {
                    Text(key).font(OrionTheme.mono(10, .semibold)).foregroundStyle(OrionTheme.textSoft)
                    Text(what).font(.system(size: 10.5)).foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer()
            Text("⌥⇥").font(OrionTheme.mono(10, .semibold)).foregroundStyle(OrionTheme.accent.opacity(0.7))
        }
        .padding(.horizontal, 26).padding(.vertical, 12)
        .overlay(alignment: .top) { FadingRule() }
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        return total >= 3600
            ? String(format: "%d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60)
            : String(format: "%d:%02d", total / 60, total % 60)
    }
}
