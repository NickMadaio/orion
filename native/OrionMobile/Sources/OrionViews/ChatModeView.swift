import SwiftUI
import MobileCore
import ThinkingOrbsKit

/// The chat screen: conversations on the left, the thread, and a composer.
///
/// 2026-10-30 polish: no plates — the selected conversation is an accent hairline that slides between rows, and
/// the composer is a ruled line that lights on focus rather than a filled rounded box. New messages ease in, a
/// reply is revealed top to bottom instead of popping, and the wait is a breathing indicator with ORION's live
/// steps. All of it is a plain fade under Reduce Motion.
///
/// `snapshot` swaps the scroll view, text field and menu for static stand-ins so ImageRenderer can draw it (it
/// draws no AppKit-backed controls); `snapshotReveal` holds the newest reply mid-reveal for a render.
public struct ChatModeView: View {
    var summaries: [ChatSummary]
    var conversation: ChatConversation?
    var models: [ModelChoice]
    @Binding var selectedModel: String?
    @Binding var draft: String
    var waiting: Bool
    var liveThinking: String?
    var onSelect: (String) -> Void
    var onNew: () -> Void
    var onSend: () -> Void
    var onRename: (String, String) -> Void
    var onDelete: (String) -> Void
    var snapshot = false
    var snapshotReveal: Double?
    @State private var renaming: String?
    @State private var newTitle = ""
    @State private var deleting: String?
    /// The newest message when the thread was opened: anything after it arrived live and gets the reveal.
    @State private var openedAt: String?
    @FocusState private var composerFocused: Bool
    @Namespace private var marker
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(summaries: [ChatSummary], conversation: ChatConversation?, models: [ModelChoice], selectedModel: Binding<String?>, draft: Binding<String>, waiting: Bool, liveThinking: String?, onSelect: @escaping (String) -> Void, onNew: @escaping () -> Void, onSend: @escaping () -> Void, onRename: @escaping (String, String) -> Void, onDelete: @escaping (String) -> Void, snapshot: Bool = false, snapshotReveal: Double? = nil) {
        self.summaries = summaries; self.conversation = conversation; self.models = models
        _selectedModel = selectedModel; _draft = draft; self.waiting = waiting; self.liveThinking = liveThinking
        self.onSelect = onSelect; self.onNew = onNew; self.onSend = onSend; self.onRename = onRename; self.onDelete = onDelete
        self.snapshot = snapshot; self.snapshotReveal = snapshotReveal
    }

