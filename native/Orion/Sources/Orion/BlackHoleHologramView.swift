import SwiftUI

/// Dashboard-only black-hole visual study. The live voice hologram remains
/// unchanged; this version explores the same state language through an event
/// horizon, warped accretion light, and an organic shadow core.
struct BlackHoleHologramView: View {
    let phase: OrionPhase

    private var accent: Color {
        switch phase {
        case .idle: .cyan
        case .listening: Color(red: 0.20, green: 0.76, blue: 1.0)
        case .thinking: Color(red: 0.72, green: 0.43, blue: 1.0)
        case .speaking: Color(red: 1.0, green: 0.68, blue: 0.26)
        case .error: .red
        }
    }

    private var energy: Double {
        switch phase {
        case .idle: 0.34
        case .listening: 0.62
        case .thinking: 0.47
        case .speaking: 0.84
        case .error: 0.70
        }
    }

    private var horizonSpeed: Double {
        switch phase {
        case .idle: 0.035
        case .listening: 0.23
        case .thinking: 0.09
        case .speaking: 0.31
        case .error: 0.12
        }
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            GeometryReader { proxy in
                let diameter = min(proxy.size.width, proxy.size.height)
                ZStack {
                    Circle()
                        .fill(RadialGradient(
                            colors: [accent.opacity(0.15 * energy), Color.indigo.opacity(0.045), .clear],
                            center: .center, startRadius: diameter * 0.08, endRadius: diameter * 0.56
                        ))
                        .frame(width: diameter * 1.22, height: diameter * 1.22)
                        .blur(radius: 10)

                    // Rear light climbs over the top of the shadow rather than
                    // reading as a flat spinning hoop.
                    ForEach(0..<6, id: \.self) { index in
                        AccretionArc(curve: -0.31 - Double(index) * 0.025)
                            .stroke(
                                LinearGradient(
                                    colors: [.clear, accent.opacity((0.18 + Double(index) * 0.06) * energy), Color.white.opacity(0.32), accent.opacity(0.24 * energy), .clear],
                                    startPoint: .leading, endPoint: .trailing
                                ),
                                style: StrokeStyle(lineWidth: index == 1 ? 2.5 : 1.15, lineCap: .round)
                            )
                            .frame(width: diameter * (1.03 + Double(index) * 0.035), height: diameter * (0.68 + Double(index) * 0.025))
                    }

                    OrganicHorizon(time: time, phase: phase)
                        .fill(RadialGradient(
                            colors: [Color.black, Color(red: 0.005, green: 0.009, blue: 0.018), Color.black.opacity(0.88)],
                            center: .center, startRadius: 0, endRadius: diameter * 0.29
                        ))
                        .frame(width: diameter * 0.60, height: diameter * 0.60)
                        .shadow(color: .black.opacity(0.96), radius: 28)
                        .overlay {
                            OrganicHorizon(time: time, phase: phase)
                                .stroke(accent.opacity(0.22 + 0.24 * energy), lineWidth: 1.1)
                                .frame(width: diameter * 0.60, height: diameter * 0.60)
                        }

                    // A small lower lens makes the gravitational structure
                    // legible without turning it into a huge literal ring.
                    Ellipse()
                        .stroke(accent.opacity(0.24 * energy), lineWidth: 1)
                        .frame(width: diameter * 0.37, height: diameter * 0.105)
                        .offset(y: diameter * 0.245)
                        .blur(radius: 0.3)

                    // Compact front disk, crossing the core and flaring at the
                    // sides so the app constellation still has a clean center.
                    ForEach(0..<6, id: \.self) { index in
                        AccretionArc(curve: 0.10 + Double(index) * 0.028)
                            .stroke(
                                LinearGradient(
                                    colors: [.clear, accent.opacity(0.32 * energy), Color.white.opacity(0.74), accent.opacity((0.36 - Double(index) * 0.04) * energy), .clear],
                                    startPoint: .leading, endPoint: .trailing
                                ),
                                style: StrokeStyle(lineWidth: index == 0 ? 3.0 : 1.2, lineCap: .round)
                            )
                            .frame(width: diameter * (1.06 + Double(index) * 0.025), height: diameter * (0.54 + Double(index) * 0.018))
                            .shadow(color: accent.opacity(0.34 * energy), radius: 7)
                    }

                    // Thinking is a calm loading-like circulation; listening
                    // breathes the rim; speaking adds controlled ferrofluid
                    // texture to the core edge. None of these are orbiting
                    // particles.
                    if phase == .thinking {
                        Circle()
                            .trim(from: 0.08, to: 0.72)
                            .stroke(accent.opacity(0.72), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .frame(width: diameter * 0.70, height: diameter * 0.70)
                            .rotationEffect(.degrees(time * 115))
                    }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

/// A softly lensed light path. Positive curves bow down; negative ones climb
/// over the shadow, creating the characteristic black-hole silhouette.
private struct AccretionArc: Shape {
    let curve: Double

    func path(in rect: CGRect) -> Path {
        let y = rect.midY
        let bow = rect.height * curve
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.02, y: y))
        path.addCurve(
            to: CGPoint(x: rect.maxX - rect.width * 0.02, y: y),
            control1: CGPoint(x: rect.minX + rect.width * 0.30, y: y + bow),
            control2: CGPoint(x: rect.minX + rect.width * 0.70, y: y + bow)
        )
        return path
    }
}

/// A low-amplitude, state-sensitive perimeter. It is a silhouette rather than
/// a particle system, so motion reads as a reacting field around the core.
private struct OrganicHorizon: Shape {
    let time: TimeInterval
    let phase: OrionPhase

    func path(in rect: CGRect) -> Path {
        let centre = CGPoint(x: rect.midX, y: rect.midY)
        let base = min(rect.width, rect.height) * 0.5
        var path = Path()
        for index in 0...96 {
            let fraction = Double(index) / 96
            let angle = fraction * .pi * 2
            let distortion: Double
            switch phase {
            case .idle:
                distortion = 0.008 * sin(angle * 3 + time * 0.7)
            case .listening:
                distortion = 0.006 * sin(angle * 4 + time * 1.2)
            case .thinking:
                distortion = 0.014 * sin(angle * 2 - time * 2.0)
            case .speaking:
                distortion = 0.021 * (
                    sin(angle * 5 + time * 8.0) +
                    0.46 * sin(angle * 9 - time * 13.0)
                )
            case .error:
                distortion = 0.026 * sin(angle * 7 + time * 3.0)
            }
            let radius = base * (1 + distortion)
            let point = CGPoint(x: centre.x + cos(angle) * radius, y: centre.y + sin(angle) * radius)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}
