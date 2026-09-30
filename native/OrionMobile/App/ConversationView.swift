import SwiftUI
import MobileCore

/*
 Talking to ORION from the phone (2026-09-28).

 Each message is a `LinkCommand` of kind "chat" in Nick's private iCloud; the
 Mac hands it to ORION's brain through orion-remote — the same conversation the
 Mac app, voice and Discord share — and writes the answer onto the same record.
 So the history survives reinstalls and is the same on every device.

 Styled like the rest of ORION: text on the backdrop, not bubbles in boxes.
 Nick's lines sit right in the accent colour; ORION's answers read as prose.
*/
struct ConversationView: View {
    @ObservedObject var remote: RemoteStore
    @StateObject private var voice = PhoneVoice()
    @State private var draft = ""
    @FocusState private var typing: Bool

    private let suggestions = [
        "What does my day look like?",
        "How is the agent run going?",
        "Anything waiting for my approval?",
        "What should I focus on next?",
    ]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    PhoneHeader(eyebrow: presenceLine, title: "ORION")
                    if remote.conversation.isEmpty { emptyState }
                    ForEach(remote.conversation) { message in
                        exchange(message).id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: remote.conversation) { _, messages in
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
                for message in messages where message.status == .done || message.status == .failed {
                    voice.replyArrived(id: message.id, text: message.reply ?? "No answer came back.")
                }
            }
            .onDisappear { voice.stop() }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .safeAreaInset(edge: .bottom) { inputBar }
        .phoneScreen()
        .navigationTitle("ORION")
    }

    private var presenceLine: String {
        switch remote.presence {
        case .online: return "Your Mac is online"
        case .stale: return "Your Mac is slow to respond"
        case .offline: return "Your Mac is offline · ORION answers from your iPhone"
        case .unknown: return "Waiting to hear from your Mac"
        }
    }

    // MARK: Messages

    private func exchange(_ message: CloudLink.Message) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Spacer(minLength: 48)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(message.text).font(.system(size: 16, weight: .medium)).foregroundStyle(Phone.accent)
                        .multilineTextAlignment(.trailing).textSelection(.enabled)
                    Text(message.sentAt.formatted(date: .omitted, time: .shortened))
                        .font(Phone.mono(10, .medium)).foregroundStyle(Phone.dim)
                }
            }
            reply(message)
        }
    }

    @ViewBuilder
    private func reply(_ message: CloudLink.Message) -> some View {
        switch message.status {
        case .pending, .running:
            HStack(spacing: 10) {
                PhoneThinkingDots()
                Text(message.status == .pending ? waitingText : "ORION is thinking…")
                    .font(.system(size: 14)).foregroundStyle(Phone.dim)
            }
        case .done, .failed:
            VStack(alignment: .leading, spacing: 6) {
                Text(message.id.hasPrefix("local-") ? "ORION · ON YOUR IPHONE" : "ORION").font(Phone.mono(9, .semibold)).tracking(1.4)
                    .foregroundStyle(message.status == .failed ? Phone.orange : Phone.violet)
                Text(Self.rendered(message.reply ?? "No answer came back."))
                    .font(.system(size: 16)).lineSpacing(3)
                    .foregroundStyle(message.status == .failed ? Phone.orange : Phone.text)
                    .textSelection(.enabled)
            }
            .padding(.trailing, 36)
        }
    }

    /// ORION answers in light markdown; show bold, italics, code and links, keep line breaks.
    static func rendered(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }

    private var waitingText: String {
        remote.presence == .online ? "Sent to your Mac…" : "Waiting for your Mac to come online…"
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Ask anything. ORION answers from your Mac, with your calendar, tasks, projects and memory.")
                .font(.system(size: 15)).foregroundStyle(Phone.soft)
            ForEach(suggestions, id: \.self) { suggestion in
                Button { remote.say(suggestion) } label: {
                    HStack {
                        Text(suggestion).font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text)
                        Spacer()
                        Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Phone.accent)
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Rectangle().fill(Phone.hairline).frame(height: 1) }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Input

    private var inputBar: some View {
        VStack(spacing: 0) {
            VoiceBar(voice: voice)
            typingBar
        }
        .background(.ultraThinMaterial)
    }

    private func talk() {
        typing = false
        Task {
            await voice.start { text in
                remote.say(text) { id in voice.sent(id: id) }
            }
        }
    }

    private var typingBar: some View {
        HStack(alignment: .bottom, spacing: 12) {
            TextField("Message ORION", text: $draft, axis: .vertical)
                .lineLimit(1...5).font(.system(size: 16)).focused($typing)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .submitLabel(.send)
                .onSubmit(send)
            if canSend || voice.active {
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 40, height: 40)
                        .background(canSend ? Phone.accent : Color.white.opacity(0.15), in: Circle())
                }
                .buttonStyle(.plain).disabled(!canSend).accessibilityLabel("Send")
            } else {
                Button(action: talk) {
                    Image(systemName: "waveform").font(.system(size: 17, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 40, height: 40)
                        .background(Phone.accent, in: Circle())
                }
                .buttonStyle(.plain).accessibilityLabel("Talk to ORION").accessibilityIdentifier("talk")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        guard canSend else { return }
        let text = draft
        draft = ""
        remote.say(text)
    }
}

/// Three dots that breathe while ORION works on an answer.
struct PhoneThinkingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { index in
                    let phase = (sin(t * 5 - Double(index) * 0.8) + 1) / 2
                    Circle().fill(Phone.violet.opacity(0.35 + 0.65 * phase)).frame(width: 6, height: 6)
                        .offset(y: -2.5 * phase)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
