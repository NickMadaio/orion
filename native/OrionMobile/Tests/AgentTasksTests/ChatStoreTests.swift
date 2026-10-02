import XCTest
@testable import MobileCore

final class ChatStoreTests: XCTestCase {
    private var tempDir: URL!
    private var store: ChatStore!

    override func setUp() {
        super.setUp()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("orion-chat-test-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        tempDir = tmp
        store = try! ChatStore(directory: tmp)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDir)
        super.tearDown()
    }

    func testCreateListLoadRoundTrip() throws {
        let now = Date()
        let conv = try store.create(title: "Hello", model: "anthropic/claude-sonnet-5-20250601", now: now)
        XCTAssertNotNil(conv.id)
        XCTAssertEqual(conv.title, "Hello")
        XCTAssertEqual(conv.messages.count, 0)

        let summaries = try store.list()
        XCTAssertEqual(summaries.count, 1)
        XCTAssertEqual(summaries[0].id, conv.id)
        XCTAssertEqual(summaries[0].title, "Hello")
        XCTAssertEqual(summaries[0].count, 0)

        let loaded = try store.load(conv.id)
        XCTAssertEqual(loaded, conv)
    }

    func testFirstUserMessageTitlesTheChat() throws {
        let now = Date()
        let conv = try store.create(now: now)
        let msg = ChatMessage(id: "m1", role: .user, text: "Hello world this is a long message with many words", at: now, device: "mac")
        let titled = try store.append(msg, to: conv.id)
        XCTAssertEqual(titled.title, "Hello world this is a long…")
    }

    func testRenamedChatKeepsItsTitle() throws {
        let now = Date()
        let conv = try store.create(now: now)
        try store.rename(conv.id, to: "My Custom Title")
        let msg = ChatMessage(id: "m1", role: .user, text: "Hello world this is a long message with many words", at: now, device: "mac")
        _ = try store.append(msg, to: conv.id)
        let loaded = try store.load(conv.id)
        XCTAssertEqual(loaded.title, "My Custom Title")
    }

    func testListIsNewestFirstAndSkipsCorruptFiles() throws {
        let now = Date()
        let c1 = try store.create(title: "Old", now: now.addingTimeInterval(-3600))
        let c2 = try store.create(title: "New", now: now)

        let corruptURL = tempDir.appendingPathComponent("corrupt.json")
        try Data("not json".utf8).write(to: corruptURL)

        let summaries = try store.list()
        XCTAssertEqual(summaries.count, 2)
        XCTAssertEqual(summaries[0].id, c2.id)
        XCTAssertEqual(summaries[1].id, c1.id)
    }

    func testMergeAddsOnlyNewMessagesInTimeOrder() throws {
        let now = Date()
        let conv = try store.create(now: now)
        let m1 = ChatMessage(id: "m1", role: .user, text: "First", at: now.addingTimeInterval(-60), device: "mac")
        let m2 = ChatMessage(id: "m2", role: .orion, text: "Reply", at: now, device: "mac")
        let m3 = ChatMessage(id: "m3", role: .user, text: "Third", at: now.addingTimeInterval(60), device: "mac")

        _ = try store.append(m1, to: conv.id)

        let result = try store.merge([m2, m3], into: conv.id)
        XCTAssertEqual(result.messages.count, 3)
        XCTAssertEqual(result.messages[0].id, "m1")
        XCTAssertEqual(result.messages[1].id, "m2")
        XCTAssertEqual(result.messages[2].id, "m3")

        let result2 = try store.merge([m2], into: conv.id)
        XCTAssertEqual(result2.messages.count, 3)
    }

    func testThinkingIsSaved() throws {
        let now = Date()
        let conv = try store.create(now: now)
        let msg = ChatMessage(id: "m1", role: .orion, text: "Answer", thinking: "Let me think about this carefully", at: now, device: "mac")
        _ = try store.append(msg, to: conv.id)
        let loaded = try store.load(conv.id)
        XCTAssertEqual(loaded.messages[0].thinking, "Let me think about this carefully")
    }

    func testDeleteRemovesTheFile() throws {
        let now = Date()
        let conv = try store.create(now: now)
        try store.delete(conv.id)
        let summaries = try store.list()
        XCTAssertEqual(summaries.count, 0)
    }

    func testPathTraversalIdIsRejected() throws {
        XCTAssertThrowsError(try store.load("../etc/passwd"))
        XCTAssertThrowsError(try store.load("../../../secret"))
    }

    func testModelChoicesFromModelRoles() throws {
        let json = """
        {"roles": {
            "reasoning": {"primary": "anthropic/claude-sonnet-5-20250601", "fallbacks": ["anthropic/claude-haiku-4-5-20251001"]},
            "fast": {"primary": "ollama/llama3.1", "fallbacks": []},
            "local": {"primary": null, "fallbacks": ["ollama/mistral"]}
        }}
        """
        let data = json.data(using: .utf8)!
        let choices = ChatModels.choices(fromModelRoles: data)

        XCTAssertEqual(choices.count, 4)
        XCTAssertEqual(choices[0].id, "anthropic/claude-sonnet-5-20250601")
        XCTAssertEqual(choices[0].label, "Claude Sonnet 5")
        XCTAssertFalse(choices[0].local)

        XCTAssertEqual(choices[1].id, "anthropic/claude-haiku-4-5-20251001")
        XCTAssertEqual(choices[1].label, "Claude Haiku 4.5")
        XCTAssertFalse(choices[1].local)

        XCTAssertEqual(choices[2].id, "ollama/llama3.1")
        XCTAssertEqual(choices[2].label, "llama3.1 (local)")
        XCTAssertTrue(choices[2].local)

        XCTAssertEqual(choices[3].id, "ollama/mistral")
        XCTAssertEqual(choices[3].label, "mistral (local)")
        XCTAssertTrue(choices[3].local)
    }

    func testMalformedModelRolesGivesNoChoices() throws {
        let data = Data("not json at all".utf8)
        let choices = ChatModels.choices(fromModelRoles: data)
        XCTAssertEqual(choices.count, 0)
    }
}
