import Foundation

/*
 Nick sent a message on the Mac (typed or spoken): log the turn and close the curiosity ask it answers (WP3, 2026-10-16).
 The phone path does the same through orion-remote; both call `orion-inbound-turn`, which appends `{ at }` to
 inbound-turns.jsonl and runs `orion-proactive ask-outcome <askId> answered` when the message answers an open ask.
 Fire and forget: a chat turn never waits on it.
*/
enum InboundTurnLog {
    /// `node <scriptsDir>/orion-inbound-turn [--reply-to <id>] --text <message>`, or nil where it is not installed.
    static func command(text: String, replyTo: String?, node: String, scriptsDir: String,
                        exists: (String) -> Bool) -> PhaseCommand? {
        let script = scriptsDir + "/orion-inbound-turn"
        guard exists(node), exists(script) else { return nil }
        let reply = replyTo.map { ["--reply-to", $0] } ?? []
        return PhaseCommand(executable: node, arguments: [script] + reply + ["--text", String(text.prefix(200))])
    }

    private static let queue = DispatchQueue(label: "orion.inbound-turn", qos: .utility)

    static func record(text: String, replyTo: String? = OutreachReplyTo.current,
                       home: String = FileManager.default.homeDirectoryForCurrentUser.path) {
        let exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
        guard let command = command(text: text, replyTo: replyTo, node: home + "/.openclaw/tools/node-v24.15.0/bin/node",
                                    scriptsDir: home + "/.openclaw/orion-remote/scripts", exists: exists) else { return }
        queue.async { _ = PhaseHook.spawn(command) }
    }
}
