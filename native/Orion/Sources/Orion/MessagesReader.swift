import Combine
import Foundation
import SQLite3

/*
 iMessage and SMS, read-only, straight out of the Messages database.

 There is no Messages API on macOS. None. The only source of a conversation is
 `~/Library/Messages/chat.db`, which is an ordinary SQLite file that macOS
 protects with Full Disk Access — and FDA cannot be requested from code. There
 is no entitlement for it and no prompt to raise: the user grants it by hand in
 System Settings and nowhere else. So this detects whether it can read, says so
 precisely when it cannot, and never pretends the absence of messages means
 there are none.

 Two things about this database break almost every naive attempt at it, and both
 are handled below.

 1. THE CLOCK. `message.date` is not a Unix timestamp. It is NANOSECONDS since
    2001-01-01 — Apple's epoch, and the nanosecond scale arrived in macOS 10.13
    while older rows are in seconds. Reading it as Unix time puts every message
    in 1970; reading nanoseconds as seconds puts them tens of thousands of years
    out. Both are detected by magnitude rather than assumed.

 2. THE TEXT IS OFTEN NOT IN THE TEXT COLUMN. Modern Messages writes the body
    into `attributedBody` — an NSArchiver typedstream blob — and leaves `text`
    NULL. A reader that only selects `text` silently loses a large share of
    recent messages, which looks like the conversation having gaps in it rather
    than like a bug. `TypedStream.string(in:)` digs the string out.

 Read-only, and structurally so: the database is opened with SQLITE_OPEN_READONLY
 and there is no INSERT, UPDATE or DELETE anywhere in this file. Orion reads
 messages; it does not send them.
*/

struct Message: Identifiable, Equatable {
    let id: Int64
    /// Phone number or Apple ID of the other party.
    var handle: String
    var text: String
    var date: Date
    var isFromMe: Bool
    var isRead: Bool
    var service: String
    /// The chat this belongs to, so a group thread stays together.
    var chatID: Int64
    /// Group chats have a display name; one-to-one threads do not.
    var chatName: String
}

struct Conversation: Identifiable, Equatable {
    let id: Int64
    /// Resolved to a contact name where one exists.
    var title: String
    var handles: [String]
    var lastMessage: String
    var lastDate: Date
    var unread: Int
    var isGroup: Bool
    var lastFromMe: Bool
}

final class MessagesReader: ObservableObject {

    enum Access: Equatable {
        case unknown
        /// The database is readable.
        case granted
        /// The file exists and macOS refused. This is Full Disk Access, always.
        case needsFullDisk
        /// No Messages database on this Mac at all.
        case noDatabase
        case failed(String)

        var isGranted: Bool { self == .granted }
    }

    @Published private(set) var access: Access = .unknown
    @Published private(set) var conversations: [Conversation] = []
    @Published private(set) var messages: [Message] = []
    @Published private(set) var lastSyncedAt: Date?
    @Published var selectedChat: Int64?

    /// Resolves handles to names. Set by the view that owns both.
    weak var contacts: ContactsClient?

    private var timer: Timer?

    private var path: String {
        (NSHomeDirectory() as NSString).appendingPathComponent("Library/Messages/chat.db")
    }

    // MARK: - Lifecycle

