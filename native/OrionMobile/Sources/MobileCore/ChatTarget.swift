import Foundation

/// Which conversation a message from Home goes into (w20). Home and the chat tab must be ONE conversation, so ORION remembers
/// what he typed on Home when he opens chat and continues: the chat he has open, else the most recent chat, else a new one.
public enum ChatTarget {
    public static func resolve(current: String?, recent: [(id: String?, at: Date)], make: () -> String = { UUID().uuidString }) -> String {
        if let current, !current.isEmpty { return current }
        let latest = recent.filter { !($0.id ?? "").isEmpty }.max { $0.at < $1.at }
        return latest?.id ?? make()
    }
}
