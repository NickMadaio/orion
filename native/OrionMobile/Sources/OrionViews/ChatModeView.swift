import SwiftUI
import MobileCore
import ThinkingOrbsKit

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
    @State private var renaming: String?
    @State private var newTitle = ""
    @State private var deleting: String?
    public init(summaries: [ChatSummary], conversation: ChatConversation?, models: [ModelChoice], selectedModel: Binding<String?>, draft: Binding<String>, waiting: Bool, liveThinking: String?, onSelect: @escaping (String) -> Void, onNew: @escaping () -> Void, onSend: @escaping () -> Void, onRename: @escaping (String, String) -> Void, onDelete: @escaping (String) -> Void) {
        self.summaries = summaries; self.conversation = conversation; self.models = models
        _selectedModel = selectedModel; _draft = draft; self.waiting = waiting; self.liveThinking = liveThinking
        self.onSelect = onSelect; self.onNew = onNew; self.onSend = onSend; self.onRename = onRename; self.onDelete = onDelete
    }
    public var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 240)
            Rectangle().fill(Color.white.opacity(0.06)).frame(width: 1)
            VStack(spacing: 0) {
                thread
                composer.padding(16).frame(maxWidth: 752)
            }.frame(maxWidth: .infinity)
        }
        .foregroundStyle(ViewTokens.text)
        .confirmationDialog("Delete conversation?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete", role: .destructive) { if let id = deleting { onDelete(id) }; deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: onNew) { Label("New chat", systemImage: "square.and.pencil") }.buttonStyle(.plain).padding(.vertical, 10)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(summaries) { summary in
                        VStack(alignment: .leading, spacing: 5) {
                            if renaming == summary.id {
                                TextField("Conversation title", text: $newTitle).onSubmit { rename(summary.id) }
                                    .onKeyPress(.escape) { renaming = nil; return .handled }
                            } else {
                                Button { onSelect(summary.id) } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(summary.title).lineLimit(1)
                                        Text(summary.preview).font(.system(size: 12)).foregroundStyle(ViewTokens.dim).lineLimit(1)
                                        Text(summary.updatedAt, style: .relative).font(.system(size: 10)).foregroundStyle(ViewTokens.dim)
                                    }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                            }
                        }.padding(10)
                        .background(conversation?.id == summary.id ? Color.white.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .contextMenu {
                            Button("Rename") { newTitle = summary.title; renaming = summary.id }
                            Button("Delete", role: .destructive) { deleting = summary.id }
                        }
                    }
                }
            }
        }.padding(14)
    }
    private func rename(_ id: String) {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { onRename(id, title) }; renaming = nil
    }
    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if conversation == nil { Text("Start a conversation").foregroundStyle(ViewTokens.dim).frame(maxWidth: .infinity).padding(.vertical, 80) }
                    ForEach(conversation?.messages ?? []) { message in
                        HStack {
                            if message.role == .user { Spacer(minLength: 48) }
                            VStack(alignment: .leading, spacing: 8) {
                                if let thinking = message.thinking, !thinking.isEmpty, message.role == .orion {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text("Thinking").font(.system(size: 11, weight: .medium))
                                        thinkingText(thinking)
                                    }.foregroundStyle(ViewTokens.dim)
                                }
                                Text(message.text).textSelection(.enabled).foregroundStyle(message.role == .user ? ViewTokens.accent : ViewTokens.text)
                            }
                            if message.role != .user { Spacer(minLength: 48) }
                        }
                    }
                    if waiting {
                        HStack(alignment: .top, spacing: 10) {
                            ThinkingOrb(state: .solving, size: .px20, theme: .dark)
                            VStack(alignment: .leading, spacing: 5) {
                                Text("Thinking…").font(.system(size: 12, weight: .medium))
                                if let liveThinking, !liveThinking.isEmpty { thinkingText(liveThinking) }
                            }
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }.frame(maxWidth: 720, alignment: .leading).padding(16).frame(maxWidth: .infinity)
            }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: conversation?.messages) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: conversation?.id) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: liveThinking) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: waiting) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }
    private func thinkingText(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(ViewTokens.dim).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(ViewTokens.hairline).frame(width: 2) }
    }
    private var canSend: Bool { !waiting && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private func send() { if canSend { onSend() } }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Message ORION", text: $draft, axis: .vertical).lineLimit(1...8).onSubmit(send)
                .onKeyPress(.return, phases: .down) { key in
                    if key.modifiers.contains(.shift) { return .ignored }
                    send(); return .handled
                }
            HStack {
                Menu {
                    Button("Default") { selectedModel = nil }
                    ForEach(models) { model in
                        Button { selectedModel = model.id } label: {
                            if model.local { Label(model.label, systemImage: "cpu") } else { Text(model.label) }
                        }
                    }
                } label: { Text(models.first { $0.id == selectedModel }?.label ?? "Default").font(.system(size: 12)).foregroundStyle(ViewTokens.soft) }
                .disabled(waiting)
                Spacer()
                Button(action: send) { Image(systemName: "arrow.up").foregroundStyle(ViewTokens.accent) }.disabled(!canSend).accessibilityLabel("Send")
            }
        }.padding(14).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}
#Preview {
    let message = ChatMessage(id: "m", role: .orion, text: "Your next class is at 2 PM.", thinking: "Checking the schedule…", at: Date(), device: "mac")
    let conversation = ChatConversation(id: "a", title: "Today's plan", createdAt: Date(), updatedAt: Date(), model: nil, messages: [message])
    ChatModeView(summaries: [ChatSummary(id: "a", title: "Today's plan", updatedAt: Date(), preview: "Your next class", count: 1), ChatSummary(id: "b", title: "Study", updatedAt: Date(), preview: "Let's start", count: 1)], conversation: conversation, models: [], selectedModel: .constant(nil), draft: .constant(""), waiting: false, liveThinking: nil, onSelect: { _ in }, onNew: {}, onSend: {}, onRename: { _, _ in }, onDelete: { _ in }).frame(width: 900, height: 600).background(.black)
}
