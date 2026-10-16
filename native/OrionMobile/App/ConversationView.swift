import SwiftUI
import MobileCore

/*
 The chat is the home screen (redesigned 2026-10-16, after "looks terrible").

 Each message is a `LinkCommand` of kind "chat" in Nick's private iCloud; the
 Mac hands it to ORION's brain through orion-remote — the same conversation the
 Mac app, voice and Discord share. The look follows the Claude and ChatGPT apps:
 ORION is plain left-aligned text, Nick a quiet bubble on the right, a minimal
 top bar (drawer, title, new chat) and a simple composer. Everything else lives
 in the drawer (PhoneDrawer) and its sheets.

 Pushed messages (an askId) are ORION speaking first. A tap on one scrolls here
 through `ThreadTarget` / `.orionOpenThread`; that wiring is unchanged.
*/
struct ConversationView: View {
    @ObservedObject var remote: RemoteStore
    /// The chat shown: nil is the whole history, otherwise one conversation id.
    @Binding var conversationID: String?
    let onMenu: () -> Void
    @StateObject private var voice = PhoneVoice()
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var showingTalk = false
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

    private var visible: [CloudLink.Message] {
        remote.conversation.filter { conversationID == nil || $0.conversationID == conversationID || $0.askID != nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            ChatTopBar(title: "ORION", subtitle: presenceLine, online: remote.presence == .online, models: remote.snapshot?.chatModels ?? [],
                       selectedModel: $selectedModel, onMenu: onMenu, onNew: { conversationID = UUID().uuidString })
            thread
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ChatComposer(draft: $draft, voice: voice, typing: $typing, replyingTo: tappedAsk,
                         onClearReply: { tappedAsk = nil }, onSend: send, onTalk: talk)
        }
        .background(Phone.ink.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .fullScreenCover(isPresented: $showingTalk, onDismiss: { voice.stop() }) {
            ChatTalkingView(voice: voice, onClose: { voice.stop(); showingTalk = false }, onRetry: talk)
        }
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if visible.isEmpty {
                        ChatEmptyState(mood: OrbMood(voice: voice.phase, waitingForReply: waiting), level: voice.level,
                                       suggestions: suggestions) { remote.say($0, conversation: conversationID, model: selectedModel) }
                    }
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, message in
                        if index == 0 || message.sentAt.timeIntervalSince(visible[index - 1].sentAt) > 3600 { ChatTimeMarker(date: message.sentAt) }
                        ChatExchange(message: message, awaitingReplyTo: replyTarget, waitingText: waitingText,
                                     onReply: { tappedAsk = $0; typing = true },
                                     onDecline: { id in remote.say("Not now", conversation: conversationID, model: selectedModel, replyTo: id); tappedAsk = nil })
                            .id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
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
        case .online: return "Mac online"
        case .stale: return "Mac slow to respond"
        case .offline: return "Mac offline"
        case .unknown: return "Connecting"
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

    private func talk() {
        typing = false
        showingTalk = true
        Task {
            await voice.start { text in
                remote.say(text, conversation: conversationID, model: selectedModel, replyTo: replyTarget) { id in voice.sent(id: id) }
            }
        }
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
