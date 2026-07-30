import SwiftUI

/// The hologram surface.
///
/// `TimelineView(.animation)` ticks at the display refresh rate and is the only
/// thing that drives the model forward — there is no timer and no Combine
/// pipeline, so when the panel is hidden the whole thing costs nothing.
///
/// `Canvas` re-invokes the renderer on every tick, so advancing the simulation
/// inside the closure is intentional: the model is a plain class SwiftUI does
/// not observe, so this is not "mutating state during view update" in the sense
/// SwiftUI warns about.
struct HologramView: View {
    let model: HologramModel

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas(opaque: false, rendersAsynchronously: false) { context, size in
                model.tick(timeline.date)
                model.draw(&context, size: size)
            }
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}
