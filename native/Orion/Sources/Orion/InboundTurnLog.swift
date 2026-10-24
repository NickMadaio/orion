import Foundation

/*
 Nick sent a message on the Mac (typed or spoken): log the turn and close the curiosity ask it answers (WP3, 2026-10-16).
 The phone path does the same through orion-remote; both call `orion-inbound-turn`, which appends `{ at }` to
 inbound-turns.jsonl and runs `orion-proactive ask-outcome <askId> answered` when the message answers an open ask.
 Fire and forget: a chat turn never waits on it, except (2026-10-23) for up to a few seconds before the gateway call:
 with `--session` the script writes the outreach he is answering into that session as ORION's own turn (chat.inject), so the
 reply's model sees it as conversation. `settle()` is that short wait; a slow or missing script never holds the turn longer.
*/
enum InboundTurnLog {
    /// `node <scriptsDir>/orion-inbound-turn [--reply-to <id>] --text <message>`, or nil where it is not installed.
    /// How long the turn waits for the inject; the script is told to finish (or give up) `injectMargin` before that.
    static let settleSeconds: TimeInterval = 6
    static let injectMargin: TimeInterval = 1

    static func command(text: String, replyTo: String?, session: String? = nil, injectBy: Date? = nil, node: String, scriptsDir: String,
                        exists: (String) -> Bool) -> PhaseCommand? {
        let script = scriptsDir + "/orion-inbound-turn"
        guard exists(node), exists(script) else { return nil }
        let reply = replyTo.map { ["--reply-to", $0] } ?? []
        let target = session.map { ["--session", $0] + (injectBy.map { ["--inject-by", String(Int64($0.timeIntervalSince1970 * 1000))] } ?? []) } ?? []
        return PhaseCommand(executable: node, arguments: [script] + reply + target + ["--text", String(text.prefix(200))])
    }

    private static let queue = DispatchQueue(label: "orion.inbound-turn", qos: .utility)

    static func record(text: String, replyTo: String? = nil, session: String? = nil,
                       home: String = FileManager.default.homeDirectoryForCurrentUser.path) {
        let exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
        let deadline = session == nil ? nil : Date().addingTimeInterval(settleSeconds - injectMargin)
        guard let command = command(text: text, replyTo: replyTo, session: session, injectBy: deadline, node: home + "/.openclaw/tools/node-v24.15.0/bin/node",
                                    scriptsDir: home + "/.openclaw/orion-remote/scripts", exists: exists) else { return }
        queue.async { _ = PhaseHook.spawn(command) }
    }

    /// Waits (at most `timeout`) for the recorded turns to finish, so the outreach is in the session before the turn runs.
    @discardableResult
    static func settle(timeout: TimeInterval = settleSeconds) -> Bool {
        let done = DispatchSemaphore(value: 0)
        queue.async { done.signal() }
        return done.wait(timeout: .now() + timeout) == .success
    }
}
