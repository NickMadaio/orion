//
//  The app's side of message reading, for the socket.
//
//  Orion.app holds Full Disk Access and already keeps a recent window of
//  messages in memory. This adapts that to what `SessionIPC` serves, so
//  `orion-messages` can ask the app instead of asking macOS — no new
//  permission, and one process touching the database rather than two.
//
//  It answers from the window `MessagesReader` already maintains rather than
//  running its own query. That bounds what the socket can hand out to what the
//  app was already reading, which is a smaller promise than "any message ever".
//

import Foundation
import SessionService

final class MessageBridge: MessageReading {

    private let reader: MessagesReader

    init(reader: MessagesReader) {
        self.reader = reader
    }

    /// Nil when readable. Full Disk Access has no API, so this is inferred from
    /// whether the database actually opened — see MessagesReader.Access.
    var unavailable: String? {
        switch reader.access {
        case .granted:
            return nil
        case .unknown:
            return "Orion has not read the Messages database yet."
        case .needsFullDisk:
            return "Orion needs Full Disk Access to read Messages. "
                 + "System Settings ▸ Privacy & Security ▸ Full Disk Access ▸ Orion."
        case .noDatabase:
            return "There is no Messages database on this Mac."
        case .failed(let why):
            return "Messages could not be read: \(why)"
        }
    }

    func recent(limit: Int) -> [MessageLine] {
        Array(reader.messages.prefix(limit)).map(line)
    }

    /// Matched loosely against the handle and the chat name, because he will
    /// say "Carla" and the database holds a phone number.
    func from(_ who: String, limit: Int) -> [MessageLine] {
        let needle = who.lowercased()
        return reader.messages
            .filter {
                $0.handle.lowercased().contains(needle)
                    || $0.chatName.lowercased().contains(needle)
            }
            .prefix(limit)
            .map(line)
    }

    func chats(limit: Int) -> [ChatLine] {
        var seen: [String: (Date, Int)] = [:]
        for message in reader.messages {
            let who = message.chatName.isEmpty ? message.handle : message.chatName
            guard !who.isEmpty else { continue }
            let existing = seen[who]
            seen[who] = (max(existing?.0 ?? .distantPast, message.date), (existing?.1 ?? 0) + 1)
        }
        return seen
            .map { ChatLine(who: $0.key, lastAt: $0.value.0, count: $0.value.1) }
            .sorted { ($0.lastAt ?? .distantPast) > ($1.lastAt ?? .distantPast) }
            .prefix(limit)
            .map { $0 }
    }

    private func line(_ message: Message) -> MessageLine {
        MessageLine(
            at: message.date,
            who: message.isFromMe
                ? "me"
                : (message.chatName.isEmpty ? message.handle : message.chatName),
            text: message.text,
            fromMe: message.isFromMe
        )
    }
}
