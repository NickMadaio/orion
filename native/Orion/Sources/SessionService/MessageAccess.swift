//
//  Serving messages over the socket that already exists.
//
//  The obvious implementation of `orion-messages` read chat.db directly, and it
//  could not work: macOS attributes Full Disk Access to the RESPONSIBLE process,
//  and the process running an allowlisted wrapper is the OpenClaw gateway's
//  node binary, which does not have it. Granting FDA to a node binary buried in
//  a tools directory is both awkward and a much broader grant than anybody
//  wanted.
//
//  Orion.app ALREADY has Full Disk Access and already reads chat.db — it has
//  been doing so on a timer this whole time. So the wrapper asks the app rather
//  than asking macOS, which needs no new permission at all and reuses the
//  client/server shape the session already uses. The app is the only process
//  that touches the database, which is the same single-reader discipline that
//  keeps session state honest.
//
//  A protocol rather than a direct dependency because SessionService must not
//  know what a `Message` is. The app supplies the adapter.
//

import Foundation

public struct MessageLine: Codable, Equatable, Sendable {
    public let at: Date
    public let who: String
    public let text: String
    public let fromMe: Bool

    public init(at: Date, who: String, text: String, fromMe: Bool) {
        self.at = at
        self.who = who
        self.text = text
        self.fromMe = fromMe
    }
}

public struct ChatLine: Codable, Equatable, Sendable {
    public let who: String
    public let lastAt: Date?
    public let count: Int

    public init(who: String, lastAt: Date?, count: Int) {
        self.who = who
        self.lastAt = lastAt
        self.count = count
    }
}

/// What the app has to provide for the socket to answer message questions.
///
/// Every method can report unavailability, because "no messages" and "Orion
/// cannot read the database" are different answers and only one of them is
/// about Carla.
public protocol MessageReading: AnyObject {
    /// Nil when readable; a sentence when not.
    var unavailable: String? { get }

    func recent(limit: Int) -> [MessageLine]
    func from(_ who: String, limit: Int) -> [MessageLine]
    func chats(limit: Int) -> [ChatLine]
}
