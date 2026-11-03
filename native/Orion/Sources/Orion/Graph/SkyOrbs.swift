import SwiftUI

/// The nodes (wave 14): each a soft glowing orb — a radial halo in its kind's hue, a body that brightens to a near-white
/// core lit from the upper left, and a thin outline ring just outside it. Size is degree; he is the largest and
/// breathes slowly. Recent learning, selection and the return glow sit on top as rings.
@MainActor
enum SkyOrbs {
    static func draw(_ context: GraphicsContext, _ f: SkyFrame) {
        let selected = f.sky.selectedID.flatMap { f.sky.index[$0] }
        for i in f.points.indices where f.sky.visible[i] {
            drawOrb(context, f, i)
            drawMarks(context, f, i, selected: i == selected)
        }
    }

    /// His breath: a slow 6.5 s swell, 0…1.
    static func breath(_ sky: KnowledgeSky) -> Double {
        sky.ambient ? 0.5 - 0.5 * cos(2 * .pi * sky.time / 6.5) : 0.5
    }

    /// The orb's drawn radius this frame: arrival scale, hover lift and (for him) the breath.
    static func radius(_ f: SkyFrame, _ i: Int) -> CGFloat {
        let arrive = 0.55 + 0.45 * f.sky.appear(i)
        let lift = f.sky.hovered == i ? 1.1 : 1
        let swell = f.sky.nodes[i].isSelf ? 1 + 0.05 * breath(f.sky) : 1
        return f.sky.radius(i) * f.scale * CGFloat(arrive * lift * swell)
    }

    private static func drawOrb(_ context: GraphicsContext, _ f: SkyFrame, _ i: Int) {
        let node = f.sky.nodes[i]
        let palette = f.style.palette
        let p = f.points[i]
        let r = radius(f, i)
        let tint = palette.tint(node)
        let lit = f.sky.light[i] * f.sky.appear(i) * (node.hidden == true ? 0.5 : 1) * (node.isGhost ? 0.55 : 1)
        let twinkle = f.sky.ambient ? 0.88 + 0.12 * sin(f.sky.time * f.sky.twinkleSpeed[i] + f.sky.twinklePhase[i]) : 1
        let haloPeak = (palette.isDark ? 0.26 : 0.15) * lit * twinkle
        glow(context, at: p, radius: r * (node.isSelf ? 4.4 : 3.8), color: tint, peak: haloPeak, inner: r * 0.4)
        // The body: lit from the upper left, so it reads as a sphere of light rather than a flat dot.
        let core = palette.isDark ? Color.white : tint
        let light = CGPoint(x: p.x - r * 0.3, y: p.y - r * 0.34)
        let body = Gradient(stops: [
            .init(color: core.opacity(0.95 * lit), location: 0),
            .init(color: tint.opacity(0.92 * lit), location: 0.32),
            .init(color: tint.opacity(0.42 * lit), location: 0.78),
            .init(color: tint.opacity(0.16 * lit), location: 1),
        ])
        context.fill(circle(p, r), with: .radialGradient(body, center: light, startRadius: 0, endRadius: r * 1.3))
        context.stroke(circle(p, r + 1.6), with: .color(tint.opacity(0.5 * lit)), lineWidth: 0.6)
        if node.isHub, let count = node.badge { drawCount(context, count, at: p, lit: lit, dark: palette.isDark) }
        if node.isSelf {
            let b = breath(f.sky)
            context.stroke(circle(p, r * 1.75 + 3 * b), with: .color(tint.opacity((0.16 + 0.1 * b) * lit)), lineWidth: 0.7)
        }
    }

    /// A hub's item count, printed in its body in dark ink.
    private static func drawCount(_ context: GraphicsContext, _ count: Int, at p: CGPoint, lit: Double, dark: Bool) {
        let ink = Color(red: 0.04, green: 0.06, blue: 0.10)
        var layer = context
        layer.opacity = min(1, lit * 1.1)
        layer.draw(layer.resolve(Text("\(count)").font(OrionTheme.mono(9.5, .bold)).foregroundColor(ink)), at: p, anchor: .center)
    }

    private static func drawMarks(_ context: GraphicsContext, _ f: SkyFrame, _ i: Int, selected: Bool) {
        let p = f.points[i]
        let r = radius(f, i)
        let tint = f.style.palette.tint(f.sky.nodes[i])
        let lit = f.sky.light[i] * f.sky.appear(i)
        if f.sky.recent[i] {
            // Learned in the last 36 h: a slow dawn-cyan breath.
            let accent = f.style.palette.color(.person)
            let b = f.sky.ambient ? 0.5 + 0.5 * sin(f.sky.time * 1.5 + f.sky.twinklePhase[i]) : 0.6
            context.stroke(circle(p, r + 5 + 2.5 * b), with: .color(accent.opacity((0.16 + 0.26 * b) * lit)), lineWidth: 0.7)
        }
        if selected && f.style.showSelectionRing {
            glow(context, at: p, radius: r * 2.8, color: tint, peak: 0.24, inner: r)
            context.stroke(circle(p, r + 6), with: .color(tint), lineWidth: 1.2)
        } else if let glowing = f.sky.returnGlow, glowing.index == i {
            context.stroke(circle(p, r + 6), with: .color(tint.opacity(0.8 * glowing.level)), lineWidth: 1.2)
            glow(context, at: p, radius: r * 2.6, color: tint, peak: 0.22 * glowing.level, inner: r)
        }
    }

    static func circle(_ p: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
    }

    static func glow(_ context: GraphicsContext, at p: CGPoint, radius: CGFloat, color: Color, peak: Double, inner: CGFloat) {
        guard peak > 0.003 else { return }
        let fade = Gradient(stops: [.init(color: color.opacity(peak), location: 0),
                                    .init(color: color.opacity(peak * 0.35), location: 0.45),
                                    .init(color: color.opacity(0), location: 1)])
        context.fill(circle(p, radius), with: .radialGradient(fade, center: p, startRadius: inner, endRadius: radius))
    }
}
