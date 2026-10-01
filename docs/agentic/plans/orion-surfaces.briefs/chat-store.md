# Task chat-store — saved conversations and the model list (Swift, MobileCore)

## Why
The Mac gets a chat mode like Claude/ChatGPT: conversations listed on the left, the current one in the middle, a model picker, ORION's thinking shown. The phone and the Mac share one history. This task is the storage and model-list logic only (Foundation, tested); the views are task chat-mode-views.

## Files
- `native/OrionMobile/Sources/MobileCore/ChatStore.swift` (new)
- `native/OrionMobile/Sources/MobileCore/ChatModels.swift` (new)
- `native/OrionMobile/Tests/AgentTasksTests/ChatStoreTests.swift` (new)

## Interface
```swift
public enum ChatRole: String, Codable, Sendable { case user, orion, system }
public struct ChatMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String; public var role: ChatRole; public var text: String
    public var thinking: String?; public var at: Date; public var device: String; public var model: String?
}
public struct ChatConversation: Codable, Equatable, Identifiable, Sendable {
    public let id: String; public var title: String; public let createdAt: Date; public var updatedAt: Date
    public var model: String?; public var messages: [ChatMessage]
}
public struct ChatSummary: Equatable, Identifiable, Sendable { public let id: String; public let title: String; public let updatedAt: Date; public let preview: String; public let count: Int }
public struct ChatStore {
    public init(directory: URL)                      // creates it if missing
    public func list() throws -> [ChatSummary]       // newest updatedAt first; unreadable files skipped
    public func load(_ id: String) throws -> ChatConversation
    @discardableResult public func create(title: String? = nil, model: String? = nil, now: Date) throws -> ChatConversation
    @discardableResult public func append(_ message: ChatMessage, to id: String) throws -> ChatConversation
    @discardableResult public func merge(_ messages: [ChatMessage], into id: String) throws -> ChatConversation
    public func rename(_ id: String, to title: String) throws
    public func setModel(_ id: String, to model: String?) throws
    public func delete(_ id: String) throws
}
public struct ModelChoice: Equatable, Identifiable, Sendable { public let id: String; public let label: String; public let local: Bool }
public enum ChatModels { public static func choices(fromModelRoles data: Data) -> [ModelChoice] }
```
## Decisions
- One JSON file per conversation, `<id>.json`, written atomically (`Data.write(to:options: .atomic)`), ISO-8601 dates. Ids are UUID strings; `load`/`rename`/`delete` reject ids not matching `^[A-Za-z0-9-]{1,64}$` (no path traversal) by throwing.
- A new conversation's title is "New chat" until the first user message is appended; then it becomes that message's first 6 words (trimmed, max 48 characters, "…" appended when cut) unless renamed already.
- `append` and `merge` set `updatedAt` to the newest message time. `merge` adds only messages whose id is not present, then sorts by `at` (stable). `preview` is the last message's text, first 80 characters.
- `choices(fromModelRoles:)`: the file is `{"roles": {"<role>": {"primary": "provider/model", "fallbacks": ["provider/model", …]}}}`. Collect `primary` and `fallbacks` of roles "reasoning", "fast" and "local", in that order, de-duplicated, skipping null. `id` is the full "provider/model"; `label` is a friendly name: `anthropic/claude-haiku-4-5-20251001` → "Claude Haiku 4.5", `anthropic/claude-sonnet-5…` → "Claude Sonnet 5", other anthropic ids → "Claude" + the model id; `ollama/<name>` → "<name> (local)". `local` is true for ollama. Malformed data → empty array.
- Foundation only.

## Tests — `ChatStoreTests.swift` (class `ChatStoreTests`, methods exactly), each in its own temp directory removed in tearDown
- `testCreateListLoadRoundTrip`
- `testFirstUserMessageTitlesTheChat`
- `testRenamedChatKeepsItsTitle`
- `testListIsNewestFirstAndSkipsCorruptFiles`
- `testMergeAddsOnlyNewMessagesInTimeOrder`
- `testThinkingIsSaved`
- `testDeleteRemovesTheFile`
- `testPathTraversalIdIsRejected`
- `testModelChoicesFromModelRoles`
- `testMalformedModelRolesGivesNoChoices`
