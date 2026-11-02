import SwiftUI

/// The approved orb-first projection, shared literally by desktop and phone.
/// One 30 Hz canvas keeps the foreground orb and original outer shell in sync.
public struct BalancedOrionHologram: View {
    /// How fast the shell turns relative to the original hologram, and how often it is drawn. Home reads these too,
    /// so Home and the summon panel move alike (wave 13: Nick wanted Home's motion back after wave 12 slowed it).
    public static let motionScale = 0.45
    public static let fps: Double = 30

    public let model: HologramModel
    public var brightness: Double
    public var palette: HoloPalette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: HologramModel, brightness: Double = 2.6, palette: HoloPalette = .gold) {
        self.model = model
        self.brightness = brightness
        self.palette = palette
    }

    public static func orbState(_ state: HologramState) -> OrbState {
        switch state {
        case .idle, .error: .breathing
        case .listening: .listening
        case .thinking: .solving
        case .speaking: .composing
        }
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / Self.fps, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                holoGain = brightness
                model.batchGeometry = true
                model.palette = palette
                model.motionScale = reduceMotion ? 0 : Self.motionScale
                model.targetFrameInterval = 1.0 / Self.fps
                model.tick(timeline.date)
                Self.draw(model: model, in: &context, size: size, brightness: brightness, palette: palette,
                          time: timeline.date.timeIntervalSinceReferenceDate, reduceMotion: reduceMotion)
            }
        }
        .accessibilityHidden(true).allowsHitTesting(false)
    }

    /// One frame of the projection, for any host clock: the shell with the orb drawn on top. Does not tick.
    public static func draw(model: HologramModel, in context: inout GraphicsContext, size: CGSize, brightness: Double,
                            palette: HoloPalette, time: Double, reduceMotion: Bool) {
        model.draw(&context, size: size, cognitiveOnTop: true) { inner in
            OrionThinkingHologram.draw(in: &inner, size: size, state: orbState(model.state),
                level: model.audioLevel, isError: model.state == .error,
                brightness: brightness, time: time,
                reduceMotion: reduceMotion, geometryScale: model.state == .thinking ? 1 : 0.95,
                opacity: model.state == .thinking ? 1 : 0.90, palette: palette)
        }
    }
}
