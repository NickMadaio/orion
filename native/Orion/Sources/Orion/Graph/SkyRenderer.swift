import SwiftUI

/// What the renderer needs besides the model: colours, and two facts from the surrounding view.
struct SkyStyle {
    var palette: KnowledgePalette
    /// False while the selection ring is still on the list row or flying to the node (a SwiftUI overlay owns it then).
    var showSelectionRing = true
    var searchActive = false
}

/// Draws the whole graph into one Canvas, in painter's order: the breath around Nick, threads, photon pulses, orbs
/// (`SkyOrbs`), then labels and the hover card (`SkyLabels`).
///
/// No blur anywhere: every glow is a radial gradient. Everything is line-art and light, no plates, so the window's
/// real alpha shows through between the marks.
///
/// Wave 14: threads are curved hairlines that run from orb rim to orb rim with a gradient between the two kinds'
/// hues, brightening on hover. During the entrance each one draws from its inner end outward, a small spark at its
/// tip, and only after both its nodes have landed — so a thread never redraws while its ends move.
@MainActor
enum SkyRenderer {
    static func draw(_ context: GraphicsContext, sky: KnowledgeSky, size: CGSize, style: SkyStyle) {
        guard let physics = sky.physics, !sky.nodes.isEmpty, physics.ids.count == sky.nodes.count else { return }
        let points = physics.ids.indices.map { sky.camera.screen(sky.displayPoint($0), in: size) }
        let rest = physics.ids.indices.map { sky.camera.screen(sky.restPoint($0), in: size) }
        let frame = SkyFrame(sky: sky, points: points, restPoints: rest, scale: sky.starScale, style: style, size: size)
        drawBreath(context, frame)
        drawThreads(context, frame)
        drawPulses(context, frame)
        SkyOrbs.draw(context, frame)
        SkyLabels.draw(context, frame)
    }

    // MARK: Breath

    /// A luminance wave around him about every 11 s.
    private static func drawBreath(_ context: GraphicsContext, _ f: SkyFrame) {
        guard let me = f.sky.index["person:self"], f.sky.visible[me] else { return }
        let w = f.sky.ambient ? 0.5 - 0.5 * cos(2 * .pi * f.sky.time / 11) : 0.35
        let p = f.points[me]
        let reach = (64 + 36 * w) * f.scale
        let tint = f.style.palette.color(.person)
        let peak = (f.style.palette.isDark ? 0.05 + 0.07 * w : 0.04 + 0.05 * w) * f.sky.appear(me)
        context.fill(SkyOrbs.circle(p, reach), with: .radialGradient(Gradient(colors: [tint.opacity(peak), tint.opacity(peak * 0.4), tint.opacity(0)]),
                                                                     center: p, startRadius: 0, endRadius: reach))
    }

    // MARK: Threads

