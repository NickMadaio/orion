# Task chat-mode-views — the chat mode screens (Mac)

## Why
Nick: when he sends something from the main screen's text box, the home screen should turn into a chat layout "kinda like chat gpt or claude": conversations on the left, the current chat in the middle/right, a model picker in the composer, and ORION's thinking visible. Claude does the transformation animation and wiring; this task builds the screens on top of `ChatStore`/`ChatModels` (task chat-store, in MobileCore).

## File
`native/OrionMobile/Sources/OrionViews/ChatModeView.swift` (new). Module `OrionViews` (SwiftUI, macOS 14 + iOS 17; imports SwiftUI, MobileCore, ThinkingOrbsKit). The Mac app's folder is closed to this loop, so the screen lives here and Claude links it into the Mac app. Do not edit existing files.

## Interface
```swift
import MobileCore
public struct ChatModeView: View {
    // plus a public memberwise-style init taking every property below in order
    var summaries: [ChatSummary]
    var conversation: ChatConversation?
    var models: [ModelChoice]
    @Binding var selectedModel: String?
    @Binding var draft: String
    var waiting: Bool                       // ORION is answering
    var liveThinking: String?               // thinking text streaming in for the answer being written
    var onSelect: (String) -> Void          // conversation id
    var onNew: () -> Void
    var onSend: () -> Void
    var onRename: (String, String) -> Void
    var onDelete: (String) -> Void
}
```
## Layout
- `HStack(spacing: 0)`: sidebar 240 pt wide, then a 1 pt `Color.white.opacity(0.06)` divider, then the thread.
- Sidebar: a "New chat" button at the top (`square.and.pencil`), then the summaries (title one line, preview one line dimmed, relative time), the selected one highlighted with `Color.white.opacity(0.06)` rounded 8; context menu Rename (inline `TextField`) and Delete (confirmation dialog).
- Thread: `ScrollView` + `ScrollViewReader` scrolled to bottom on new messages; max text width 720 pt, centred. User messages right-aligned in the accent colour, ORION's as prose (same idea as the phone's `ConversationView`). An ORION message with `thinking` shows a collapsed "Thinking" disclosure (chevron + dimmed label; expanded shows the thinking text in 12 pt, dimmed, with a 2 pt leading rule). While `waiting`, a final row shows `ThinkingOrb(state: .solving, size: .px20, theme: .dark)` and, if `liveThinking` is non-empty, that text expanded and updating.
- Composer at the bottom of the thread: multi-line `TextField` (1...8 lines), a model `Menu` showing the selected model's `label` (or "Default") listing `models` (local ones marked with `cpu`), and a send button enabled when trimmed draft is non-empty. Return sends, Shift-Return newline.
- Empty state (no conversation): centred "Start a conversation" and the composer.
- `#Preview` with sample data (two conversations, one message with thinking).

Colours from `ViewTokens` (OrionViews/OrionViews.swift).

## Check
`mobile-swift-tests` must pass (it builds OrionViews for macOS). Use only APIs available on both macOS 14 and iOS 17, or guard with `#if os(macOS)`.
