import SwiftUI

public struct SummonComposer: View {
    @Binding var text: String
    var micMuted: Bool
    var onSend: () -> Void
    var onToggleMute: () -> Void
    var onClose: () -> Void
    var width: CGFloat
    public init(text: Binding<String>, micMuted: Bool, onSend: @escaping () -> Void, onToggleMute: @escaping () -> Void, onClose: @escaping () -> Void, width: CGFloat = 260) {
        _text = text; self.micMuted = micMuted; self.onSend = onSend; self.onToggleMute = onToggleMute; self.onClose = onClose; self.width = width
    }
    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    public var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            icon("xmark", label: "Close", action: onClose)
            TextField("Reply to ORION", text: $text, axis: .vertical)
                .lineLimit(1...4).font(.system(size: 13)).foregroundStyle(ViewTokens.text)
                .padding(.trailing, canSend ? 24 : 0)
                .overlay(alignment: .bottomTrailing) {
                    if canSend {
                        icon("arrow.up", label: "Send", action: send)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .onSubmit(send)
                .onKeyPress(.return, phases: .down) { key in
                    if key.modifiers.contains(.shift) { return .ignored }
                    send(); return .handled
                }
            icon(micMuted ? "mic.slash.fill" : "mic.fill", label: micMuted ? "Unmute microphone" : "Mute microphone", color: micMuted ? ViewTokens.warning : ViewTokens.dim, action: onToggleMute)
        }
        .padding(10).frame(width: width, alignment: .bottom)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.12), lineWidth: 1))
        .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
        .animation(.easeOut(duration: 0.15), value: canSend)
        .onKeyPress(.escape) { onClose(); return .handled }
    }
    private func send() { if canSend { onSend() } }
    private func icon(_ symbol: String, label: String, color: Color = ViewTokens.dim, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(color).frame(width: 22, height: 22).background(Color.white.opacity(0.06), in: Circle()) }
            .buttonStyle(.plain).accessibilityLabel(label)
    }
}
#Preview {
    VStack {
        SummonComposer(text: .constant(""), micMuted: false, onSend: {}, onToggleMute: {}, onClose: {})
        SummonComposer(text: .constant("I'm reading docs\nfor my lab"), micMuted: true, onSend: {}, onToggleMute: {}, onClose: {})
    }.padding().background(.black)
}
