import SwiftUI
import ThinkingOrbsKit

struct HologramView: View {
    let model: HologramModel
    var style: String? = nil
    @AppStorage("orion.dashboard.coreStyle") private var chosenStyle = "thinkingOrion"
    private var phase: OrionPhase {
        switch model.state { case .idle: .idle; case .listening: .listening; case .thinking: .thinking; case .speaking: .speaking; case .error: .error }
    }
    var body: some View {
        Group {
            if (style ?? chosenStyle) == "original" {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in holoGain = SummonSettings.brightness; model.batchGeometry = false; model.motionScale = 1; model.targetFrameInterval = 1.0 / 60; model.tick(timeline.date); model.draw(&context, size: size) }
                }
            } else if (style ?? chosenStyle) == "blackHole" {
                BlackHoleHologramView(phase: phase)
            } else {
                BalancedOrionHologram(model: model, brightness: SummonSettings.brightness)
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
