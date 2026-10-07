import SwiftUI
import OrionViews

/// The summon surface: the hologram, and nothing else.
///
/// Everything that used to live here — header, status line, transcript rail,
/// composer, reachability pills — moved to the text window, which is where a
/// person goes when they have decided to read and type. This panel arrives
/// unbidden over whatever the user is actually doing, so it has to earn every
/// pixel it covers, and a projection answering a voice earns more of them than
/// a status line does.
///
/// There is no background plate on purpose. The panel is a transparent square
/// with a shell floating in it; anything drawn behind that would turn it back
/// into a window.
struct PanelView: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(spacing: 0) {
            HologramView(model: state.hologram).allowsHitTesting(false)

            // The only text allowed, and only while it is the fastest way to
            // answer "did it hear me". Nothing while idle, and nothing while
            // Orion speaks — the shell is the feedback there, and a caption
            // would only be reading its own words back at him.
            if state.phase == .listening, !state.heard.isEmpty {
                Text(state.heard)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.66))
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    // The tail is what he just said, so drop the head when it
                    // runs long.
                    .truncationMode(.head)
                    // No plate behind it, so legibility has to come from the
                    // text itself: this sits over an unknown desktop.
                    .shadow(color: .black.opacity(0.8), radius: 4)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 14)
            }
            // ORION started this one (orion-reach): a readable bubble, no sound unless he chose aloud.
            if let message = state.reachMessage {
                Text(message)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .multilineTextAlignment(.leading)
                    .lineLimit(8)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .frame(width: 260, alignment: .leading)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.12), lineWidth: 1))
                    .padding(.bottom, 8)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            SummonComposer(text: $state.composer, micMuted: state.summonMicMuted, onSend: state.submitTyped, onToggleMute: { state.toggleSummonMute() }, onClose: { state.hideSummon?() }, width: 260,
                           onDone: state.phase == .listening ? { state.finishTurnNow() } : nil).padding(.bottom, 8)
        }
        // Never a hit target. What may be clicked is decided by the container
        // view in `PanelController`, which knows the shape of what was drawn.

        .animation(.easeOut(duration: 0.16), value: state.heard)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: state.reachMessage)
    }
}
