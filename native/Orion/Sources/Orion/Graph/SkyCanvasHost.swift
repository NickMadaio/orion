import SwiftUI

/// The one renderer: a `TimelineView` driving a single `Canvas`. The model steps inside the Canvas closure, so a frame
/// costs one physics step and one draw — no published state, no view per node, no diff.
///
/// The clock pauses when the tab or window cannot be seen, and — when idle life is off (Reduce Motion, Low Power) —
/// as soon as the sky is still. `KnowledgeSky.time` only advances while ticking, so a pause resumes from the same phase.
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
        TimelineView(.animation(minimumInterval: nil, paused: paused)) { timeline in
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

/// Outline glyphs under the graph: zoom out, the percentage, zoom in, recentre. Observes only the readout, so a
/// pinch re-renders these four glyphs and nothing else.
struct SkyZoomControls: View {
    @ObservedObject var readout: SkyReadout
    let palette: KnowledgePalette
    let onZoom: (CGFloat) -> Void
    let onHome: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            button("minus") { onZoom(1 / 1.25) }
            Text("\(readout.zoomPercent)%").font(OrionTheme.mono(9)).foregroundStyle(palette.textDim).frame(width: 34)
                .contentTransition(.numericText())
            button("plus") { onZoom(1.25) }
            button("scope", action: onHome)
        }
        .padding(.trailing, 18).padding(.bottom, 14)
    }

    private func button(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(palette.textSoft)
                .frame(width: 18, height: 18).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
