import Foundation

/// A sensible speaking volume before ORION talks unprompted (2026-10-07):
/// a muted or near-silent Mac comes up, a loud one comes down. Same rule as
/// scripts/lib/reach/route.mjs `speakingVolume`.
enum ReachVolume {
    static func target(current: Int, muted: Bool, headphones: Bool) -> Int {
        let wanted = headphones ? 35 : 45
        if muted || current < 20 { return wanted }
        if current > 70 { return 55 }
        return current
    }

    private static var restore: DispatchWorkItem?

    /// Full volume, unmuted; the level he had comes back after `restoreAfter` seconds.
    static func raiseToFull(restoreAfter seconds: TimeInterval) {
        var error: NSDictionary?
        let before = NSAppleScript(source: "output volume of (get volume settings)")?.executeAndReturnError(&error).int32Value ?? 50
        let wasMuted = NSAppleScript(source: "output muted of (get volume settings)")?.executeAndReturnError(&error).booleanValue ?? false
        _ = NSAppleScript(source: "set volume output volume 100 without output muted")?.executeAndReturnError(&error)
        // A second briefing before the first restore keeps the ORIGINAL level.
        if restore == nil || restore?.isCancelled == true {
            let work = DispatchWorkItem {
                var error: NSDictionary?
                _ = NSAppleScript(source: "set volume output volume \(before)\(wasMuted ? " with output muted" : "")")?.executeAndReturnError(&error)
                restore = nil
            }
            restore = work
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
        }
    }

    static func prepare(headphones: Bool) {
        var error: NSDictionary?
        guard let settings = NSAppleScript(source: "get volume settings")?.executeAndReturnError(&error).stringValue
                ?? NSAppleScript(source: "output volume of (get volume settings)")?.executeAndReturnError(&error).stringValue else { return }
        let current = Int(settings.components(separatedBy: CharacterSet.decimalDigits.inverted).first { !$0.isEmpty } ?? "") ?? 50
        let muted = (NSAppleScript(source: "output muted of (get volume settings)")?.executeAndReturnError(&error).booleanValue) ?? false
        let level = target(current: current, muted: muted, headphones: headphones)
        guard muted || level != current else { return }
        _ = NSAppleScript(source: "set volume output volume \(level) without output muted")?.executeAndReturnError(&error)
    }
}
