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
