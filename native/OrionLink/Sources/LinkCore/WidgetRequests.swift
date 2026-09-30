import Foundation
import MobileCore

/// Buttons on the Mac's widgets ("+1 water", "Started", "Done"). A widget runs
/// sandboxed and cannot touch ORION's files, so it appends one line to
/// `widget-requests.jsonl` in the shared app group and ORION Link carries it out
/// on its next tick. Anything not on this list is dropped.
public struct WidgetRequests {
    public enum Action: String, CaseIterable, Sendable {
        case water, checkinStarted = "checkin.started", checkinSnooze = "checkin.snooze", checkinDone = "checkin.done"

        /// The phone-link entry the same button sends from the iPhone.
        public var entry: LinkLog {
            switch self {
            case .water: return .water(delta: 1)
            case .checkinStarted: return .checkin(action: "started")
            case .checkinSnooze: return .checkin(action: "snooze")
            case .checkinDone: return .checkin(action: "done")
            }
        }
    }

    public struct Request: Equatable, Sendable {
        public let id: String
        public let action: Action
        public let at: Date
    }

    public let file: URL
    public init(file: URL) { self.file = file }

    /// Everything waiting, oldest first, and the file emptied. Requests older than
    /// ten minutes are dropped: a tap nobody saw happen should not surprise anyone.
    public func take(now: Date = Date()) -> [Request] {
        guard let text = try? String(contentsOf: file, encoding: .utf8), !text.isEmpty else { return [] }
        try? "".write(to: file, atomically: true, encoding: .utf8)
        return text.split(separator: "\n").prefix(50).compactMap { line in
            guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let id = object["id"] as? String, id.count <= 64,
                  let action = (object["action"] as? String).flatMap(Action.init(rawValue:)),
                  let at = (object["at"] as? String).flatMap({ ISO8601DateFormatter().date(from: $0) }),
                  now.timeIntervalSince(at) < 600, at.timeIntervalSince(now) < 60 else { return nil }
            return Request(id: id, action: action, at: at)
        }
    }

    /// What a widget writes. Public so the tests and the widget agree on the line.
    public static func line(action: Action, id: String = UUID().uuidString, at: Date = Date()) -> String {
        let object: [String: String] = ["id": id, "action": action.rawValue, "at": ISO8601DateFormatter().string(from: at)]
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}
