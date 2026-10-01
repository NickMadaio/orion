import Foundation

public enum ChatRole: String, Codable, Sendable { case user, orion, system }

public struct ChatMessage: Codable, Identifiable, Sendable {
    public let id: String
    public var role: ChatRole
    public var text: String
    public var thinking: String?
    public var at: Date
    public var device: String
    public var model: String?

    public init(id: String, role: ChatRole, text: String, thinking: String? = nil, at: Date, device: String, model: String? = nil) {
        self.id = id
        self.role = role
        self.text = text
        self.thinking = thinking
        self.at = at
        self.device = device
        self.model = model
    }
}

extension ChatMessage: Equatable {
    public static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
        lhs.id == rhs.id &&
        lhs.role == rhs.role &&
        lhs.text == rhs.text &&
        lhs.thinking == rhs.thinking &&
        abs(lhs.at.timeIntervalSince(rhs.at)) < 1 &&
        lhs.device == rhs.device &&
        lhs.model == rhs.model
    }
}

public struct ChatConversation: Codable, Identifiable, Sendable {
    public let id: String
    public var title: String
    public let createdAt: Date
    public var updatedAt: Date
    public var model: String?
    public var messages: [ChatMessage]

    public init(id: String, title: String, createdAt: Date, updatedAt: Date, model: String?, messages: [ChatMessage]) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.model = model
        self.messages = messages
    }
}

extension ChatConversation: Equatable {
    public static func == (lhs: ChatConversation, rhs: ChatConversation) -> Bool {
        lhs.id == rhs.id &&
        lhs.title == rhs.title &&
        abs(lhs.createdAt.timeIntervalSince(rhs.createdAt)) < 1 &&
        abs(lhs.updatedAt.timeIntervalSince(rhs.updatedAt)) < 1 &&
        lhs.model == rhs.model &&
        lhs.messages == rhs.messages
    }
}

public struct ChatSummary: Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let updatedAt: Date
    public let preview: String
    public let count: Int
}

private let validIdPattern = "^[A-Za-z0-9-]{1,64}$"

private func validateId(_ id: String) throws {
    guard NSPredicate(format: "SELF MATCHES %@", validIdPattern).evaluate(with: id) else {
        throw NSError(domain: "ChatStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid conversation id"])
    }
}

private func firstWords(_ text: String, _ count: Int) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let words = trimmed.split(separator: " ")
    if words.count <= count { return trimmed }
    let joined = Array(words.prefix(count)).joined(separator: " ")
    let limit = 48
    if joined.utf8.count <= limit { return joined + "…" }
    let truncated = String(joined.prefix(limit))
    return truncated + "…"
}

private func previewText(_ text: String) -> String {
    let limit = 80
    if text.utf8.count <= limit { return text }
    return String(text.prefix(limit))
}

public struct ChatStore {
    private let directory: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(directory: URL) throws {
        self.directory = directory
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
    }

    private func fileURL(for id: String) -> URL {
        directory.appendingPathComponent(id + ".json")
    }

    public func list() throws -> [ChatSummary] {
        let contents = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
        var summaries: [ChatSummary] = []
        for url in contents where url.pathExtension == "json" {
            let data: Data
            do { data = try Data(contentsOf: url) } catch { continue }
            let conv: ChatConversation
            do { conv = try decoder.decode(ChatConversation.self, from: data) } catch { continue }
            let lastMsg = conv.messages.last
            let pv = lastMsg.map { previewText($0.text) } ?? ""
            summaries.append(ChatSummary(id: conv.id, title: conv.title, updatedAt: conv.updatedAt, preview: pv, count: conv.messages.count))
        }
        summaries.sort { $0.updatedAt > $1.updatedAt }
        return summaries
    }

    public func load(_ id: String) throws -> ChatConversation {
        try validateId(id)
        let url = fileURL(for: id)
        let data = try Data(contentsOf: url)
        return try decoder.decode(ChatConversation.self, from: data)
    }

    @discardableResult
    public func create(title: String? = nil, model: String? = nil, now: Date) throws -> ChatConversation {
        let id = UUID().uuidString
        let titleValue = title ?? "New chat"
        let conv = ChatConversation(id: id, title: titleValue, createdAt: now, updatedAt: now, model: model, messages: [])
        try write(conv)
        return conv
    }

    @discardableResult
    public func append(_ message: ChatMessage, to id: String) throws -> ChatConversation {
        try validateId(id)
        var conv = try load(id)
        if conv.title == "New chat" && message.role == .user {
            conv.title = firstWords(message.text, 6)
        }
        conv.messages.append(message)
        let newest = (conv.messages.map(\.at) + [message.at]).max() ?? message.at
        conv.updatedAt = newest
        try write(conv)
        return conv
    }

    @discardableResult
    public func merge(_ messages: [ChatMessage], into id: String) throws -> ChatConversation {
        try validateId(id)
        var conv = try load(id)
        let existingIds = Set(conv.messages.map(\.id))
        for msg in messages where !existingIds.contains(msg.id) {
            conv.messages.append(msg)
        }
        if conv.title == "New chat" {
            let firstUser = conv.messages.first { $0.role == .user }
            if let fu = firstUser {
                conv.title = firstWords(fu.text, 6)
            }
        }
        conv.messages.sort { $0.at < $1.at || ($0.at == $1.at && $0.id < $1.id) }
        let newest = conv.messages.map(\.at).max() ?? conv.updatedAt
        conv.updatedAt = newest
        try write(conv)
        return conv
    }

    public func rename(_ id: String, to title: String) throws {
        try validateId(id)
        var conv = try load(id)
        conv.title = title
        try write(conv)
    }

    public func setModel(_ id: String, to model: String?) throws {
        try validateId(id)
        var conv = try load(id)
        conv.model = model
        try write(conv)
    }

    public func delete(_ id: String) throws {
        try validateId(id)
        let url = fileURL(for: id)
        try FileManager.default.removeItem(at: url)
    }

    private func write(_ conv: ChatConversation) throws {
        let data = try encoder.encode(conv)
        try data.write(to: fileURL(for: conv.id), options: .atomic)
    }
}
