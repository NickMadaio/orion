import AppKit
import Foundation
import MouseKit

/// Runs `orion-apps game-prep --game <key> --json` off the main thread and hands back its headline ("closed Chrome and 4 helpers, freed ~6 GB").
/// nil means it did not run or gave no answer, and the bubble then claims nothing was closed. Also relaunches apps after the game.
enum GamePrepRunner {
    private static let script = "/Users/nickmadaio/Desktop/ORION/scripts/orion-apps"
    private static var node: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node").path
        return [home, "/opt/homebrew/bin/node", "/usr/local/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? home
    }

    static func run(game: GameRef, completion: @escaping (String?) -> Void) {
        DispatchQueue.global(qos: .utility).async {
            let process = Process(), pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [script, "game-prep", "--game", game.key, "--json"]
            process.standardOutput = pipe; process.standardError = Pipe()
            var headline: String?
            if (try? process.run()) != nil {
                let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + 90, execute: killer)
                let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit(); killer.cancel()
                if let last = String(decoding: data, as: UTF8.self).split(separator: "\n").last,
                   let obj = try? JSONSerialization.jsonObject(with: Data(last.utf8)) as? [String: Any], obj["ok"] as? Bool == true {
                    headline = obj["headline"] as? String
                }
            } else { OrionLog.write("[game] could not run orion-apps game-prep") }
            DispatchQueue.main.async { completion(headline) }
        }
    }

    /// Relaunches the apps only (never helpers) without taking focus from anything.
    static func reopen(_ apps: [ClosedApp]) {
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        for app in GameWords.reopenable(apps) {
            guard let path = app.path else { continue }
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: config) { _, error in
                if let error { OrionLog.write("[game] could not reopen \(app.name): \(error.localizedDescription)") }
            }
        }
    }
}
