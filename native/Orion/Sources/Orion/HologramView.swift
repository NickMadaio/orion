import SwiftUI
import ThinkingOrbsKit

struct HologramView: View {
    let model: HologramModel
    var style: String? = nil
    @AppStorage("orion.dashboard.coreStyle") private var chosenStyle = "thinkingOrion"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var orbState: OrbState {
        switch model.state { case .idle: .breathing; case .listening: .listening; case .thinking: .solving; case .speaking: .composing; case .error: .breathing }
    }
    private var phase: OrionPhase {
        switch model.state { case .idle: .idle; case .listening: .listening; case .thinking: .thinking; case .speaking: .speaking; case .error: .error }
    }
    var body: some View {
        Group {
            if (style ?? chosenStyle) == "original" {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in model.tick(timeline.date); model.draw(&context, size: size) }
                }
            } else if (style ?? chosenStyle) == "blackHole" {
                BlackHoleHologramView(phase: phase)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
                    let _ = model.tick(timeline.date)
                    OrionThinkingHologram(state: orbState, level: model.audioLevel, isError: model.state == .error, brightness: holoGain, frameTime: timeline.date.timeIntervalSinceReferenceDate)
                }
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
