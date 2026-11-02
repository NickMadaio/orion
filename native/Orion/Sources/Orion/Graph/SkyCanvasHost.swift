import SwiftUI

/// The one renderer: a `TimelineView` driving a single `Canvas`. The model steps inside the Canvas closure, so a frame
/// costs one physics step and one draw — no published state, no view per node, no diff.
///
/// The clock pauses when the tab or window cannot be seen, and — when idle life is off (Reduce Motion, Low Power) —
/// as soon as the sky is still. With idle life on, a still sky drops to 30 fps. `KnowledgeSky.time` only advances while ticking, so a pause resumes from the same phase.
struct SkyCanvasHost: View {
    let sky: KnowledgeSky
    @ObservedObject var invalidator: SkyInvalidator
    let style: SkyStyle
    /// The tab is on screen and its window is visible.
    let active: Bool
    /// Idle animation is allowed (not Reduce Motion, not Low Power).
    let ambient: Bool

    var body: some View {
        let paused = !active || (!ambient && invalidator.calm)
        // At rest only the slow drift and twinkle move: 30 fps is plenty and halves the idle cost.
        TimelineView(.animation(minimumInterval: invalidator.calm ? 1.0 / 30 : nil, paused: paused)) { timeline in
            Canvas { context, size in
                sky.tick(timeline.date, size: size)
                SkyRenderer.draw(context, sky: sky, size: size, style: style)
            }
        }
    }
}

/// A still of the sky as it stands, without ticking: renders and render tests.
struct SkyStill: View {
    let sky: KnowledgeSky
    let style: SkyStyle

    var body: some View {
        Canvas { context, size in SkyRenderer.draw(context, sky: sky, size: size, style: style) }
    }
}
