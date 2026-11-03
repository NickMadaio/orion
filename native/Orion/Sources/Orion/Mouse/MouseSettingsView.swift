import SwiftUI
import MouseKit

/// The Mouse section of Settings: the device, one row per extra button, per-app overrides, pass-through apps.
struct MouseSettingsView: View {
    @ObservedObject var mouse: MouseController
    @State private var editingApp: [Int: String] = [:]

    private var device: MouseDevice? { mouse.devices.devices.first { $0.connected } ?? mouse.devices.devices.first }
    private var buttons: [Int] {
        let observed = Set(mouse.bindings.default.keys.compactMap(Int.init))
        return Array(Set(device?.extraButtons ?? []).union(observed)).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionRule(title: "Mouse", trailing: mouse.bindings.enabled ? "on" : "off")
            ProjectBubble(text: MouseSetupEntry.pillTitle, symbol: "computermouse") { mouse.onSetupRequested?() }
            gamingBanner
            accessibilityRow
            deviceRow
            toggleRow("Remap extra buttons", detail: "Off passes every button through untouched.",
                      isOn: Binding(get: { mouse.bindings.enabled }, set: { mouse.setEnabled($0) }))
            if device != nil {
                ForEach(buttons, id: \.self) { buttonCard($0) }
            }
            Rectangle().fill(OrionTheme.line).frame(height: 1)
            toggleRow("Pass through in games",
                      detail: "Minecraft, anything categorised as a game, and fullscreen games keep every button as the game expects.",
                      isOn: Binding(get: { mouse.bindings.autoPassthroughGames }, set: { mouse.setAutoGames($0) }))
            toggleRow("Get my Mac ready when a game opens",
                      detail: "Closes browsers, other launchers and background apps you don't need, and frees idle models. Discord, music and call apps stay. Ask me to keep or close any app.",
                      isOn: Binding(get: { mouse.autoPrep }, set: { mouse.setAutoPrep($0) }))
            passthroughList
            Text("DPI buttons are usually handled inside the mouse's own firmware, so they may never reach the Mac.")
                .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Header rows

    /// Shown the whole time a game session runs: every button passes through, whatever the bindings below say.
    @ViewBuilder private var gamingBanner: some View {
        if mouse.gameSession.active {
            HStack(spacing: 8) {
                Circle().fill(OrionTheme.accent).frame(width: 6, height: 6)
                Text("Paused while you're gaming").font(.system(size: 12.5, weight: .medium)).foregroundStyle(OrionTheme.text)
                if let game = mouse.gameSession.game { Text(game.name.uppercased()).font(OrionTheme.mono(9, .medium)).tracking(1.2).foregroundStyle(OrionTheme.textDim) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .overlay(Capsule().strokeBorder(OrionTheme.accent.opacity(0.5), lineWidth: 0.8))
        }
    }


    @ViewBuilder private var accessibilityRow: some View {
        if !mouse.accessibilityGranted {
            VStack(alignment: .leading, spacing: 6) {
                Text("Needs Accessibility to see the extra buttons.")
                    .font(OrionTheme.mono(10.5)).foregroundStyle(OrionTheme.orange)
                HStack(spacing: 8) {
                    ProjectBubble(text: "Open Accessibility settings", symbol: "lock.open", hue: OrionTheme.orange) { mouse.requestAccessibility() }
                    ProjectBubble(text: "Check again") { mouse.recheckAccessibility() }
                }
            }
        }
    }

    private var deviceRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(device?.name ?? "No mouse with extra buttons found")
                .font(OrionTheme.serif(15)).foregroundStyle(OrionTheme.text)
            Spacer()
            if let device {
                Text("\(device.transport) · \(device.extraButtons.count) extra · \(device.connected ? "connected" : "not connected")".uppercased())
                    .font(OrionTheme.mono(9, .medium)).tracking(1.2).foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    // MARK: Button card

    private func buttonCard(_ button: Int) -> some View {
        let key = String(button)
        let apps = mouse.bindings.apps.filter { $0.value[key] != nil }.keys.sorted()
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("BUTTON \(button + 1)").font(OrionTheme.mono(9, .semibold)).tracking(2).foregroundStyle(OrionTheme.accent)
                if mouse.lastPressed == button {
                    Text("that is the one").font(OrionTheme.mono(9.5)).foregroundStyle(OrionTheme.accent)
                }
                Spacer()
                Text("press it to identify").font(OrionTheme.mono(9.5)).foregroundStyle(OrionTheme.textDim)
            }
            actionMenu(current: mouse.bindings.default[key]) { mouse.setDefault(button, $0) }
            ForEach(apps, id: \.self) { app in
                HStack {
                    Text(app).font(OrionTheme.mono(10.5)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
                    Spacer()
                    actionMenu(current: mouse.bindings.apps[app]?[key]) { mouse.setApp(app, button: button, $0) }
                }
            }
            if let front = mouse.frontmost, !apps.contains(front.bundleId) {
                ProjectBubble(text: "Different in \(front.name)", symbol: "plus") {
                    mouse.setApp(front.bundleId, button: button, mouse.bindings.default[key] ?? .system("missionControl"))
                }
            }
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(
            (mouse.lastPressed == button ? OrionTheme.accent : Color.white).opacity(mouse.lastPressed == button ? 0.6 : 0.12), lineWidth: 0.8))
        .animation(OrionMotion.hover, value: mouse.lastPressed)
    }

    /// A menu of presets, plus a shortcut field and an open-app field when those are chosen.
    private func actionMenu(current: MouseAction?, set: @escaping (MouseAction?) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Menu {
                Button("Does nothing special") { set(nil) }
                Divider()
                ForEach(MouseActionLabel.presets, id: \.self) { action in
                    Button(MouseActionLabel.label(action)) { set(action) }
                }
                Divider()
                Button("Keyboard shortcut…") { set(.shortcut("cmd+shift+4")) }
                Button("Open an app…") { set(.openApp("com.apple.Safari")) }
            } label: {
                HStack(spacing: 6) {
                    Text(MouseActionLabel.label(current)).font(.system(size: 12.5, weight: .medium)).foregroundStyle(OrionTheme.text)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold)).foregroundStyle(OrionTheme.textDim)
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.8))
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            switch current {
            case .some(.shortcut(let keys)):
                TextField("cmd+shift+4", text: Binding(get: { keys }, set: { set(.shortcut($0)) }))
                    .textFieldStyle(.plain).font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.accent)
                if ShortcutParser.parse(keys) == nil {
                    Text("Use modifiers (cmd ctrl opt shift fn) and one key, like cmd+shift+4.")
                        .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.orange)
                }
            case .some(.openApp(let id)):
                TextField("com.apple.Safari", text: Binding(get: { id }, set: { set(.openApp($0)) }))
                    .textFieldStyle(.plain).font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.accent)
            default: EmptyView()
            }
        }
    }

    // MARK: Pass-through apps

    private var passthroughList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ALWAYS PASS THROUGH").font(OrionTheme.mono(9, .semibold)).tracking(2).foregroundStyle(OrionTheme.textDim)
            ForEach(mouse.bindings.passthroughApps, id: \.self) { app in
                HStack {
                    Text(app).font(OrionTheme.mono(10.5)).foregroundStyle(OrionTheme.textSoft)
                    Spacer()
                    ProjectBubble(text: "Remove", symbol: "xmark", hue: OrionTheme.textSoft) { mouse.togglePassthrough(app) }
                }
            }
            if let front = mouse.frontmost, !mouse.bindings.passthroughApps.contains(front.bundleId) {
                ProjectBubble(text: "Add \(front.name)", symbol: "plus") { mouse.togglePassthrough(front.bundleId) }
            }
        }
    }

    private func toggleRow(_ title: String, detail: String, isOn: Binding<Bool>) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(OrionTheme.text)
                Text(detail).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            ProjectRoundToggle(isOn: isOn)
        }
    }
}
