import AppKit
import SwiftUI

/// A small, ordinary window — the one place in Orion where a normal titled
/// window is the right answer, because the user is reading and clicking rather
/// than glancing.
final class PreferencesWindowController {

    private var window: NSWindow?
    private let state: AppState

    init(state: AppState) {
        self.state = state
    }

    func show() {
        if let window = window {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }

        let hosting = NSHostingController(rootView: PreferencesView(state: state))
        let window = NSWindow(contentViewController: hosting)
        window.title = "Orion Preferences"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.setContentSize(NSSize(width: 420, height: 430))
        window.center()
        self.window = window

        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

struct PreferencesView: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            section("Hologram") {
                Picker("Detail", selection: $state.quality) {
                    ForEach(HologramQuality.allCases) { quality in
                        Text(quality.label).tag(quality)
                    }
                }
                .pickerStyle(.radioGroup)
                Text("Automatic starts at full detail and steps down once if it cannot hold the frame rate.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            section("Permissions") {
                permissionRow(
                    title: "Accessibility",
                    detail: "Lets Right Option work while any app is frontmost.",
                    ok: state.accessibilityTrusted,
                    action: { state.requestAccessibility() }
                )
                permissionRow(
                    title: "Microphone",
                    detail: "Captures your voice while push-to-talk is held.",
                    ok: !state.micDenied,
                    action: { Permissions.openMicrophoneSettings() }
                )
                permissionRow(
                    title: "Speech Recognition",
                    detail: "Transcribes on-device where the language supports it.",
                    ok: !state.speechDenied,
                    action: { Permissions.openSpeechRecognitionSettings() }
                )
                Button("Ask for microphone and speech now") {
                    state.primeMicrophonePermissions()
                }
                .font(.caption)
            }

            Divider()

            section("Connections") {
                row("Gateway", state.gatewayUp ? "up · 127.0.0.1:\(GatewayClient.port())"
                                               : "unreachable · 127.0.0.1:\(GatewayClient.port())")
                row("Voice daemon", state.voiceUp ? "connected" : "not running")
                row("Session key", GatewayClient.sessionKey)
            }

            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(width: 420, alignment: .leading)
        .onAppear {
            state.refreshStatus()
            state.refreshPermissions()
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .kerning(1.4)
                .foregroundStyle(.secondary)
            content()
        }
    }

    private func permissionRow(title: String,
                               detail: String,
                               ok: Bool,
                               action: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(ok ? Color.green : Color.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12, weight: .medium))
                Text(detail).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if !ok {
                Button("Open…", action: action).font(.caption)
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 12))
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
