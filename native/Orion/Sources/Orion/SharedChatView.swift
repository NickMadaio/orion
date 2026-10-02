import SwiftUI
import OrionViews
struct SharedChatView: View {
    @ObservedObject var state: AppState
    var body: some View {
        ChatModeView(summaries: state.chatSummaries, conversation: state.chatConversation, models: state.chatModels,
          selectedModel: $state.selectedChatModel, draft: $state.composer, waiting: state.phase == .thinking,
          liveThinking: state.chatThinking ?? (state.phase == .thinking ? state.thinkingFeed.joined(separator: "\n") : nil), onSelect: state.selectChat, onNew: state.newChat, onSend: state.submitTyped,
          onRename: { state.renameChat($0, title: $1) }, onDelete: state.deleteChat)
          .onReceive(Timer.publish(every: 4, on: .main, in: .common).autoconnect()) { _ in state.refreshChats() }
    }
}
