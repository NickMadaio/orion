import SwiftUI

/// Home: Orion himself, the apps orbiting him, and the one place to type —
/// unless the day has just started, in which case the brief has it.
///
/// Two things about the layout, both of them corrections.
///
/// The orb is sized from the height it is actually given rather than from a
/// constant. It used to be a fixed 465pt inside a fixed 520pt box, so on a
/// large display it sat small with dead space above it, and the more space the
/// window had the worse that looked.
///
/// And the phase line moved to the bottom, beside the composer. It reads as
/// status, which belongs with the input, and having it above the orb put a row
/// of text between the navigation and the thing the page is about.
struct HomeTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var quickOpen: QuickOpenSettings
    @ObservedObject var writer: NarrativeWriter
    let coreStyle: String
    /// Nil until the day's facts have been gathered.
    let brief: BriefFacts?
    @Binding var presentation: BriefPresentation
    /// The height Home has to work with, so the core can fill it.
    let availableHeight: CGFloat
    var onAddApp: () -> Void
    var onManage: () -> Void

    @FocusState private var composerFocused: Bool

    var body: some View {
        Group {
            if presentation == .full, let brief {
                MorningBriefPanel(facts: brief, writer: writer) {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
                        presentation = .parked
                    }
                }
                .frame(maxWidth: .infinity)
            } else {
                scene
            }
        }
        .onAppear { composerFocused = true }
        // Bumped every time the window is summoned, so a second click on the
        // menu bar re-focuses the field instead of doing nothing visible.
        .onChange(of: state.focusComposerToken) { _, _ in composerFocused = true }
    }

    // MARK: - The scene

    /// Whether the brief has a card to park. Drives the reserved rail width, so
    /// the orb is centred against the same margin on both sides.
    private var showsRail: Bool {
        presentation == .parked && (brief?.hasAnything ?? false)
    }

    private static let railWidth: CGFloat = 178

    /// The orb, with a real column for the parked brief rather than a card
    /// floating on top of it.
    ///
    /// It WAS an overlay on the same ZStack that holds the launcher surface,
    /// and that could only ever collide: the launcher places its first ring at
    /// fractions of the container, one of which is x 0.85 / y 0.20 — the exact
    /// corner the card occupied. So an app icon sat on top of the brief and
    /// took its clicks.
    ///
    /// A matching empty rail on the left keeps the orb centred in the window
    /// rather than pushed off-axis by the card's width.
    private var scene: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                if showsRail {
                    Color.clear.frame(width: HomeTab.railWidth)
                }

                orbField

                if showsRail, let brief {
                    ParkedBriefCard(facts: brief) {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
                            presentation = .full
                        }
                    }
                    .frame(width: HomeTab.railWidth)
                    .transition(.opacity.combined(with: .offset(x: 14)))
                }
            }

            composer
                .frame(maxWidth: 560)
                .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }

    private var orbField: some View {
        ZStack {
                RadialGradient(
                    colors: [OrionTheme.accent.opacity(0.13), OrionTheme.accent.opacity(0.03), .clear],
                    center: .center,
                    startRadius: 35,
                    endRadius: coreSize * 0.62
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
                .frame(width: coreSize, height: coreSize)
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
        .frame(height: coreSize)
    }

    /// Fill the height, within reason.
    ///
    /// The floor keeps it recognisable on a short window; the ceiling stops it
    /// becoming a wall on a 6K display. The subtraction is the composer and the
    /// phase line, which sit below it.
    private var coreSize: CGFloat {
        let forComposer: CGFloat = 96
        return min(760, max(360, availableHeight - forComposer))
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

                TextField("What do you need?", text: $state.composer, axis: .vertical)
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

            phaseLine
        }
        .animation(.easeOut(duration: 0.18), value: composerFocused)
        .animation(.easeOut(duration: 0.18), value: canSend)
    }

    private var phaseLine: some View {
        HStack(spacing: 9) {
            Circle()
                .fill(phaseColor)
                .frame(width: 5, height: 5)
                .shadow(color: phaseColor.opacity(0.9), radius: 4)
            Text(phaseTitle.uppercased())
                .font(OrionTheme.mono(8, .semibold))
                .tracking(2.2)
                .foregroundStyle(OrionTheme.textSoft)
            Text(state.statusLine)
                .font(OrionTheme.mono(8))
                .foregroundStyle(OrionTheme.textDim)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
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
