import ThinkingOrbsKit
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
        window.setContentSize(NSSize(width: 440, height: 720))
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

                // Live while dragging. A brightness control that only applies
                // on release is useless for this, because the whole job is
                // matching the orb to whatever happens to be behind it right
                // now — you have to see it move.
                HStack {
                    Text("Brightness")
                    Slider(value: $state.hologramBrightness, in: 0.6...4.0)
                    Text(String(format: "%.1f×", state.hologramBrightness))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 38, alignment: .trailing)
                }
                Text("How strongly the projection reads against what is behind it. Higher over bright windows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack {
                    Text("Size")
                    Slider(
                        value: $state.orbSize,
                        in: SummonSettings.orbSizeRange
                    )
                    Text("\(Int(state.orbSize))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 38, alignment: .trailing)
                }
                Text("Resizes live, about its centre. Drag the orb itself to move it; closing it only hides it, and push-to-talk or the wake word brings it back.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            section("Voice") {
                Picker("Speaking", selection: $state.ttsProvider) {
                    ForEach(TTSProvider.allCases) { provider in
                        Text(provider.label).tag(provider)
                    }
                }
                .pickerStyle(.radioGroup)
                keyRow(
                    name: Secrets.elevenLabsVariable,
                    present: state.elevenLabsKeyPresent,
                    needed: state.ttsProvider == .elevenlabs
                )

                Picker("Listening", selection: $state.sttProvider) {
                    ForEach(STTProvider.allCases) { provider in
                        Text(provider.label).tag(provider)
                    }
                }
                .pickerStyle(.radioGroup)
                keyRow(
                    name: Secrets.deepgramVariable,
                    present: state.deepgramKeyPresent,
                    needed: state.sttProvider == .deepgram
                )

                // What is CONFIGURED is above. This is what is actually
                // serving, which is the only thing worth trusting.
                row("Now speaking", state.activeTTSEngine)
                row("Now listening", state.activeSTTProvider.rawValue)

                Text("Keys are read from the environment, then from \(Secrets.envPath). They are sent to the provider in a request header and are never logged, shown here, or written to openclaw.json. Either provider falls back to the local engine automatically.")
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
                row("Gateway", state.gatewayAvailability.title)
                Text(state.gatewayAvailability.detail).font(.caption).foregroundStyle(.secondary)
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

    /// Presence only. The value of a key is never rendered anywhere.
    private func keyRow(name: String, present: Bool, needed: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: present ? "key.fill" : "key.slash")
                .font(.system(size: 10))
                .foregroundStyle(present ? Color.green
                                         : (needed ? Color.orange : Color.secondary))
            Text(name)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
            Text(present ? "found" : (needed ? "missing — falling back to local" : "not set"))
                .font(.caption)
                .foregroundStyle(needed && !present ? Color.orange : Color.secondary)
            Spacer(minLength: 0)
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
