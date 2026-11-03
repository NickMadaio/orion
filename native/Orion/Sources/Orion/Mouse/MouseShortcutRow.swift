import AppKit
import MouseKit
import SwiftUI

/// "Turn mouse shortcuts on/off": the global hotkey and its record-a-shortcut field, in Settings › Mouse and in the setup popup.
/// A thin outline capsule shows the keys; click it, press a modifier plus a key, Esc cancels. Never changes the wheel.
struct MouseShortcutRow: View {
    @ObservedObject var mouse: MouseController
    /// The compact form is the popup's: no detail paragraph.
    var compact = false
    @State private var recording = false
    @State private var message: String?
    @State private var monitor: Any?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Shortcut to turn mouse buttons off or on")
                        .font(.system(size: compact ? 12.5 : 13, weight: .medium)).foregroundStyle(OrionTheme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    if !compact {
                        Text("Works from any app, any time. The scroll wheel setting is separate.")
                            .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                recorderPill
            }
            if let text = message ?? mouse.toggleKeyProblem {
                Text(text).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.orange).fixedSize(horizontal: false, vertical: true)
            }
            if mouse.bindings.toggleShortcut != BindingsFile.defaultToggleShortcut {
                ProjectBubble(text: "Back to \(ShortcutParser.symbols(BindingsFile.defaultToggleShortcut))", symbol: "arrow.uturn.backward",
                              hue: OrionTheme.textSoft) { mouse.resetToggleShortcut() }
            }
        }
        .onDisappear { stop() }
    }

    private var recorderPill: some View {
        Button { recording ? stop() : start() } label: {
            Text(recording ? "Press keys…" : ShortcutParser.symbols(mouse.bindings.toggleShortcut))
                .font(OrionTheme.mono(12, .semibold)).tracking(recording ? 0.4 : 1.4)
                .foregroundStyle(recording ? OrionTheme.accent : OrionTheme.text)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(Capsule().fill(OrionTheme.accent.opacity(recording ? 0.14 : 0)))
                .overlay(Capsule().strokeBorder(recording ? OrionTheme.accent.opacity(0.8) : Color.white.opacity(0.22), lineWidth: 0.8))
                .shadow(color: recording ? OrionTheme.accent.opacity(0.35) : .clear, radius: 6)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Record shortcut")
        .accessibilityValue(ShortcutParser.symbols(mouse.bindings.toggleShortcut))
    }

    private func start() {
        message = nil
        recording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { event in
            let flags = UInt64(event.modifierFlags.intersection(.deviceIndependentFlagsMask).rawValue)
            if event.keyCode == 53, flags & (ShortcutParser.cmd | ShortcutParser.ctrl | ShortcutParser.opt) == 0 { stop(); return nil }
            guard let text = ShortcutParser.format(keyCode: event.keyCode, flags: flags) else {
                message = "Hold ⌃, ⌥ or ⌘ and press one key."
                return nil
            }
            mouse.setToggleShortcut(text)
            stop()
            return nil
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        recording = false
    }
}
