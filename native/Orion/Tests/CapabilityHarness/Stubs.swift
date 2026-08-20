import Foundation

/*
 The two things Capabilities.swift reaches out of its own file for.

 Stubbed rather than dragged in, because pulling the real `GatewayClient` would
 pull the agent process runner, the socket probe and the secrets reader behind
 it — none of which the catalog or the profile ladder touch. What the harness
 checks is unchanged by these being stubs: it never runs a write.

 The paths are the real ones on purpose, so the drift check at the end of
 `main.swift` reads the config this Mac actually uses.
*/

enum GatewayClient {
    static let binaryPath = "/Users/nickmadaio/.openclaw/bin/openclaw"
    static let configPath = ("~/.openclaw/openclaw.json" as NSString).expandingTildeInPath
}

enum OrionLog {
    /// The harness has no log file, and a capability check that wrote to
    /// Orion's real log would put test noise in the place the real diagnosis
    /// gets read from.
    static func write(_ line: String) {}
}