    func start() {
        refresh()
        // Two minutes. Messages arrive whenever they arrive, and polling a
        // half-gigabyte database harder than that buys nothing.
        timer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            guard FileManager.default.fileExists(atPath: self.path) else {
                DispatchQueue.main.async {
                    self.access = .noDatabase
                    OrionLog.write("[messages] no chat.db on this Mac")
                }
                return
            }

            var handle: OpaquePointer?
            // Read-only, and `immutable=1` so a live Messages.app holding the
            // write-ahead log cannot block the read or be disturbed by it.
            let uri = "file:\(self.path)?mode=ro&immutable=1"
            let result = sqlite3_open_v2(uri, &handle,
                                         SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil)
            guard result == SQLITE_OK, let database = handle else {
                let message = String(cString: sqlite3_errmsg(handle))
                sqlite3_close(handle)
                DispatchQueue.main.async {
                    // "authorization denied" is macOS refusing the file, which
                    // is Full Disk Access and nothing else. Saying "database
                    // error" here would send the user looking in the wrong
                    // place entirely.
                    self.access = message.localizedCaseInsensitiveContains("authorization")
                        || message.localizedCaseInsensitiveContains("unable to open")
                        ? .needsFullDisk
                        : .failed(message)
                    OrionLog.write("[messages] open failed — \(message)")
                }
                return
            }
            defer { sqlite3_close(database) }

            let rows = self.readRecent(database)
            let grouped = self.summarise(rows)

            DispatchQueue.main.async {
                self.access = .granted
                self.messages = rows
                self.conversations = grouped
                self.lastSyncedAt = Date()
                OrionLog.write("[messages] \(rows.count) message(s) across \(grouped.count) conversation(s)")
                Self.exportIncoming(rows, conversations: grouped)
            }
        }
    }

    /// The text gate (orion-watches, 2026-10-07): incoming texts from the last
    /// day, for a script that cannot read chat.db itself (Full Disk Access
    /// belongs to this app). Private to his account; text only, newest last.
    static func exportIncoming(_ rows: [Message], conversations: [Conversation]) {
        let names = Dictionary(conversations.map { ($0.id, $0.title) }, uniquingKeysWith: { a, _ in a })
        let cutoff = Date().addingTimeInterval(-86_400)
        let iso = ISO8601DateFormatter()
        let items: [[String: Any]] = rows.filter { !$0.isFromMe && $0.date > cutoff && !$0.text.isEmpty }
            .sorted { $0.date < $1.date }.suffix(60)
            .map { m in
                let chat = names[m.chatID] ?? m.handle
                let group = !m.chatName.isEmpty
                return ["id": m.id, "sender": group ? "\(m.handle) in \(m.chatName)" : chat, "handle": m.handle,
                        "text": String(m.text.prefix(500)), "date": iso.string(from: m.date), "group": group]
            }
        guard let data = try? JSONSerialization.data(withJSONObject: items) else { return }
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/messages-recent.json")
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    // MARK: - Reading

    /// The last few hundred messages. Not the whole history: this database runs
    /// to hundreds of megabytes and nothing on screen wants all of it.
    private func readRecent(_ database: OpaquePointer, limit: Int = 400) -> [Message] {
        let sql = """
        SELECT m.ROWID, m.date, m.is_from_me, m.is_read, m.text, m.attributedBody,
               m.service, h.id, c.ROWID, IFNULL(c.display_name, '')
        FROM message AS m
        LEFT JOIN handle AS h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join AS cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat AS c ON cmj.chat_id = c.ROWID
        WHERE m.associated_message_type = 0
        ORDER BY m.date DESC
        LIMIT ?;
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            OrionLog.write("[messages] prepare failed — \(String(cString: sqlite3_errmsg(database)))")
            return []
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int(statement, 1, Int32(limit))

        var found: [Message] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let rowID = sqlite3_column_int64(statement, 0)
            let rawDate = sqlite3_column_int64(statement, 1)
            let fromMe = sqlite3_column_int(statement, 2) == 1
            let read = sqlite3_column_int(statement, 3) == 1

            var text = MessagesReader.text(statement, 4) ?? ""
            if text.isEmpty {
                // The common modern case: `text` is NULL and the body lives in
                // the archived attributed string.
                if let blob = sqlite3_column_blob(statement, 5) {
                    let size = Int(sqlite3_column_bytes(statement, 5))
                    let data = Data(bytes: blob, count: size)
                    text = TypedStream.string(in: data) ?? ""
                }
            }
            guard !text.isEmpty else { continue }

            found.append(Message(
                id: rowID,
                handle: MessagesReader.text(statement, 7) ?? "unknown",
                text: text,
                date: MessagesReader.date(from: rawDate),
                isFromMe: fromMe,
                isRead: read || fromMe,
                service: MessagesReader.text(statement, 6) ?? "iMessage",
                chatID: sqlite3_column_int64(statement, 8),
                chatName: MessagesReader.text(statement, 9) ?? ""
            ))
        }
        return found
    }

    /// One row per conversation, newest first.
    private func summarise(_ rows: [Message]) -> [Conversation] {
        var byChat: [Int64: [Message]] = [:]
        for row in rows { byChat[row.chatID, default: []].append(row) }

        return byChat.compactMap { chatID, thread -> Conversation? in
            guard let newest = thread.max(by: { $0.date < $1.date }) else { return nil }
            let handles = Array(Set(thread.map(\.handle))).sorted()
            let isGroup = !newest.chatName.isEmpty || handles.count > 1

            let title: String
            if !newest.chatName.isEmpty {
                title = newest.chatName
            } else if isGroup {
                title = handles
                    .map { contacts?.name(forHandle: $0) ?? ContactsClient.pretty(handle: $0) }
                    .prefix(3)
                    .joined(separator: ", ")
            } else {
                let handle = handles.first ?? newest.handle
                title = contacts?.name(forHandle: handle) ?? ContactsClient.pretty(handle: handle)
            }

            return Conversation(
                id: chatID,
                title: title,
                handles: handles,
                lastMessage: newest.text,
                lastDate: newest.date,
                // Only incoming messages can be unread; the flag is meaningless
                // on ones you sent.
                unread: thread.filter { !$0.isRead && !$0.isFromMe }.count,
                isGroup: isGroup,
                lastFromMe: newest.isFromMe
            )
        }
        .sorted { $0.lastDate > $1.lastDate }
    }

    func thread(_ chatID: Int64) -> [Message] {
        messages.filter { $0.chatID == chatID }.sorted { $0.date < $1.date }
    }

    var unreadTotal: Int { conversations.reduce(0) { $0 + $1.unread } }

    // MARK: - Columns

    private static func text(_ statement: OpaquePointer?, _ index: Int32) -> String? {
        guard let raw = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: raw)
    }

    /// Apple's epoch, at whichever scale this row happens to use.
    ///
    /// Messages switched to nanoseconds in macOS 10.13 and never rewrote the
    /// old rows, so a database with any history in it contains both. The
    /// threshold is magnitude: seconds-since-2001 for a real date is a
    /// nine-or-ten-digit number, nanoseconds is eighteen.
    static func date(from raw: Int64) -> Date {
        let appleEpoch: TimeInterval = 978_307_200
        let seconds = raw > 1_000_000_000_000 ? Double(raw) / 1_000_000_000 : Double(raw)
        return Date(timeIntervalSince1970: seconds + appleEpoch)
    }
}

/// Pulls the readable string out of an NSArchiver typedstream.
///
/// This exists because modern Messages stores the body of a message in
/// `attributedBody` and leaves `text` NULL. The blob is an `NSAttributedString`
/// written by the OLD NSArchiver, not NSKeyedArchiver — so
/// `NSKeyedUnarchiver` cannot read it, and `NSUnarchiver`, which could, was
/// removed from the SDK. That leaves reading the format directly.
///
/// The shape being matched: the class name `NSString`, then a marker byte
/// `0x2B`, then a length, then UTF-8. Lengths under 128 are a single byte;
/// longer ones are `0x81` followed by a little-endian UInt16.
///
/// Deliberately conservative — anything it does not recognise returns nil, and
/// the caller drops the message rather than showing a row of mojibake.
enum TypedStream {

    static func string(in data: Data) -> String? {
        let bytes = [UInt8](data)
        guard let marker = find(Array("NSString".utf8), in: bytes) else { return nil }

        var index = marker + "NSString".count
        // Skip the class-version bytes to the '+' that introduces the value.
        while index < bytes.count, bytes[index] != 0x2B { index += 1 }
        guard index < bytes.count else { return nil }
        index += 1
        guard index < bytes.count else { return nil }

        var length = Int(bytes[index])
        index += 1
        if length == 0x81 {
            guard index + 1 < bytes.count else { return nil }
            length = Int(bytes[index]) | (Int(bytes[index + 1]) << 8)
            index += 2
        } else if length > 0x81 {
            // Longer encodings exist and are rare. Refusing is better than
            // guessing and rendering garbage.
            return nil
        }

        guard length > 0, index + length <= bytes.count else { return nil }
        let slice = Data(bytes[index..<(index + length)])
        guard let text = String(data: slice, encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func find(_ needle: [UInt8], in haystack: [UInt8]) -> Int? {
        guard !needle.isEmpty, haystack.count >= needle.count else { return nil }
        for start in 0...(haystack.count - needle.count) {
            var matched = true
            for offset in 0..<needle.count where haystack[start + offset] != needle[offset] {
                matched = false
                break
            }
            if matched { return start }
        }
        return nil
    }
}
