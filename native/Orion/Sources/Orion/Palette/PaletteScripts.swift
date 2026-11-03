import Foundation

/// Runs ORION's scripts with the bundled node, the way the Mac app already runs `orion-apps game-prep` (GamePrepRunner).
/// Always call off the main thread.
enum PaletteScripts {
    struct Result { let ok: Bool; let text: String }

    private static var node: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node").path
        return [home, "/opt/homebrew/bin/node", "/usr/local/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? home
    }

    static func run(_ name: String, _ arguments: [String], timeout: TimeInterval = 30) -> Result {
        let script = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Desktop/ORION/scripts/\(name)").path
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script] + arguments
        process.standardOutput = pipe
        process.standardError = pipe
        do { try process.run() } catch { return Result(ok: false, text: "") }
        let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        killer.cancel()
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return Result(ok: process.terminationStatus == 0, text: text)
    }

    /// The last JSON line of a `--json` script, as a dictionary.
    static func json(_ text: String) -> [String: Any]? {
        guard let line = text.split(separator: "\n").last else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
    }

    /// The sentence a `--json` orion-apps run wants said, falling back to the raw text.
    static func say(_ result: Result, fallback: String) -> String {
        if let say = json(result.text)?["say"] as? String, !say.isEmpty { return say }
        if let headline = json(result.text)?["headline"] as? String, !headline.isEmpty { return headline }
        return result.ok && !result.text.isEmpty && json(result.text) == nil ? result.text : fallback
    }
}