    private static func drawThreads(_ context: GraphicsContext, _ f: SkyFrame) {
        let palette = f.style.palette
        let restPeak = (palette.isDark ? 0.20 : 0.26) * (1 - 0.62 * f.sky.dim)
        for (e, link) in f.sky.links.enumerated() where f.sky.visible[link.a] && f.sky.visible[link.b] {
            let reveal = f.sky.edgeReveal(e)
            guard reveal > 0.002 else { continue }
            let ignite = f.sky.ignite[e]
            let (a, c, b) = f.curve(link)
            let reversed = f.sky.entrance?.edgeReversed[e] ?? false
            var path = Path()
            if reversed { path.move(to: b); path.addQuadCurve(to: a, control: c) } else { path.move(to: a); path.addQuadCurve(to: b, control: c) }
            if reveal < 1 { path = path.trimmedPath(from: 0, to: reveal) }
            let ca = palette.color(f.sky.nodes[link.a].kind), cb = palette.color(f.sky.nodes[link.b].kind)
            let level = restPeak + (0.9 - restPeak) * ignite
            let shade = Gradient(colors: [ca.opacity(level), cb.opacity(level)])
            if ignite > 0.02 {
                context.stroke(path, with: .linearGradient(Gradient(colors: [ca.opacity(0.24 * ignite), cb.opacity(0.24 * ignite)]), startPoint: a, endPoint: b),
                               style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
            }
            let width = 0.65 + 0.55 * ignite
            let stroke = link.dashed && ignite < 0.5
                ? StrokeStyle(lineWidth: width, lineCap: .round, dash: [2, 3])
                : StrokeStyle(lineWidth: width, lineCap: .round)
            context.stroke(path, with: .linearGradient(shade, startPoint: a, endPoint: b), style: stroke)
            if reveal < 1 { drawTip(context, f, a: reversed ? b : a, c: c, b: reversed ? a : b, t: reveal, color: reversed ? ca : cb) }
        }
    }

    /// The spark at a thread's drawing end, fading as the thread completes.
    private static func drawTip(_ context: GraphicsContext, _ f: SkyFrame, a: CGPoint, c: CGPoint, b: CGPoint, t: Double, color: Color) {
        let head = SkyFrame.bezier(a, c, b, t)
        let fade = sin(.pi * min(1, t)) * 0.7
        let r: CGFloat = 3.5
        context.fill(SkyOrbs.circle(head, r), with: .radialGradient(Gradient(colors: [color.opacity(fade), color.opacity(0)]),
                                                                    center: head, startRadius: 0, endRadius: r))
    }

    // MARK: Pulses

    /// A 13%-long trail that brightens and fades along its run, with a small radial head.
    private static func drawPulses(_ context: GraphicsContext, _ f: SkyFrame) {
        let ink = f.style.palette.isDark ? Color.white : f.style.palette.color(.person)
        for pulse in f.sky.pulses {
            let link = f.sky.links[pulse.link]
            guard f.sky.visible[link.a], f.sky.visible[link.b] else { continue }
            let progress = min(1, max(0, (f.sky.time - pulse.start) / pulse.duration))
            let envelope = sin(.pi * progress) * (1 - 0.62 * f.sky.dim)
            let (a, c, b) = f.curve(link)
            let tail = max(0, progress - 0.13)
            var trail = Path()
            let samples = 8
            for s in 0...samples {
                let t = tail + (progress - tail) * Double(s) / Double(samples)
                let q = SkyFrame.bezier(a, c, b, t)
                if s == 0 { trail.move(to: q) } else { trail.addLine(to: q) }
            }
            let from = SkyFrame.bezier(a, c, b, tail), head = SkyFrame.bezier(a, c, b, progress)
            context.stroke(trail, with: .linearGradient(Gradient(colors: [ink.opacity(0), ink.opacity(0.55 * envelope)]), startPoint: from, endPoint: head),
                           style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
            let r: CGFloat = 5
            context.fill(SkyOrbs.circle(head, r),
                         with: .radialGradient(Gradient(colors: [ink.opacity(0.75 * envelope), ink.opacity(0)]), center: head, startRadius: 0, endRadius: r))
        }
    }
}

/// One frame's derived values, shared by the renderer, the orbs and the labels.
@MainActor
struct SkyFrame {
    let sky: KnowledgeSky
    /// Where each node is drawn (with drift).
    let points: [CGPoint]
    /// Where each node stands without drift: label and card placement read these, so they never flicker.
    let restPoints: [CGPoint]
    let scale: CGFloat
    let style: SkyStyle
    let size: CGSize

    /// A link as a bowed quadratic from orb rim to orb rim: start, control, end.
    func curve(_ link: KnowledgeSky.Link) -> (CGPoint, CGPoint, CGPoint) {
        let a0 = points[link.a], b0 = points[link.b]
        let mid = CGPoint(x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2)
        let nx = -(b0.y - a0.y), ny = b0.x - a0.x
        let len = max(hypot(nx, ny), 1)
        let c = CGPoint(x: mid.x + nx / len * link.bow, y: mid.y + ny / len * link.bow)
        return (Self.rim(a0, toward: c, by: sky.radius(link.a) * scale + 1.5), c, Self.rim(b0, toward: c, by: sky.radius(link.b) * scale + 1.5))
    }

    private static func rim(_ p: CGPoint, toward c: CGPoint, by r: CGFloat) -> CGPoint {
        let dx = c.x - p.x, dy = c.y - p.y
        let d = hypot(dx, dy)
        guard d > r * 2 else { return p }
        return CGPoint(x: p.x + dx / d * r, y: p.y + dy / d * r)
    }

    static func bezier(_ a: CGPoint, _ c: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        SkyEntrance.bezier(a, c, b, t)
    }
}
