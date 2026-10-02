import SwiftUI
import ThinkingOrbsKit

enum OrbMood: Equatable {
    case idle, listening, thinking, speaking, working
    var text: String {
        switch self { case .idle: "ready"; case .listening: "listening"; case .thinking: "thinking"; case .speaking: "speaking"; case .working: "working" }
    }
    var state: OrbState {
        switch self { case .idle: .breathing; case .listening: .listening; case .thinking: .solving; case .speaking: .composing; case .working: .working }
    }
    init(voice: PhoneVoice.Phase, waitingForReply: Bool) {
        switch voice {
        case .listening: self = .listening
        case .sending, .waiting: self = .thinking
        case .speaking: self = .speaking
        case .off, .unavailable: self = waitingForReply ? .thinking : .idle
        }
    }
}
struct PhoneOrb: View {
    var mood: OrbMood
    var level: Float = 0
    var size: CGFloat = 64
    var fullProjection = false
    @State private var projection: HologramModel?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var reactive: Bool { mood == .listening || mood == .speaking }
    private var amplitude: CGFloat { level.isFinite ? CGFloat(min(max(level, 0), 1)) : 0 }
    private func updateProjection() {
        guard let projection else { return }
        let state: HologramState = switch mood { case .idle: .idle; case .listening: .listening; case .thinking, .working: .thinking; case .speaking: .speaking }
        projection.setState(state)
        projection.setLevel(Double(amplitude))
    }
    var body: some View {
        ZStack {
            if reactive && !fullProjection {
                Circle().fill(Phone.violet.opacity(0.18 + 0.25 * Double(amplitude)))
                    .frame(width: size * 1.4, height: size * 1.4).blur(radius: 18)
            }
            if fullProjection, let projection {
                BalancedOrionHologram(model: projection)
                    .onChange(of: mood) { _, _ in updateProjection() }
                    .onChange(of: level) { _, _ in projection.setLevel(Double(amplitude)) }
            } else {
                OrionThinkingHologram(state: mood.state, level: Double(amplitude))
                .scaleEffect(reactive && !reduceMotion ? 1 + 0.12 * amplitude : 1)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: level)
            }
        }
        .frame(width: size, height: size)
        .onAppear { if fullProjection { projection = HologramModel(); updateProjection() } }
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: mood)
        .accessibilityElement(children: .ignore).accessibilityLabel("ORION, \(mood.text)")
    }
}
