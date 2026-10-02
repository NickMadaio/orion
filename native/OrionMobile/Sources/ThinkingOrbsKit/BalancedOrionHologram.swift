import SwiftUI

/// The approved orb-first projection, shared literally by desktop and phone.
/// One 30 Hz canvas keeps the foreground orb and original outer shell in sync.
public struct BalancedOrionHologram: View {
    public let model: HologramModel
    public var brightness: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: HologramModel, brightness: Double = 2.6) {
        self.model = model
        self.brightness = brightness
    }

    private var orbState: OrbState {
        switch model.state {
        case .idle, .error: .breathing
        case .listening: .listening
        case .thinking: .solving
        case .speaking: .composing
        }
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                holoGain = brightness
                model.batchGeometry = true
                model.motionScale = reduceMotion ? 0 : 0.45
                model.targetFrameInterval = 1.0 / 30
                model.tick(timeline.date)
                model.draw(&context, size: size, cognitiveOnTop: true) { inner in
                    OrionThinkingHologram.draw(in: &inner, size: size, state: orbState,
                        level: model.audioLevel, isError: model.state == .error,
                        brightness: brightness, time: timeline.date.timeIntervalSinceReferenceDate,
                        reduceMotion: reduceMotion, geometryScale: model.state == .thinking ? 1 : 0.95,
                        opacity: model.state == .thinking ? 1 : 0.90)
                }
            }
        }
        .accessibilityHidden(true).allowsHitTesting(false)
    }
}
