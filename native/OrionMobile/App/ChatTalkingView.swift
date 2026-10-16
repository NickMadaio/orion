import SwiftUI

/// Full-screen voice mode: the projection, what was heard, and one way out.
struct ChatTalkingView: View {
    @ObservedObject var voice: PhoneVoice
    let onClose: () -> Void
    let onRetry: () -> Void

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 20) {
                HStack {
                    Spacer()
                    Button(action: onClose) {
                        Label("Back to chat", systemImage: "chevron.down")
                            .font(.system(size: 14, weight: .medium)).foregroundStyle(Phone.soft)
                    }.accessibilityIdentifier("closeTalkingMode")
                }
                Spacer(minLength: 20)
                PhoneOrb(mood: OrbMood(voice: voice.phase, waitingForReply: false), level: voice.level,
                         size: min(300, geometry.size.width - 48), fullProjection: true)
                    .accessibilityIdentifier("talkingHologram")
                Text(status).font(.system(size: 13, weight: .medium)).tracking(1.2).foregroundStyle(Phone.accent)
                Text(voice.heard.isEmpty ? "Speak, then pause when you’re done." : voice.heard)
                    .font(.system(size: 17)).foregroundStyle(Phone.soft)
                    .multilineTextAlignment(.center).lineLimit(4).frame(minHeight: 80)
                if case .unavailable(let reason) = voice.phase {
                    Text(reason).font(.system(size: 14)).foregroundStyle(Phone.orange).multilineTextAlignment(.center)
                    Button("Try again", action: onRetry).foregroundStyle(Phone.accent)
                }
                Spacer(minLength: 20)
                Button("End conversation", action: onClose)
                    .font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text)
                    .padding(.horizontal, 24).padding(.vertical, 14)
                    .overlay(Capsule().stroke(Phone.wash(0.2), lineWidth: 1))
                    .accessibilityIdentifier("endTalkingMode")
            }
            .padding(24).background(Phone.ink.ignoresSafeArea())
            .onChange(of: voice.phase) { _, phase in if phase == .off { onClose() } }
        }
    }

    private var status: String {
        switch voice.phase {
        case .off: "GETTING READY"
        case .listening: "LISTENING"
        case .sending, .waiting: "THINKING"
        case .speaking: "SPEAKING"
        case .unavailable: "MICROPHONE UNAVAILABLE"
        }
    }
}
