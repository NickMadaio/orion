import AppKit
import SwiftUI

/// The push-to-talk controls for the Settings tab: hairlines and spacing, no cards.
struct PushToTalkSettingsView: View {
    @ObservedObject var state: AppState
    @State private var recording = false
    @State private var recorderMessage: String?
    @State private var recorderMonitor: Any?

    private var config: PushToTalkConfig { state.pushToTalk }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionRule(title: "Push to talk", trailing: config.enabled ? "on" : "off")

            toggleRow("Enable push to talk",
                      detail: "Off removes the key listener entirely. Voice still works from the menu bar, the orb and the wake word.",
                      isOn: binding(\.enabled))

            if config.enabled {
                Rectangle().fill(OrionTheme.line).frame(height: 1)
                keyPicker
                if config.choice == .custom { customRow }
                if config.binding?.isModifierOnly == false { modePicker }
                if config.binding?.isModifierOnly == true { delayControls }
                if let warning = PTTClash.warning(for: config) {
                    Text(warning)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .onDisappear { stopRecording() }
    }

    private var keyPicker: some View {
        HStack {
            Text("Key").font(.system(size: 13, weight: .medium)).foregroundStyle(OrionTheme.text)
            Spacer()
            Picker("Key", selection: binding(\.choice)) {
                ForEach(PTTKeyChoice.allCases) { Text($0.label).tag($0) }
            }
            .labelsHidden()
            .frame(width: 170)
        }
    }

    private var customRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Shortcut").font(.system(size: 13)).foregroundStyle(OrionTheme.text)
                Spacer()
                Button(recording ? "Press keys… (Esc cancels)" : (config.custom?.label ?? "Record")) {
                    recording ? stopRecording() : startRecording()
                }
                .buttonStyle(.plain)
                .font(OrionTheme.mono(11, .semibold))
                .foregroundStyle(OrionTheme.accent)
            }
            if let message = recorderMessage {
                Text(message).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.orange)
            } else if config.custom == nil {
                Text("Record a modifier plus a key, such as ⌃⌥Space.")
                    .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    private var modePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("Mode", selection: binding(\.mode)) {
                ForEach(PTTMode.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text("The key press is not blocked, so the app in front still sees it.")
                .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
        }
    }

    private var delayControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            toggleRow("Hold before listening",
                      detail: "Quick taps while typing, and Option with another key, never start a turn.",
                      isOn: binding(\.holdDelayEnabled))
            if config.holdDelayEnabled {
                HStack {
                    Slider(value: binding(\.holdDelay), in: PushToTalkConfig.delayRange, step: 0.05)
                        .tint(OrionTheme.accent)
                    Text(String(format: "%.2f s", config.holdDelay))
                        .font(OrionTheme.mono(11, .semibold))
                        .foregroundStyle(OrionTheme.accent)
                        .frame(width: 52, alignment: .trailing)
                }
            }
        }
    }

    private func toggleRow(_ title: String, detail: String, isOn: Binding<Bool>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: isOn) {
                Text(title).font(.system(size: 13)).foregroundStyle(OrionTheme.text)
            }
            .toggleStyle(.switch)
            .tint(OrionTheme.accent)
            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Writes a copy back, so every change goes through `AppState`'s persistence.
    private func binding<V>(_ keyPath: WritableKeyPath<PushToTalkConfig, V>) -> Binding<V> {
        Binding(
            get: { state.pushToTalk[keyPath: keyPath] },
            set: { value in
                var next = state.pushToTalk
                next[keyPath: keyPath] = value
                state.pushToTalk = next
            }
        )
    }

    // MARK: Recorder

    private func startRecording() {
        recorderMessage = nil
        recording = true
        recorderMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == PushToTalkMonitor.escapeKeyCode, flags.isDisjoint(with: PTTCustomShortcut.shortcutMask) {
                stopRecording()
                return nil
            }
            switch PTTCustomShortcut.make(keyCode: event.keyCode, flags: flags) {
            case .success(let shortcut):
                var next = state.pushToTalk
                next.custom = shortcut
                state.pushToTalk = next
                stopRecording()
            case .failure(let reason):
                recorderMessage = reason.message
            }
            return nil
        }
    }

    private func stopRecording() {
        if let monitor = recorderMonitor { NSEvent.removeMonitor(monitor) }
        recorderMonitor = nil
        recording = false
    }
}
