import SwiftUI
import OrionViews
struct SharedChatView: View {
    @ObservedObject var state: AppState
    // 2026-10-16 UI audit #3: was Timer.publish inline in body, rebuilt on every
    // evaluation. A @StateObject ticker survives re-renders.
    @StateObject private var ticker = RefreshTicker(interval: 4)
    var body: some View {
        ChatModeView(summaries: state.chatSummaries, conversation: state.chatConversation, models: state.chatModels,
          selectedModel: $state.selectedChatModel, draft: $state.composer, waiting: state.phase == .thinking,
          liveThinking: state.chatThinking ?? (state.phase == .thinking ? state.thinkingFeed.joined(separator: "\n") : nil), onSelect: state.selectChat, onNew: state.newChat, onSend: state.submitTyped,
          onRename: { state.renameChat($0, title: $1) }, onDelete: state.deleteChat)
          .onReceive(ticker.$tick.dropFirst()) { _ in state.refreshChats() }
    }
}