    public var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 232)
            Rectangle()
                .fill(LinearGradient(colors: [.clear, ViewTokens.hairline, ViewTokens.hairline, .clear], startPoint: .top, endPoint: .bottom))
                .frame(width: 0.5)
            VStack(spacing: 0) {
                thread
                composer.padding(.horizontal, 24).padding(.bottom, 14).padding(.top, 6).frame(maxWidth: 760)
            }.frame(maxWidth: .infinity)
        }
        .foregroundStyle(ViewTokens.text)
        .confirmationDialog("Delete conversation?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete", role: .destructive) { if let id = deleting { onDelete(id) }; deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        }
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            Button(action: onNew) {
                Label("New chat", systemImage: "square.and.pencil").font(.system(size: 13, weight: .medium))
            }
            .buttonStyle(.plain).foregroundStyle(ViewTokens.accent).padding(.top, 10).padding(.leading, 14)
            Text("CONVERSATIONS")
                .font(.system(size: 9, weight: .semibold, design: .monospaced)).tracking(2)
                .foregroundStyle(ViewTokens.dim).padding(.leading, 14)
            if snapshot { conversationList; Spacer(minLength: 0) } else { ScrollView(showsIndicators: false) { conversationList } }
        }
        .padding(.vertical, 14).padding(.trailing, 14)
    }

    private var conversationList: some View {
        VStack(spacing: 2) {
            ForEach(summaries) { summary in
                Group {
                    if renaming == summary.id {
                        TextField("Conversation title", text: $newTitle).onSubmit { rename(summary.id) }
                            .onKeyPress(.escape) { renaming = nil; return .handled }
                            .padding(.leading, 14).padding(.vertical, 8)
                    } else {
                        ChatSidebarRow(summary: summary, selected: conversation?.id == summary.id, marker: marker) {
                            withAnimation(ViewMotion.resolved(ViewMotion.select, reduceMotion: reduceMotion)) { onSelect(summary.id) }
                        }
                    }
                }
                .contextMenu {
                    Button("Rename") { newTitle = summary.title; renaming = summary.id }
                    Button("Delete", role: .destructive) { deleting = summary.id }
                }
            }
        }
    }

    private func rename(_ id: String) {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { onRename(id, title) }; renaming = nil
    }

    // MARK: Thread

    private var messages: [ChatMessage] { conversation?.messages ?? [] }

    private var threadContent: some View {
        VStack(alignment: .leading, spacing: 26) {
            if conversation == nil {
                Text("Start a conversation").font(.system(size: 14)).foregroundStyle(ViewTokens.dim)
                    .frame(maxWidth: .infinity).padding(.vertical, 80)
            }
            ForEach(messages) { message in
                messageRow(message)
                    .transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 10)))
            }
            if waiting {
                ChatThinkingIndicator(liveThinking: liveThinking, animated: !snapshot)
                    .transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 6)))
            }
            Color.clear.frame(height: 1).id("bottom")
        }
        .frame(maxWidth: 700, alignment: .leading).padding(.horizontal, 24).padding(.vertical, 20).frame(maxWidth: .infinity)
        .animation(ViewMotion.resolved(ViewMotion.enter, reduceMotion: reduceMotion), value: messages.count)
        .animation(ViewMotion.resolved(ViewMotion.enter, reduceMotion: reduceMotion), value: waiting)
    }

    @ViewBuilder private var thread: some View {
        if snapshot {
            VStack(spacing: 0) { Spacer(minLength: 0); threadContent }.clipped()
        } else {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) { threadContent }
                    .onAppear { openedAt = messages.last?.id; proxy.scrollTo("bottom", anchor: .bottom) }
                    .onChange(of: conversation?.messages) { _, _ in scrollDown(proxy) }
                    .onChange(of: conversation?.id) { _, _ in openedAt = messages.last?.id; proxy.scrollTo("bottom", anchor: .bottom) }
                    .onChange(of: liveThinking) { _, _ in scrollDown(proxy) }
                    .onChange(of: waiting) { _, _ in scrollDown(proxy) }
            }
        }
    }

    private func scrollDown(_ proxy: ScrollViewProxy) {
        withAnimation(ViewMotion.resolved(ViewMotion.enter, reduceMotion: reduceMotion)) { proxy.scrollTo("bottom", anchor: .bottom) }
    }

    /// True for ORION's newest reply when it arrived after the thread was opened (or a render asks for the reveal).
    private func revealing(_ message: ChatMessage) -> Bool {
        guard message.role == .orion, message.id == messages.last?.id else { return false }
        return snapshotReveal != nil || (!snapshot && openedAt != nil && openedAt != message.id)
    }

    private func messageRow(_ message: ChatMessage) -> some View {
        HStack(alignment: .top) {
            if message.role == .user { Spacer(minLength: 96) }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                if let thinking = message.thinking, !thinking.isEmpty, message.role == .orion {
                    thinkingText(thinking)
                }
                Text(message.text)
                    .font(.system(size: message.role == .user ? 14 : 14.5))
                    .lineSpacing(message.role == .user ? 2 : 4.5)
                    .multilineTextAlignment(message.role == .user ? .trailing : .leading)
                    .textSelection(.enabled)
                    .foregroundStyle(message.role == .user ? ViewTokens.accent : ViewTokens.text)
            }
            .modifier(ReplyReveal(active: revealing(message), frozen: revealing(message) ? snapshotReveal : nil))
            if message.role != .user { Spacer(minLength: 64) }
        }
    }

    private func thinkingText(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(ViewTokens.dim).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 12)
            .overlay(alignment: .leading) {
                Rectangle().fill(ViewTokens.violet.opacity(0.35)).frame(width: 1)
            }
    }

    // MARK: Composer

    private var canSend: Bool { !waiting && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private func send() { if canSend { onSend() } }

    /// A ruled line, not a box: the field, a hairline that lights on focus, then the model and send.
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom, spacing: 12) {
                field
                sendButton
            }
            Rectangle()
                .fill(composerFocused ? ViewTokens.accent.opacity(0.65) : Color.white.opacity(0.12))
                .frame(height: 1)
                .shadow(color: ViewTokens.accent.opacity(composerFocused ? 0.45 : 0), radius: 5)
            modelPicker
        }
        .animation(ViewMotion.hover, value: composerFocused)
        .animation(ViewMotion.hover, value: canSend)
    }

    @ViewBuilder private var field: some View {
        if snapshot {
            Text(draft.isEmpty ? "Message ORION" : draft).font(.system(size: 14))
                .foregroundStyle(draft.isEmpty ? ViewTokens.dim : ViewTokens.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            TextField("Message ORION", text: $draft, axis: .vertical).lineLimit(1...8)
                .textFieldStyle(.plain).font(.system(size: 14)).focused($composerFocused).onSubmit(send)
                .onKeyPress(.return, phases: .down) { key in
                    if key.modifiers.contains(.shift) { return .ignored }
                    send(); return .handled
                }
        }
    }

    private var sendButton: some View {
        Button(action: send) {
            Image(systemName: "arrow.up")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(canSend ? Color.black.opacity(0.85) : ViewTokens.dim)
                .frame(width: 26, height: 26)
                .background(Circle().fill(canSend ? ViewTokens.accent : Color.clear))
                .overlay(Circle().strokeBorder(canSend ? Color.clear : Color.white.opacity(0.16), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain).disabled(!canSend).accessibilityLabel("Send")
    }

    @ViewBuilder private var modelPicker: some View {
        let label = models.first { $0.id == selectedModel }?.label ?? "Default model"
        if snapshot {
            Text(label.uppercased()).font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(1.4).foregroundStyle(ViewTokens.dim)
        } else {
            Menu {
                Button("Default") { selectedModel = nil }
                ForEach(models) { model in
                    Button { selectedModel = model.id } label: {
                        if model.local { Label(model.label, systemImage: "cpu") } else { Text(model.label) }
                    }
                }
            } label: {
                Text(label.uppercased()).font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(1.4).foregroundStyle(ViewTokens.dim)
            }
            .menuStyle(.borderlessButton).fixedSize()
            .disabled(waiting)
        }
    }
}

#Preview {
    let message = ChatMessage(id: "m", role: .orion, text: "Your next class is at 2 PM.", thinking: "Checking the schedule…", at: Date(), device: "mac")
    let conversation = ChatConversation(id: "a", title: "Today's plan", createdAt: Date(), updatedAt: Date(), model: nil, messages: [message])
    ChatModeView(summaries: [ChatSummary(id: "a", title: "Today's plan", updatedAt: Date(), preview: "Your next class", count: 1), ChatSummary(id: "b", title: "Study", updatedAt: Date(), preview: "Let's start", count: 1)], conversation: conversation, models: [], selectedModel: .constant(nil), draft: .constant(""), waiting: false, liveThinking: nil, onSelect: { _ in }, onNew: {}, onSend: {}, onRename: { _, _ in }, onDelete: { _ in }).frame(width: 900, height: 600).background(.black)
}
