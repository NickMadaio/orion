import OrionViews
import SwiftUI
import ThinkingOrbsKit

/*
 The hologram, back on Home as atmosphere (wave 12, U5). Nick: "lastly the hologram on the home page".

 Whichever Visual Nick picked in Settings → Core (wave 13: Home used to ignore it and always drew Thinking Orion):
   · Thinking Orion and Blue Orion: the summon panel's orb-first projection (BalancedOrionHologram), at its motion
     and frame rate. Wave 12 slowed Home to 0.3 at 20 fps; Nick: "can we make the hologram move like it used to?";
   · Original Orion: the full filament shell at 60 fps, as the panel draws it;
   · Black Hole: BlackHoleHologramView.
 All on the shared AmbientTimeline, so it stands still (holding its phase) when the window is hidden or minimised and
 under Reduce Motion, and costs nothing in the background. Low Power Mode slows it rather than freezing it (wave 14:
 Nick saw it "not moving" for a whole day on battery at 5% with Low Power on). One Canvas, no blur, no
 compositing pass. The model is a plain class SwiftUI does not observe, so a frame re-runs the Canvas closure and
 nothing else. It draws AppState's own model, so it follows ORION's state: it listens, thinks and speaks with him.
 Dimming and placement are HomeScene's job; this view only draws.
*/

struct HomeHologram: View {
    let model: HologramModel
    /// Renders only: draw this moment of the orb, without a timeline.
    var frozenTime: Double?
    /// Renders and tests only: draw this style instead of the stored one.
    var styleOverride: HologramStyle?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.ambientThrottled) private var throttled
    @AppStorage(HologramStyle.storageKey) private var storedStyle = HologramStyle.thinkingOrion.rawValue

    static let fps: Double = BalancedOrionHologram.fps
    static let motionScale = BalancedOrionHologram.motionScale
    /// The original shell's own rate, as HologramView draws it.
    static let originalFps: Double = 60

    private var style: HologramStyle { styleOverride ?? HologramStyle(stored: storedStyle) }

    var body: some View {
        Group {
            switch style {
            case .blackHole:
                BlackHoleHologramView(phase: Self.phase(model.state), frozenTime: frozenTime)
            case .original:
                clocked(fps: Self.originalFps) { time, ticking in original(ticking: ticking) }
            case let thinking:
                clocked(fps: Self.fps) { time, ticking in projection(time: time, ticking: ticking, palette: thinking.palette) }
            }
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func clocked<Content: View>(fps: Double, @ViewBuilder _ content: @escaping (Double, Bool) -> Content) -> some View {
        if let frozenTime {
            content(frozenTime, false)
        } else {
            AmbientTimeline(fps: AmbientPolicy.frameRate(fps, throttled: throttled)) { time in content(time, true) }
        }
    }

    private func projection(time: Double, ticking: Bool, palette: HoloPalette) -> some View {
        Canvas { context, size in
            let brightness = SummonSettings.brightness
            holoGain = brightness
            model.batchGeometry = true
            model.palette = palette
            model.motionScale = reduceMotion ? 0 : Self.motionScale
            // The throttled rate, or the model's auto-quality would read Low Power as a slow GPU and drop detail for good.
            model.targetFrameInterval = 1 / AmbientPolicy.frameRate(Self.fps, throttled: throttled)
            // Real time, not the ambient clock: the panel ticks this model too, and both must agree on dt. The model
            // clamps a long gap (a pause) to one short step, so resuming does not jump.
            if ticking { model.tick(Date()) }
            BalancedOrionHologram.draw(model: model, in: &context, size: size, brightness: brightness, palette: palette,
                                       time: time, reduceMotion: reduceMotion)
        }
    }

    private func original(ticking: Bool) -> some View {
        Canvas { context, size in
            holoGain = SummonSettings.brightness
            model.batchGeometry = false
            model.palette = .gold
            model.motionScale = reduceMotion ? 0 : 1
            model.targetFrameInterval = 1 / AmbientPolicy.frameRate(Self.originalFps, throttled: throttled)
            if ticking { model.tick(Date()) }
            model.draw(&context, size: size)
        }
    }

    static func orbState(_ state: HologramState) -> OrbState { BalancedOrionHologram.orbState(state) }

    static func phase(_ state: HologramState) -> OrionPhase {
        switch state { case .idle: .idle; case .listening: .listening; case .thinking: .thinking; case .speaking: .speaking; case .error: .error }
    }

    /// Renders only: a fresh model advanced `seconds` of Home motion, so two renders show two phases.
    static func advanced(by seconds: Double, state: HologramState = .idle, palette: HoloPalette = .gold) -> HologramModel {
        let model = HologramModel()
        model.setState(state)
        model.batchGeometry = true
        model.palette = palette
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
        case 0: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.6), diameter: 0.52, opacity: 0.95)
        case 1...2: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.52, opacity: 0.92)
        case 3: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.52, opacity: 0.7)
        default: HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.72, opacity: 0.45)
        }
    }

    func frame(in size: CGSize) -> CGRect {
        let side = min(size.height * diameter, size.width * 0.8)
        return CGRect(x: size.width * centre.x - side / 2, y: size.height * centre.y - side / 2, width: side, height: side)
    }
}
