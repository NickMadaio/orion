import SwiftUI

/// The bottom composer: one rounded field, a mic/voice button, and send.
/// Voice is the existing PhoneVoice, started by `onTalk`.
struct ChatComposer: View {
    @Binding var draft: String
    @ObservedObject var voice: PhoneVoice
    var typing: FocusState<Bool>.Binding
    /// Set while a reply is aimed at one of ORION's own messages.
    let replyingTo: String?
    /// Bumped by the caller on each send: drives the ring pulse and the haptic.
    var sendCount = 0
    let onClearReply: () -> Void
    let onSend: () -> Void
    let onTalk: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// One pulse of a 1pt outline: grows and fades. Line art, not a glow.
    private struct Pulse { var scale = 1.0; var opacity = 0.0 }

    var body: some View {
        VStack(spacing: 0) {
            VoiceBar(voice: voice)
            if let replyingTo { replyLine(replyingTo) }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message ORION", text: $draft, axis: .vertical)
                    .lineLimit(1...5).font(.system(size: 16)).focused(typing)
                    .submitLabel(.send).onSubmit(onSend)
                    .padding(.leading, 16).padding(.vertical, 10)
                trailing.padding(.trailing, 5).padding(.bottom, 5)
            }
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Phone.wash(typing.wrappedValue ? 0.22 : 0.13), lineWidth: 1))
            .overlay { sendPulse }
            .animation(PhoneMotion.press, value: typing.wrappedValue)
            .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 8)
        }
        .background(Phone.ink)
        .sensoryFeedback(.impact(weight: .light), trigger: sendCount)
    }

    private var sendPulse: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Phone.accent, lineWidth: 1)
            .keyframeAnimator(initialValue: Pulse(), trigger: reduceMotion ? 0 : sendCount) { view, pulse in
                view.scaleEffect(x: 1 + 0.04 * (pulse.scale - 1) , y: 1 + 0.25 * (pulse.scale - 1)).opacity(pulse.opacity)
            } keyframes: { _ in
                KeyframeTrack(\.opacity) { LinearKeyframe(0.5, duration: 0.05); CubicKeyframe(0, duration: 0.5) }
                KeyframeTrack(\.scale) { CubicKeyframe(2.0, duration: 0.55) }
            }
            .allowsHitTesting(false).accessibilityHidden(true)
    }

    @ViewBuilder private var trailing: some View {
        if canSend || voice.active {
            Button(action: onSend) {
                Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                    .foregroundStyle(canSend ? Phone.ink : Phone.dim)
                    .frame(width: 32, height: 32)
                    .background(canSend ? Phone.text : Phone.wash(0.12), in: Circle())
            }
            .buttonStyle(PhonePressStyle()).disabled(!canSend).accessibilityLabel("Send")
        } else {
            Button(action: onTalk) {
                Image(systemName: "waveform").font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Phone.ink).frame(width: 32, height: 32)
                    .background(Phone.accent, in: Circle())
            }
            .buttonStyle(PhonePressStyle()).accessibilityLabel("Talk to ORION").accessibilityIdentifier("talk")
        }
    }

    private func replyLine(_ id: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "arrowshape.turn.up.left").font(.system(size: 11))
            Text("Replying to ORION").font(PhoneChat.meta)
            Spacer()
            Button(action: onClearReply) { Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)) }
                .buttonStyle(PhonePressStyle())
                .accessibilityLabel("Cancel reply")
        }
        .foregroundStyle(Phone.dim).padding(.horizontal, 22).padding(.top, 8)
    }
}
