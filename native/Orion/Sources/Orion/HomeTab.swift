import SwiftUI

/// Home: Orion himself, the apps orbiting him, and the one place to type.
///
/// The orb was the surface that already worked, so it is untouched. What
/// changed is everything around it — the status line, the composer and the
/// framing — which had been a black capsule and two centred labels sitting on
/// top of an otherwise weightless scene.
struct HomeTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var quickOpen: QuickOpenSettings
    let coreStyle: String
    var onAddApp: () -> Void
    var onManage: () -> Void

    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            phaseLine

            ZStack {
                RadialGradient(
                    colors: [OrionTheme.accent.opacity(0.13), OrionTheme.accent.opacity(0.03), .clear],
                    center: .center,
                    startRadius: 35,
                    endRadius: 300
                )
                Group {
                    if coreStyle == "blackHole" {
                        // The live Orion hologram remains intact in the floating
                        // assistant. This study tests whether the orbital
                        // launcher reads as an event horizon.
                        BlackHoleHologramView(phase: state.phase)
                    } else {
                        HologramView(model: state.hologram)
                    }
                }
                .frame(width: 465, height: 465)
                .allowsHitTesting(false)
                // Launchers deliberately sit above the visual core so an app can
                // cross the front of a black hole rather than disappearing as
                // though every orbit were behind it.
                HomeLauncherSurface(
                    settings: quickOpen,
                    onAddApp: onAddApp,
                    onManage: onManage
                )
            }
            .frame(maxWidth: .infinity)
            .frame(height: 520)

            composer
                .frame(maxWidth: 560)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .onAppear { composerFocused = true }
        // Bumped every time the window is summoned, so a second click on the
        // menu bar re-focuses the field instead of doing nothing visible.
        .onChange(of: state.focusComposerToken) { _, _ in composerFocused = true }
    }

    // MARK: - Phase

    private var phaseLine: some View {
        HStack(spacing: 9) {
            Circle()
                .fill(phaseColor)
                .frame(width: 6, height: 6)
                .shadow(color: phaseColor.opacity(0.9), radius: 5)
            Text(phaseTitle.uppercased())
                .font(OrionTheme.mono(9, .semibold))
                .tracking(2.4)
                .foregroundStyle(OrionTheme.textSoft)
            Text(state.statusLine)
                .font(OrionTheme.mono(9))
                .foregroundStyle(OrionTheme.textDim)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Composer

    /// A ruled line, not a filled capsule.
    ///
    /// The pill it replaces was the heaviest object on a page whose whole point
    /// is a weightless one. A field marked by a single rule that lights up on
    /// focus asks for the same typing and adds no shape to the scene.
    private var composer: some View {
        VStack(spacing: 9) {
            HStack(spacing: 12) {
                Image(systemName: "waveform")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(composerFocused ? OrionTheme.accent : OrionTheme.textDim)

                TextField("Ask Orion anything…", text: $state.composer, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14))
                    .lineLimit(1...3)
                    .focused($composerFocused)
                    .foregroundStyle(OrionTheme.text)
                    .onSubmit(submit)

                Button(action: submit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(canSend ? OrionTheme.ink : OrionTheme.textDim)
                        .frame(width: 26, height: 26)
                        .background(
                            Circle().fill(canSend ? OrionTheme.accent : Color.white.opacity(0.07))
                        )
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
            .padding(.bottom, 8)

            Rectangle()
                .fill(composerFocused ? OrionTheme.accent.opacity(0.65) : Color.white.opacity(0.12))
                .frame(height: 1)
                .shadow(color: OrionTheme.accent.opacity(composerFocused ? 0.45 : 0), radius: 5)
        }
        .animation(.easeOut(duration: 0.18), value: composerFocused)
        .animation(.easeOut(duration: 0.18), value: canSend)
    }

    private var canSend: Bool {
        !state.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() {
        guard canSend else { return }
        state.submitTyped()
        composerFocused = true
    }

    // MARK: - Derived

    private var phaseTitle: String {
        switch state.phase {
        case .idle: "Orion is ready"
        case .listening: "Listening"
        case .thinking: "Thinking"
        case .speaking: "Speaking"
        case .error: "Needs attention"
        }
    }

    private var phaseColor: Color {
        switch state.phase {
        case .idle: OrionTheme.green
        case .listening: OrionTheme.accent
        case .thinking: OrionTheme.violet
        case .speaking: OrionTheme.orange
        case .error: OrionTheme.red
        }
    }
}
