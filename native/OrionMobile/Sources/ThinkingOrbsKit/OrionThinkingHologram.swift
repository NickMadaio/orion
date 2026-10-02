import SwiftUI

/// ORION's gold projection rendered from Thinking Orbs' semantic geometry.
/// The upstream engine remains unchanged; this painter adds colour, an orbital
/// shell, depth and audio response at the full hologram size.
public struct OrionThinkingHologram: View {
    public var state: OrbState
    public var level: Double
    public var isError: Bool
    public var frameTime: Double?
    public var brightness: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init(state: OrbState, level: Double = 0, isError: Bool = false, brightness: Double = 1, frameTime: Double? = nil) {
        self.state = state; self.level = level; self.isError = isError; self.brightness = brightness; self.frameTime = frameTime
    }
    private var accent: Color {
        if isError { return Color(red: 1, green: 0.22, blue: 0.20) }
        switch state {
        case .solving, .searching, .weaving: return Color(red: 0.82, green: 0.60, blue: 1)
        case .listening: return Color(red: 1, green: 0.81, blue: 0.43)
        default: return Color(red: 1, green: 0.69, blue: 0.27)
        }
    }
    public var body: some View {
        Group {
            if let frameTime { frame(at: frameTime) }
            else { TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in frame(at: timeline.date.timeIntervalSinceReferenceDate) } }
        }.accessibilityLabel("ORION \(state.label)").allowsHitTesting(false)
    }
    private func frame(at time: Double) -> some View {
            let t = reduceMotion ? 1.2 : time
            let energy = level.isFinite ? min(1, max(0, level)) : 0
            return Canvas { context, size in
                let side = min(size.width, size.height)
                let centre = CGPoint(x: size.width / 2, y: size.height / 2)
                let pulse = reduceMotion ? 1 : 1 + 0.045 * sin(t * 1.5) + 0.09 * energy
                let radius = side * 0.37 * pulse
                context.opacity = min(1, max(0.05, brightness / 2.6))
                // Elliptical orbital planes retain the projected shell identity.
                for i in 0..<3 {
                    let angle = reduceMotion ? Double(i) * 1.04 : t * 0.1 + Double(i) * 1.04
                    var shell = context
                    shell.translateBy(x: centre.x, y: centre.y)
                    shell.rotate(by: .radians(angle))
                    let ellipse = Path(ellipseIn: CGRect(x: -radius, y: -radius * 0.30, width: radius * 2, height: radius * 0.60))
                    shell.stroke(ellipse, with: .color(accent.opacity(0.12 + 0.12 * energy)), lineWidth: max(0.5, side / 350))
                }
                let preset = resolvePreset(state, .px64)
                let frame = orbFrame(preset, size: 64, t: t * preset.speed)
                let zoom = side * 0.82 / 64 * pulse
                func point(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: centre.x + (x-32)*zoom, y: centre.y + (y-32)*zoom) }
                for edge in frame.lines {
                    var path = Path(); path.move(to: point(edge.x1, edge.y1)); path.addLine(to: point(edge.x2, edge.y2))
                    context.stroke(path, with: .color(accent.opacity(max(0, min(1, (1-edge.white)*edge.a)))), lineWidth: max(0.4, edge.w * zoom))
                }
                for dot in frame.dots {
                    let p = point(dot.x, dot.y), r = max(0.35, dot.r * zoom * 0.65)
                    let alpha = max(0, min(1, (1-dot.white)*dot.a))
                    context.fill(Path(ellipseIn: CGRect(x:p.x-r,y:p.y-r,width:r*2,height:r*2)), with: .color(accent.opacity(alpha)))
                }
            }
            .shadow(color: accent.opacity(0.25 + energy * 0.25), radius: 7 + energy * 7)
    }
}
