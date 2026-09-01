import Foundation

/// A turn in a conversation. Ids come from the sender, not from arrival order.
///
/// `sequence` is a hybrid counter rather than a timestamp because Phase 17's
/// rule -- do not rely only on local timestamps -- starts here: two devices with
/// clocks a minute apart must still agree on what came after what.
public struct Message: Sendable, Equatable, Identifiable {
    public enum Role: String, Sendable, CaseIterable {
        case user
        case orion
        case system
    }

    public let id: String
    public let role: Role
    public let text: String
    public let sequence: Int
    public let createdAt: Date
    public let deviceID: String
    public private(set) var pending: Bool

    public init(
        id: String,
        role: Role,
        text: String,
        sequence: Int,
        createdAt: Date,
        deviceID: String,
        pending: Bool = false
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.sequence = sequence
        self.createdAt = createdAt
        self.deviceID = deviceID
        self.pending = pending
    }

    public func settled() -> Message {
        Message(id: id, role: role, text: text, sequence: sequence,
                createdAt: createdAt, deviceID: deviceID, pending: false)
    }
}

/// The transcript, with the ordering and de-duplication rules in one place.
///
/// A store rather than an array because both rules have to hold everywhere:
/// appending the same message twice (a retry, a re-delivery, a reconnect) must
/// be harmless, and order must not depend on when a device happened to receive
/// something.
public struct Conversation: Sendable, Equatable {
    public let id: String
    public private(set) var messages: [Message] = []

    public init(id: String) {
        self.id = id
    }

    /// Insert or replace. Returns whether anything changed.
    @discardableResult
    public mutating func upsert(_ message: Message) -> Bool {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            // A duplicate is the normal case on a flaky link. Replacing rather
            // than appending means a redelivery cannot double a message, and a
            // pending message can settle in place.
            guard messages[index] != message else { return false }
            messages[index] = message
            sort()
            return true
        }
        messages.append(message)
        sort()
        return true
    }

    /// Ordering: sequence first, then device id as a tiebreak.
    ///
    /// The tiebreak is the device id and NOT the timestamp on purpose. Two
    /// devices can produce the same sequence; whichever wins, every device must
    /// pick the same one, and a device id is the only value they all agree on.
    private mutating func sort() {
        messages.sort { left, right in
            if left.sequence != right.sequence { return left.sequence < right.sequence }
            if left.deviceID != right.deviceID { return left.deviceID < right.deviceID }
            return left.id < right.id
        }
    }

    public var lastSequence: Int { messages.map(\.sequence).max() ?? 0 }

    public func message(id: String) -> Message? {
        messages.first { $0.id == id }
    }

    public var pendingCount: Int { messages.filter(\.pending).count }
}
