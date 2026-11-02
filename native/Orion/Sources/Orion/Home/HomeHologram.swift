import OrionViews
import SwiftUI
import ThinkingOrbsKit

/*
 The hologram, back on Home as atmosphere (wave 12, U5). Nick: "lastly the hologram on the home page".

 The same orb-first projection the summon panel draws (BalancedOrionHologram), but on Home's terms:
   · slow — a third of its normal motion, 20 frames a second;
   · on the shared AmbientTimeline, so it stands still (holding its phase) when the window is hidden, minimised or
     covered, in Low Power Mode and under Reduce Motion. BalancedOrionHologram pauses only for Reduce Motion;
   · one Canvas, no blur, no compositing pass. The model is a plain class SwiftUI does not observe, so a frame
     re-runs the Canvas closure and nothing else;
   · it draws AppState's own model, so it follows ORION's state: it listens, thinks and speaks with him.
 Dimming and placement are HomeScene's job; this view only draws.
*/

struct HomeHologram: View {
    let model: HologramModel
    /// Renders only: draw this moment of the orb, without a timeline.
    var frozenTime: Double?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let fps: Double = 20
    static let motionScale = 0.3

    var body: some View {
        Group {
            if let frozenTime {
                canvas(time: frozenTime, ticking: false)
            } else {
                AmbientTimeline(fps: Self.fps) { time in canvas(time: time, ticking: true) }
            }
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }

    private func canvas(time: Double, ticking: Bool) -> some View {
        Canvas { context, size in
            let brightness = SummonSettings.brightness
            holoGain = brightness
            model.batchGeometry = true
            model.motionScale = reduceMotion ? 0 : Self.motionScale
            model.targetFrameInterval = 1 / Self.fps
            // Real time, not the ambient clock: the panel ticks this model too, and both must agree on dt. The model
            // clamps a long gap (a pause) to one short step, so resuming does not jump.
            if ticking { model.tick(Date()) }
            model.draw(&context, size: size, cognitiveOnTop: true) { inner in
                OrionThinkingHologram.draw(in: &inner, size: size, state: Self.orbState(model.state), level: model.audioLevel,
                                           isError: model.state == .error, brightness: brightness, time: time,
                                           reduceMotion: reduceMotion, geometryScale: model.state == .thinking ? 1 : 0.95,
                                           opacity: model.state == .thinking ? 1 : 0.9)
            }
        }
    }

    static func orbState(_ state: HologramState) -> OrbState {
        switch state {
        case .idle, .error: .breathing
        case .listening: .listening
        case .thinking: .solving
        case .speaking: .composing
        }
    }

    /// Renders only: a fresh model advanced `seconds` of slow Home motion, so two renders show two phases.
    static func advanced(by seconds: Double, state: HologramState = .idle) -> HologramModel {
        let model = HologramModel()
        model.setState(state)
        model.motionScale = motionScale
        let start = Date(timeIntervalSinceReferenceDate: 800_000_000)
        for frame in 0...Int(seconds * fps) { model.tick(start.addingTimeInterval(Double(frame) / fps)) }
        return model
    }
}

/// Where the hologram sits on Home and how loud it is, from how many cards there are. Pure, so it is tested.
struct HomeHologramPlacement: Equatable {
    /// Centre, as a fraction of the scene.
    let centre: UnitPoint
    /// Diameter, as a fraction of the scene's height (capped at 80% of its width).
    let diameter: CGFloat
    let opacity: Double

    /// Few cards: the orb fills the empty field below the spread. Many: it sits behind them, lower and dimmer.
    static func forCards(_ count: Int) -> HomeHologramPlacement {
        switch count {
        // Measured on 1440×900 renders: the glance row sits at ~0.86 of the scene, so the ring stops by ~0.84.
        // Empty: lower than centre, so the spread's one calm line sits above the ring rather than across the orb.
        case 0: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.6), diameter: 0.52, opacity: 0.78)
        case 1...2: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.52, opacity: 0.72)
        case 3: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.52, opacity: 0.5)
        default: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.72, opacity: 0.3)
        }
    }

    func frame(in size: CGSize) -> CGRect {
        let side = min(size.height * diameter, size.width * 0.8)
        return CGRect(x: size.width * centre.x - side / 2, y: size.height * centre.y - side / 2, width: side, height: side)
    }
}
