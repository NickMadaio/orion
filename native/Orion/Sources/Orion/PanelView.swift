import SwiftUI

/// The floating surface: hologram centred, transcript beneath it, one compact
/// field for typed input. Deliberately dark and low-chrome — the panel sits on
/// top of whatever the user is actually doing, so it should read as a projection
/// rather than a window.
struct PanelView: View {
    @ObservedObject var state: AppState
    var onClose: () -> Void

    @FocusState private var composerFocused: Bool

    private let goldTint = Color(.sRGB, red: 1.0, green: 0.72, blue: 0.28, opacity: 1)

    // Written out rather than relying on the memberwise initializer, whose
    // access level depends on the private stored properties above.
    init(state: AppState, onClose: @escaping () -> Void) {
        _state = ObservedObject(wrappedValue: state)
        self.onClose = onClose
    }

    var body: some View {
        VStack(spacing: 10) {
            header

            if !state.accessibilityTrusted {
                accessibilityBanner
            }

            HologramView(model: state.hologram)
                .frame(height: 250)

            statusRow

            transcript

            composer
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(goldTint.opacity(0.16), lineWidth: 1)
                )
        )
        .preferredColorScheme(.dark)
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 8) {
            Text("ORION")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .kerning(2.5)
                .foregroundStyle(goldTint.opacity(0.85))

            Spacer()

            pill(label: "gateway", ok: state.gatewayUp)
            pill(label: "voice", ok: state.voiceUp)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .help("Hide Orion")
        }
    }

    private func pill(label: String, ok: Bool) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(ok ? Color(.sRGB, red: 0.42, green: 0.85, blue: 0.5, opacity: 1)
                         : Color(.sRGB, red: 0.95, green: 0.42, blue: 0.32, opacity: 1))
                .frame(width: 5, height: 5)
            Text(label)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(Color.white.opacity(0.45))
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Capsule().fill(Color.white.opacity(0.06)))
        .help(ok ? "\(label) reachable" : "\(label) unreachable")
    }

    private var accessibilityBanner: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color(.sRGB, red: 1, green: 0.72, blue: 0.28, opacity: 1))
                .font(.system(size: 11))
            VStack(alignment: .leading, spacing: 4) {
                Text("Push-to-talk is off")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.9))
                Text("Right Option only works everywhere once Orion has Accessibility access.")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .fixedSize(horizontal: false, vertical: true)
                Button("Open Accessibility settings") {
                    state.requestAccessibility()
                }
                .buttonStyle(.plain)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(goldTint)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color(.sRGB, red: 1, green: 0.72, blue: 0.28, opacity: 0.10))
        )
    }

    private var statusRow: some View {
        VStack(spacing: 3) {
            Text(state.heard.isEmpty ? state.statusLine : state.heard)
                .font(.system(size: 12, weight: state.heard.isEmpty ? .regular : .medium))
                .foregroundStyle(state.heard.isEmpty
                                 ? Color.white.opacity(0.45)
                                 : Color.white.opacity(0.92))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
                .animation(.easeOut(duration: 0.15), value: state.heard)

            Text("hold ⌥ right option to talk · esc to stop")
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(Color.white.opacity(0.22))

            // The providers that are REALLY serving, after any fallback —
            // never the ones merely configured.
            Text(state.voiceSummary)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(Color.white.opacity(0.22))
                .help("The voice and ears actually serving right now")
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(state.turns) { turn in
                        turnRow(turn)
                            .id(turn.id)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(AppState.transcriptBottomAnchor)
                }
                .padding(.horizontal, 2)
            }
            .frame(height: 120)
            .onChange(of: state.turns.count) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(AppState.transcriptBottomAnchor, anchor: .bottom)
                }
            }
        }
    }

    private func turnRow(_ turn: Turn) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label(for: turn.role))
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .kerning(1.2)
                .foregroundStyle(color(for: turn.role).opacity(0.7))
            Text(turn.text)
                .font(.system(size: 11.5))
                .foregroundStyle(Color.white.opacity(turn.role == .system ? 0.5 : 0.85))
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func label(for role: Turn.Role) -> String {
        switch role {
        case .you: return "YOU"
        case .orion: return "ORION"
        case .system: return "NOTE"
        }
    }

    private func color(for role: Turn.Role) -> Color {
        switch role {
        case .you: return Color(.sRGB, red: 0.47, green: 0.69, blue: 1, opacity: 1)
        case .orion: return goldTint
        case .system: return Color.white.opacity(0.5)
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Ask Orion…", text: $state.composer)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.92))
                .focused($composerFocused)
                .onSubmit { state.submitTyped() }

            Button {
                state.submitTyped()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(state.composer.isEmpty ? Color.white.opacity(0.2) : goldTint)
            }
            .buttonStyle(.plain)
            .disabled(state.composer.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.07))
        )
    }
}
