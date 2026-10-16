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
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var showingTalk = false
    @State private var conversationID: String?
    @State private var selectedModel: String?
    @FocusState private var typing: Bool
    /// The pushed message he tapped (or nil): a reply answers it, and the thread scrolls to it.
    @State private var tappedAsk: String?

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
                    PhoneOrb(mood: OrbMood(voice: voice.phase, waitingForReply: waiting), level: voice.level, size: 56)
                        .frame(maxWidth: .infinity)
                    if remote.conversation.isEmpty { emptyState }
                    ForEach(remote.conversation.filter { conversationID == nil || $0.conversationID == conversationID || $0.askID != nil }) { message in
                        exchange(message).id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .background(Color.clear.contentShape(Rectangle()).onTapGesture { typing = false })
                .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: remote.conversation) { _, messages in
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
                for message in messages where message.status == .done || message.status == .failed {
                    voice.replyArrived(id: message.id, text: message.reply ?? "No answer came back.")
                }
            }
            .onDisappear { if !showingTalk { voice.stop() } }
            // Only a real trip to the background ends voice. `.inactive` also fires for a
            // banner, Control Center or a permission check — ending on it cancelled
            // every conversation as it started (2026-10-07: "it didn't even hear me").
            .onChange(of: scenePhase) { _, phase in if phase == .background { voice.end(.background) } }
            .onAppear {
                if let id = ThreadTarget.consume() { tappedAsk = id; proxy.scrollTo(id, anchor: .center) }
                else { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            // A tap on a pushed message opens the thread at that message.
            .onReceive(NotificationCenter.default.publisher(for: .orionOpenThread)) { note in
                guard let id = note.userInfo?["askId"] as? String else { return }
                _ = ThreadTarget.consume(); tappedAsk = id
                withAnimation { proxy.scrollTo(id, anchor: .center) }
            }
        }
        .safeAreaInset(edge: .bottom) { inputBar }
        .phoneScreen()
        .fullScreenCover(isPresented: $showingTalk, onDismiss: { voice.stop() }) {
            talkingView
        }
        .navigationTitle("ORION")
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Menu("Chats") {
                Button("New chat") { conversationID = UUID().uuidString }
                Button("All history") { conversationID = nil }
                ForEach(Array(Set(remote.conversation.compactMap(\.conversationID))).sorted(), id: \.self) { id in
                    Button(remote.conversation.first { $0.conversationID == id }?.text.prefix(40).description ?? "Chat") { conversationID = id }
                }
            } }
            ToolbarItem(placement: .topBarLeading) { Menu("Model") {
                Button("Default") { selectedModel = nil }
                ForEach(remote.snapshot?.chatModels ?? []) { model in Button(model.label) { selectedModel = model.id } }
            } }
        }
    }

    /// The pushed message a reply answers: the one he tapped, else the latest he has not answered (MobileCore's rule).
    private var replyTarget: String? {
        let lines = remote.conversation.flatMap { message -> [OutreachThread.Line] in
            var result = [OutreachThread.Line]()
            if let ask = message.askID { result.append(.init(id: ask, sentAt: message.sentAt, fromORION: true)) }
            else if !message.text.isEmpty { result.append(.init(id: message.id, sentAt: message.sentAt, fromORION: false)) }
            return result
        }
        return OutreachThread.replyTarget(thread: lines, tapped: tappedAsk)
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
            // ORION started this one (orion-reach): no words from Nick to show.
            if !message.text.isEmpty { HStack {
                Spacer(minLength: 48)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(message.text).font(.system(size: 16, weight: .medium)).foregroundStyle(Phone.accent)
                        .multilineTextAlignment(.trailing).textSelection(.enabled)
                    Text(message.sentAt.formatted(date: .omitted, time: .shortened))
                        .font(Phone.mono(10, .medium)).foregroundStyle(Phone.dim)
                }
            } }
            reply(message)
        }
    }

    @ViewBuilder
    private func reply(_ message: CloudLink.Message) -> some View {
        switch message.status {
        case .pending, .running:
            HStack(spacing: 10) {
                PhoneOrb(mood: .thinking, size: 20)
                Text(message.status == .pending ? waitingText : "ORION is thinking…")
                    .font(.system(size: 14)).foregroundStyle(Phone.dim)
            }
        case .done, .failed:
            VStack(alignment: .leading, spacing: 6) {
                Text(message.id.hasPrefix("local-") ? "ORION · ON YOUR IPHONE" : "ORION").font(Phone.mono(9, .semibold)).tracking(1.4)
                    .foregroundStyle(message.status == .failed ? Phone.orange : Phone.violet)
                if let thinking = message.thinking, !thinking.isEmpty { DisclosureGroup("Thinking") { Text(thinking).font(.system(size: 12)).textSelection(.enabled) }.foregroundStyle(Phone.dim) }
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
        showingTalk = true
        Task {
            await voice.start { text in
                remote.say(text, conversation: conversationID, model: selectedModel, replyTo: replyTarget) { id in voice.sent(id: id) }
            }
        }
    }

    private var talkingView: some View {
        GeometryReader { geometry in
        VStack(spacing: 20) {
            HStack {
                Text("ORION").font(Phone.mono(12, .semibold)).tracking(2).foregroundStyle(Phone.accent)
                Spacer()
                Button { voice.stop(); showingTalk = false } label: {
                    Label("Back to chat", systemImage: "chevron.down")
                        .font(.system(size: 14, weight: .medium)).foregroundStyle(Phone.soft)
                }.accessibilityIdentifier("closeTalkingMode")
            }
            Spacer(minLength: 20)
            PhoneOrb(mood: OrbMood(voice: voice.phase, waitingForReply: false), level: voice.level, size: min(300, geometry.size.width - 48), fullProjection: true)
                .accessibilityIdentifier("talkingHologram")
            Text(talkingStatus).font(Phone.mono(12, .medium)).tracking(1.5).foregroundStyle(Phone.accent)
            Text(voice.heard.isEmpty ? "Speak, then pause when you’re done." : voice.heard)
                .font(.system(size: 17)).foregroundStyle(Phone.soft)
                .multilineTextAlignment(.center).lineLimit(4).frame(minHeight: 80)
            if case .unavailable(let reason) = voice.phase {
                Text(reason).font(.system(size: 14)).foregroundStyle(Phone.orange).multilineTextAlignment(.center)
                Button("Try again", action: talk).foregroundStyle(Phone.accent)
            }
            Spacer(minLength: 20)
            Button("End conversation") { voice.stop(); showingTalk = false }
                .font(.system(size: 15, weight: .medium)).foregroundStyle(Phone.text)
                .padding(.horizontal, 24).padding(.vertical, 14)
                .background(Color.white.opacity(0.08), in: Capsule())
                .accessibilityIdentifier("endTalkingMode")
        }
        .padding(24).background(Phone.ink.ignoresSafeArea())
        .onChange(of: voice.phase) { _, phase in
            if phase == .off { showingTalk = false }
        }
        }
    }

    private var talkingStatus: String {
        switch voice.phase {
        case .off: "GETTING READY"
        case .listening: "LISTENING"
        case .sending, .waiting: "THINKING"
        case .speaking: "SPEAKING"
        case .unavailable: "MICROPHONE UNAVAILABLE"
        }
    }

    private var typingBar: some View {
        HStack(alignment: .bottom, spacing: 12) {
            if typing {
                Button { typing = false } label: {
                    Image(systemName: "chevron.down").foregroundStyle(Phone.dim).frame(width: 28, height: 28)
                }.buttonStyle(.plain).accessibilityLabel("Hide keyboard")
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
            TextField("Message ORION", text: $draft, axis: .vertical)
                .lineLimit(1...4).font(.system(size: 15)).focused($typing)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(typing ? Phone.accent.opacity(0.5) : Phone.hairline, lineWidth: 1))
                .animation(.easeOut(duration: 0.2), value: typing)
                .submitLabel(.send)
                .onSubmit(send)
            if canSend || voice.active {
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 34, height: 34)
                        .background(canSend ? Phone.accent : Color.white.opacity(0.15), in: Circle())
                }
                .buttonStyle(.plain).disabled(!canSend).accessibilityLabel("Send")
            } else {
                Button(action: talk) {
                    Image(systemName: "waveform").font(.system(size: 14, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 34, height: 34)
                        .background(Phone.accent, in: Circle())
                }
                .buttonStyle(.plain).accessibilityLabel("Talk to ORION").accessibilityIdentifier("talk")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .animation(.easeOut(duration: 0.2), value: typing)
    }

    private var waiting: Bool { remote.conversation.contains { $0.status == .pending || $0.status == .running } }

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        guard canSend else { return }
        let text = draft
        draft = ""
        remote.say(text, conversation: conversationID, model: selectedModel, replyTo: replyTarget)
        tappedAsk = nil
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
