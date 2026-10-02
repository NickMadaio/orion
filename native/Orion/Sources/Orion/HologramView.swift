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
                    Canvas { context, size in model.batchGeometry = false; model.motionScale = 1; model.targetFrameInterval = 1.0 / 60; model.tick(timeline.date); model.draw(&context, size: size) }
                }
            } else if (style ?? chosenStyle) == "blackHole" {
                BlackHoleHologramView(phase: phase)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
                    Canvas { context, size in
                        model.batchGeometry = true
                        model.motionScale = 0.45; model.targetFrameInterval = 1.0 / 30
                        model.tick(timeline.date)
                        model.draw(&context, size: size) { inner in
                            OrionThinkingHologram.draw(in: &inner, size: size, state: orbState,
                                level: model.audioLevel, isError: model.state == .error,
                                brightness: holoGain, time: timeline.date.timeIntervalSinceReferenceDate,
                                reduceMotion: reduceMotion, geometryScale: 0.78, opacity: 0.65)
                        }
                    }
                }
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
