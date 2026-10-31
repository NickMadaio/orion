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
    var onPreviewFocus: () -> Void
    var onPreviewBreak: () -> Void

    @FocusState private var composerFocused: Bool
    @Namespace private var orbSpace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if state.chatMode {
                VStack(alignment: .trailing, spacing: 0) {
                    HStack {
                        InlineAction(title: "BACK TO HOME", systemImage: "arrow.left", tint: OrionTheme.textSoft) {
                            OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) {
                                state.chatMode = false
                                presentation = .parked
                            }
                        }
                        .help("Return to the main Home view; keep this conversation")
                        Spacer()
                        // The same orb, flown from the centre of Home into the
                        // corner, so opening chat reads as one movement.
                        HologramView(model: state.hologram, style: coreStyle)
                            .frame(width: 100, height: 100)
                            .matchedGeometryEffect(id: "home.orb", in: orbSpace)
                    }
                    SharedChatView(state: state).frame(height: max(420, availableHeight - 110))
                        .transition(OrionMotion.rise(reduceMotion: reduceMotion, distance: 14))
                }
                .transition(.opacity)
            } else if presentation == .full, let brief {
                MorningBriefPanel(facts: brief, writer: writer) {
                    OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) {
                        presentation = .parked
                    }
                }
                .frame(maxWidth: .infinity)
                .transition(OrionMotion.rise(reduceMotion: reduceMotion))
            } else {
                scene
                    .transition(.opacity)
            }
        }
        .animation(OrionMotion.resolved(OrionMotion.page, reduceMotion: reduceMotion), value: state.chatMode)
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
                        OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) {
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
        // Usage: a small line in the corner that opens into the full picture.
        .overlay(alignment: .topLeading) { UsageCorner().padding(.leading, 6).padding(.top, 4) }
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
                        HologramView(model: state.hologram, style: coreStyle)
                    }
                }
                .frame(width: coreSize, height: coreSize)
                .matchedGeometryEffect(id: "home.orb", in: orbSpace)
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

                Button {
                    OrionMotion.perform(OrionMotion.page, reduceMotion: reduceMotion) { state.chatMode = true }
                } label: {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OrionTheme.textDim)
                        .frame(width: 26, height: 26)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Open chat")
                .accessibilityLabel("Open chat")

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
            sessionCard
            previewControls
        }
        .padding(.vertical, 16)
        // 2026-10-30 polish: the comment above said "a ruled line, not a filled
        // capsule" while a gradient-filled, bordered rounded box sat behind it.
        // The rule now does the job alone, and lights on focus.
        .animation(OrionMotion.hover, value: composerFocused)
        .animation(OrionMotion.hover, value: canSend)
        .animation(OrionMotion.fade, value: state.phase)
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

    /// The session, under the composer, only when there is something to say.
    ///
    /// Hidden entirely when no session has ever run and none is running — an
    /// empty card on the home page every day is clutter, and the way to start
    /// one is the Console or a voice line, not a button you have to find.
    @ViewBuilder private var sessionCard: some View {
        if state.sessionTabModel.snapshot.session != nil {
            SessionCard(model: state.sessionTabModel)
        }
    }

    private var previewControls: some View {
        HStack(spacing: 10) {
            Text("TEMPORARY PREVIEW")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.5)
                .foregroundStyle(OrionTheme.textDim)
            Button("Focus session", action: onPreviewFocus)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(OrionTheme.accent)
            Button("Break", action: onPreviewBreak)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(OrionTheme.accent)
            Spacer()
        }
        .padding(.top, 2)
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
