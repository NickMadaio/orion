import SwiftUI

/// What the renderer needs besides the model: colours, and two facts from the surrounding view.
struct SkyStyle {
    var palette: KnowledgePalette
    /// False while the selection ring is still on the list row or flying to the node (a SwiftUI overlay owns it then).
    var showSelectionRing = true
    var searchActive = false
}

/// Draws the whole graph into one Canvas, in painter's order: the breath around Nick, resting threads (batched into
/// two paths), ignited threads, photon pulses, stars, then labels and the hover card (`SkyLabels`).
///
/// No blur anywhere: every glow is a radial gradient. Everything is line-art and light, no plates, so the window's
/// real alpha shows through between the marks.
@MainActor
enum SkyRenderer {
    static func draw(_ context: GraphicsContext, sky: KnowledgeSky, size: CGSize, style: SkyStyle) {
        guard let physics = sky.physics, !sky.nodes.isEmpty, physics.ids.count == sky.nodes.count else { return }
        let points = physics.ids.indices.map { sky.camera.screen(physics.point($0), in: size) }
        let frame = SkyFrame(sky: sky, points: points, scale: sky.starScale, style: style, size: size)
        drawBreath(context, frame)
        drawThreads(context, frame)
        drawPulses(context, frame)
        drawStars(context, frame)
        SkyLabels.draw(context, frame)
    }

    // MARK: Breath

    /// A luminance wave around him about every 11 s.
    private static func drawBreath(_ context: GraphicsContext, _ f: SkyFrame) {
        guard let me = f.sky.index["person:self"], f.sky.visible[me] else { return }
        let w = f.sky.ambient ? 0.5 - 0.5 * cos(2 * .pi * f.sky.time / 11) : 0.35
        let p = f.points[me]
        let reach = (58 + 34 * w) * f.scale
        let tint = f.style.palette.color(.person)
        let peak = (f.style.palette.isDark ? 0.05 + 0.07 * w : 0.04 + 0.05 * w) * f.sky.starReveal
        let disc = Path(ellipseIn: CGRect(x: p.x - reach, y: p.y - reach, width: reach * 2, height: reach * 2))
        context.fill(disc, with: .radialGradient(Gradient(colors: [tint.opacity(peak), tint.opacity(peak * 0.4), tint.opacity(0)]),
                                                 center: p, startRadius: 0, endRadius: reach))
    }

    // MARK: Threads

