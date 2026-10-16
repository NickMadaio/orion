import SwiftUI

/// The bottom composer: one rounded field, a mic/voice button, and send.
/// Voice is the existing PhoneVoice, started by `onTalk`.
struct ChatComposer: View {
    @Binding var draft: String
    @ObservedObject var voice: PhoneVoice
    var typing: FocusState<Bool>.Binding
    /// Set while a reply is aimed at one of ORION's own messages.
    let replyingTo: String?
    let onClearReply: () -> Void
    let onSend: () -> Void
    let onTalk: () -> Void

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

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
            .animation(.easeOut(duration: 0.18), value: typing.wrappedValue)
            .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 8)
        }
        .background(Phone.ink)
    }

    @ViewBuilder private var trailing: some View {
        if canSend || voice.active {
            Button(action: onSend) {
                Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                    .foregroundStyle(canSend ? Phone.ink : Phone.dim)
                    .frame(width: 32, height: 32)
                    .background(canSend ? Phone.text : Phone.wash(0.12), in: Circle())
            }
            .buttonStyle(.plain).disabled(!canSend).accessibilityLabel("Send")
        } else {
            Button(action: onTalk) {
                Image(systemName: "waveform").font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Phone.ink).frame(width: 32, height: 32)
                    .background(Phone.accent, in: Circle())
            }
            .buttonStyle(.plain).accessibilityLabel("Talk to ORION").accessibilityIdentifier("talk")
        }
    }

    private func replyLine(_ id: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "arrowshape.turn.up.left").font(.system(size: 11))
            Text("Replying to ORION").font(.system(size: 12))
            Spacer()
            Button(action: onClearReply) { Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)) }
                .accessibilityLabel("Cancel reply")
        }
        .foregroundStyle(Phone.dim).padding(.horizontal, 22).padding(.top, 8)
    }
}
