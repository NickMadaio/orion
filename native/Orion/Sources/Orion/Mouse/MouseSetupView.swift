import SwiftUI
import MouseKit

/*
 The small setup popup that floats beside ORION's bubble: a thin outline card, a mono kicker, a serif title, one row per
 extra button with action pills. Pressing a button on the mouse lights its row. Pill taps write bindings.json at once
 (through MouseController), so edits made from chat while it is open show up here as the file is re-read; Done also
 saves the suggested defaults that were left alone. The full section in Settings stays for later edits.
 */
struct MouseSetupView: View {
    @ObservedObject var mouse: MouseController
    var onDone: () -> Void
    var onNotNow: () -> Void

    private var device: MouseDevice? { mouse.devices.devices.first { $0.connected } ?? mouse.devices.devices.first }
    private var buttons: [Int] {
        let saved = Set(mouse.bindings.default.keys.compactMap(Int.init))
        return Array(Set(device?.extraButtons ?? []).union(saved)).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(MouseSetupPlan.kicker(deviceName: device?.name))
                    .font(OrionTheme.mono(9, .semibold)).tracking(2.2).foregroundStyle(OrionTheme.accent).lineLimit(1)
                Text("Your extra buttons").font(OrionTheme.serif(22)).foregroundStyle(OrionTheme.text)
                Text("Press a button on the mouse to find its row.")
                    .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
            }
            if mouse.gameSession.active, !mouse.gate.isOn {
                Text("Paused while a game is in front. Buttons work as the game expects; the shortcut key turns them back on.")
                    .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.accent).fixedSize(horizontal: false, vertical: true)
            }
            if !mouse.accessibilityGranted {
                ProjectBubble(text: "Allow Accessibility so I can see them", symbol: "lock.open", hue: OrionTheme.orange) { mouse.requestAccessibility() }
            }
            ForEach(Array(buttons.enumerated()), id: \.element) { index, button in
                row(button).deal(order: index + 1, rise: 8)
            }
            MouseShortcutRow(mouse: mouse, compact: true)
            HStack(alignment: .center, spacing: 12) {
                Text("Pause when a game is in front").font(.system(size: 12.5, weight: .medium)).foregroundStyle(OrionTheme.text)
                Spacer()
                ProjectRoundToggle(isOn: Binding(get: { mouse.bindings.autoPauseInGames }, set: { mouse.setAutoPause($0) }))
            }
            HStack(alignment: .center, spacing: 12) {
                Text("Pass through in games").font(.system(size: 12.5, weight: .medium)).foregroundStyle(OrionTheme.text)
                Spacer()
                ProjectRoundToggle(isOn: Binding(get: { mouse.bindings.autoPassthroughGames }, set: { mouse.setAutoGames($0) }))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Normal mouse wheel").font(.system(size: 12.5, weight: .medium)).foregroundStyle(OrionTheme.text)
                KnowledgeFlow(spacing: 6, lineSpacing: 6) {
                    ForEach(ReverseWheelMode.allCases, id: \.self) { m in
                        choice(MouseSetupPlan.wheelTitle(m), mouse.bindings.reverseWheel == m) { mouse.setReverseWheel(m) }
                    }
                }
            }
            HStack(spacing: 8) {
                ProjectBubble(text: "Done", symbol: "checkmark", action: onDone)
                ProjectBubble(text: "Not now", hue: OrionTheme.textSoft, action: onNotNow)
                Spacer()
            }
        }
        .padding(18)
        .frame(width: 372, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18).fill(OrionTheme.ink.opacity(0.88)))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.16), lineWidth: 0.8))
        .environment(\.colorScheme, .dark)
        .softReveal(rise: 10)
    }

    // MARK: Row

    private func row(_ button: Int) -> some View {
        let current = MouseSetupPlan.effective(button, in: mouse.bindings)
        let lit = mouse.lastPressed == button
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(MouseSetupPlan.title(button).uppercased())
                    .font(OrionTheme.mono(9, .semibold)).tracking(1.8)
                    .foregroundStyle(lit ? OrionTheme.accent : OrionTheme.textSoft)
                Spacer()
                if lit { Text("that one").font(OrionTheme.mono(9.5)).foregroundStyle(OrionTheme.accent).transition(.opacity) }
            }
            KnowledgeFlow(spacing: 6, lineSpacing: 6) {
                choice("Stage Manager", current == .system("stageManager")) { mouse.setDefault(button, .system("stageManager")) }
                choice("Mission Control", current == .system("missionControl")) { mouse.setDefault(button, .system("missionControl")) }
                choice("Desktop ←", current == .system("desktopLeft")) { mouse.setDefault(button, .system("desktopLeft")) }
                choice("Desktop →", current == .system("desktopRight")) { mouse.setDefault(button, .system("desktopRight")) }
                choice("Show Desktop", current == .system("showDesktop")) { mouse.setDefault(button, .system("showDesktop")) }
                choice("Shortcut…", isShortcut(current)) { mouse.setDefault(button, .shortcut("cmd+shift+4")) }
                choice("Open app…", isOpenApp(current)) { mouse.setDefault(button, .openApp("com.apple.Safari")) }
                choice("ORION", isOrion(current)) { mouse.setDefault(button, .orion("summon")) }
                choice("Nothing", current == nil || current == .passthrough) { mouse.setDefault(button, .passthrough) }
            }
            detail(button, current)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(OrionTheme.accent.opacity(lit ? 0.10 : 0)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(lit ? OrionTheme.accent.opacity(0.75) : Color.white.opacity(0.12), lineWidth: 0.8))
        .shadow(color: lit ? OrionTheme.accent.opacity(0.35) : .clear, radius: 10)
        .animation(OrionMotion.hover, value: lit)
    }

    @ViewBuilder private func detail(_ button: Int, _ current: MouseAction?) -> some View {
        switch current {
        case .some(.shortcut(let keys)):
            TextField("cmd+shift+4", text: Binding(get: { keys }, set: { mouse.setDefault(button, .shortcut($0)) }))
                .textFieldStyle(.plain).font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.accent)
            if ShortcutParser.parse(keys) == nil {
                Text("Modifiers (cmd ctrl opt shift fn) plus one key.").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.orange)
            }
        case .some(.openApp(let id)):
            TextField("com.apple.Safari", text: Binding(get: { id }, set: { mouse.setDefault(button, .openApp($0)) }))
                .textFieldStyle(.plain).font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.accent)
        case .some(.orion(let command)):
            HStack(spacing: 6) {
                ForEach(MouseAction.orionCommands, id: \.self) { c in
                    choice(MouseActionLabel.label(.orion(c)), command == c) { mouse.setDefault(button, .orion(c)) }
                }
            }
        default: EmptyView()
        }
    }

    private func choice(_ text: String, _ on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: 11.5, weight: on ? .semibold : .medium))
                .foregroundStyle(on ? OrionTheme.text : OrionTheme.textSoft)
                .padding(.horizontal, 11).padding(.vertical, 5)
                .background(Capsule().fill(OrionTheme.accent.opacity(on ? 0.14 : 0)))
                .overlay(Capsule().strokeBorder(on ? OrionTheme.accent.opacity(0.7) : Color.white.opacity(0.16), lineWidth: 0.8))
                .shadow(color: on ? OrionTheme.accent.opacity(0.3) : .clear, radius: 5)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func isShortcut(_ a: MouseAction?) -> Bool { if case .some(.shortcut) = a { return true }; return false }
    private func isOpenApp(_ a: MouseAction?) -> Bool { if case .some(.openApp) = a { return true }; return false }
    private func isOrion(_ a: MouseAction?) -> Bool { if case .some(.orion) = a { return true }; return false }
}