    private static func drawThreads(_ context: GraphicsContext, _ f: SkyFrame) {
        let reveal = f.sky.threadReveal
        guard reveal > 0.001 else { return }
        var solid = Path(), dashed = Path()
        var lit: [Int] = []
        for (e, link) in f.sky.links.enumerated() where f.sky.visible[link.a] && f.sky.visible[link.b] {
            if f.sky.ignite[e] > 0.02 { lit.append(e) }
            if f.sky.ignite[e] > 0.98 { continue }
            let (a, c, b) = f.curve(link)
            if link.dashed { dashed.move(to: a); dashed.addQuadCurve(to: b, control: c) } else { solid.move(to: a); solid.addQuadCurve(to: b, control: c) }
        }
        let rest = f.style.palette.edge.opacity(reveal * (1 - 0.62 * f.sky.dim))
        context.stroke(solid, with: .color(rest), style: StrokeStyle(lineWidth: 0.6, lineCap: .round))
        context.stroke(dashed, with: .color(rest), style: StrokeStyle(lineWidth: 0.6, lineCap: .round, dash: [2, 3]))
        // Ignite: kind-to-kind gradients, a wide faint underlay and a fine core.
        for e in lit {
            let link = f.sky.links[e]
            let (a, c, b) = f.curve(link)
            var path = Path()
            path.move(to: a); path.addQuadCurve(to: b, control: c)
            let level = f.sky.ignite[e] * reveal
            let ca = f.style.palette.color(f.sky.nodes[link.a].kind), cb = f.style.palette.color(f.sky.nodes[link.b].kind)
            context.stroke(path, with: .linearGradient(Gradient(colors: [ca.opacity(0.28 * level), cb.opacity(0.28 * level)]), startPoint: a, endPoint: b),
                           style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
            context.stroke(path, with: .linearGradient(Gradient(colors: [ca.opacity(0.9 * level), cb.opacity(0.9 * level)]), startPoint: a, endPoint: b),
                           style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
        }
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
            context.fill(Path(ellipseIn: CGRect(x: head.x - r, y: head.y - r, width: r * 2, height: r * 2)),
                         with: .radialGradient(Gradient(colors: [ink.opacity(0.75 * envelope), ink.opacity(0)]), center: head, startRadius: 0, endRadius: r))
        }
    }

    // MARK: Stars

    private static func drawStars(_ context: GraphicsContext, _ f: SkyFrame) {
        let selected = f.sky.selectedID.flatMap { f.sky.index[$0] }
        let accent = f.style.palette.color(.person)
        for i in f.points.indices where f.sky.visible[i] {
            let node = f.sky.nodes[i]
            let p = f.points[i]
            let hovered = f.sky.hovered == i
            let r = f.sky.radius(i) * f.scale * (hovered ? 1.08 : 1)
            let tint = f.style.palette.color(node.kind)
            let lit = f.sky.light[i] * f.sky.starReveal
            let twinkle = f.sky.ambient ? 0.86 + 0.14 * sin(f.sky.time * f.sky.twinkleSpeed[i] + f.sky.twinklePhase[i]) : 1
            let haloPeak = (f.style.palette.isDark ? 0.16 : 0.10) * lit * twinkle
            glow(context, at: p, radius: r * 3.6, color: tint, peak: haloPeak, inner: r * 0.6)
            let body = circle(p, r)
            context.fill(body, with: .color(tint.opacity(0.07 * lit)))
            context.stroke(body, with: .color(tint.opacity((node.hidden == true ? 0.35 : 0.9) * lit)), lineWidth: node.isSelf ? 1.6 : 1.1)
            context.fill(circle(p, max(1.2, r * 0.275)), with: .color(tint.opacity(lit * twinkle)))
            if node.isSelf {
                context.stroke(circle(p, r * 1.7), with: .color(tint.opacity(0.28 * lit)), lineWidth: 0.8)
            }
            if f.sky.recent[i] {
                // Learned in the last 36 h: a slow dawn-cyan breath.
                let b = f.sky.ambient ? 0.5 + 0.5 * sin(f.sky.time * 1.5 + f.sky.twinklePhase[i]) : 0.6
                context.stroke(circle(p, r + 4 + 2.5 * b), with: .color(accent.opacity((0.18 + 0.3 * b) * lit)), lineWidth: 0.8)
                glow(context, at: p, radius: r * 2.8, color: accent, peak: 0.10 * b * lit, inner: r)
            }
            if i == selected && f.style.showSelectionRing {
                glow(context, at: p, radius: r * 2.6, color: tint, peak: 0.26, inner: r)
                context.stroke(circle(p, r + 6), with: .color(tint), lineWidth: 1.2)
            } else if let glowing = f.sky.returnGlow, glowing.index == i {
                context.stroke(circle(p, r + 6), with: .color(tint.opacity(0.8 * glowing.level)), lineWidth: 1.2)
                glow(context, at: p, radius: r * 2.6, color: tint, peak: 0.22 * glowing.level, inner: r)
            }
        }
    }

    static func circle(_ p: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
    }

    private static func glow(_ context: GraphicsContext, at p: CGPoint, radius: CGFloat, color: Color, peak: Double, inner: CGFloat) {
        guard peak > 0.003 else { return }
        context.fill(circle(p, radius), with: .radialGradient(Gradient(colors: [color.opacity(peak), color.opacity(0)]),
                                                              center: p, startRadius: inner, endRadius: radius))
    }
}

/// One frame's derived values, shared by the renderer and the labels.
@MainActor
struct SkyFrame {
    let sky: KnowledgeSky
    let points: [CGPoint]
    let scale: CGFloat
    let style: SkyStyle
    let size: CGSize

    /// A link as a bowed quadratic: start, control, end.
    func curve(_ link: KnowledgeSky.Link) -> (CGPoint, CGPoint, CGPoint) {
        let a = points[link.a], b = points[link.b]
        let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
        let nx = -(b.y - a.y), ny = b.x - a.x
        let len = max(hypot(nx, ny), 1)
        return (a, CGPoint(x: mid.x + nx / len * link.bow, y: mid.y + ny / len * link.bow), b)
    }

    static func bezier(_ a: CGPoint, _ c: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        let u = 1 - t
        return CGPoint(x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y)
    }
}
