import Foundation

/*
 The one narrow, deliberate exception to "never touch global system volume."

 This file used to duck GLOBAL system volume for the entire time Orion was in
 `.listening`, restoring the instant that phase ended -- which meant the room
 came back to full volume at exactly the moment Orion started THINKING or
 SPEAKING, the worst possible instant, because that is when a competing volume
 is most distracting. Meanwhile `SessionService/AudioCoordinator` already
 carried a correct, opposite rule in its own header: "never touch global
 system volume", ducking only the Orion-owned clip. Two files, two
 contradictory policies, both live. That is what this pass resolves.

 The resolution is not "delete this file" -- it is "make this file's role
 exactly as narrow as the platform actually requires":

   - Media that can be addressed on its own (the Orion-owned clip, Apple
     Music) is ducked at the SOURCE, for the whole exchange, and never touches
     anything else on the machine. That lives in `AudioCoordinator`, via
     `beginConversation()` / `endConversation()`.
   - Everything else on this Mac -- a browser tab, anything not scriptable --
     has no per-app volume API on macOS. There is no way to lower "whatever
     Nick happens to be listening to" without lowering the whole machine. THIS
     is the one legitimate use for a system-volume duck, and it is why this
     file still exists.

 Why the system-volume duck below is LISTENING-ONLY and cannot be widened to
 span thinking + speaking the way the Music duck can: Orion's own TTS plays
 out through the same shared output hardware a system-volume change
 attenuates. Ducking system volume while Orion is SPEAKING would duck Orion's
 own voice along with everything else -- that is not a policy choice to
 configure around, it is what "system volume" means. Apple Music's `sound
 volume` and the Orion-owned clip's own gain are independent audio streams
 from Orion's playback and can safely stay low through the whole exchange;
 system volume cannot. So this stays scoped to `.listening`, same as it always
 was, but fixed in every other way: opt-in (default OFF -- Orion must not
 reach for this by default when Music or the clip is already handling it),
 crash-safe (a marker on disk, checked at the next launch), and never left
 stuck with no visible cause.

 Ducking, not muting, for the same reason as before: muting a track mid-song
 is jarring and destroys the cue that Orion is listening at all.
*/

enum AudioDucking {

    /// Off by default. There is no Preferences toggle wired to this yet --
    /// see the handoff note in PHASE_AUDIO_COEXISTENCE.md -- so today this
    /// fallback never fires unless something in the Orion target sets it,
    /// which nothing does yet. Recorded here rather than silently defaulting
    /// to "on", which would be reaching for the whole machine's volume by
    /// default -- exactly the rule this file exists to stop breaking.
    static var systemVolumeFallbackEnabled = false

    /// The level before this fallback touched it. `nil` means it is not
    /// ducking, and is the only thing that decides whether `endListeningFallback()`
    /// does anything.
    private static var previousVolume: Int?

    private static let duckFactor = 0.3
    private static let floor = 12
    private static let queue = DispatchQueue(label: "com.nickmadaio.orion.system-volume-fallback")
    private static var recoveredFromCrash = false

    // MARK: Public API

    /// Call when phase enters `.listening`. No-op unless
    /// `systemVolumeFallbackEnabled` has been turned on.
    static func beginListeningFallback() {
        queue.async {
            ensureRecoveredFromCrash()
            guard systemVolumeFallbackEnabled else { return }
            guard previousVolume == nil else { return }
            guard let current = currentVolume(), current > floor else { return }
            previousVolume = current
            let target = max(1, Int(Double(current) * duckFactor))
            setVolume(target)
            SystemVolumeDuckState.persist(priorVolume: current)
            OrionLog.write("[audio] system-volume fallback: ducked \(current) -> \(target)")
        }
    }

    /// Call when phase leaves `.listening`. Restores only if Nick did not
    /// touch the volume himself meanwhile -- coming back to find the
    /// assistant overrode a deliberate turn of the volume knob is worse than
    /// leaving it low until the next explicit restore.
    static func endListeningFallback() {
        queue.async {
            guard let previous = previousVolume else { return }
            let expected = max(1, Int(Double(previous) * duckFactor))
            guard let now = currentVolume() else {
                previousVolume = nil
                SystemVolumeDuckState.clear()
                return
            }
            guard abs(now - expected) <= 2 else {
                OrionLog.write("[audio] system-volume fallback: NOT restoring -- "
                    + "volume changed by hand while listening")
                previousVolume = nil
                SystemVolumeDuckState.clear()
                return
            }
            previousVolume = nil
            setVolume(previous)
            SystemVolumeDuckState.clear()
            OrionLog.write("[audio] system-volume fallback: restored \(previous)")
        }
    }

    /// The emergency panic button's system-volume half. Unconditional --
    /// forces the volume back regardless of whether it looks hand-changed,
    /// because this is Nick explicitly asking for it back, not an automatic
    /// restore. Pair with `AudioCoordinator.reset()` for the Music/clip half;
    /// together those two calls are "restore audio now".
    ///
    /// Safe to call when nothing is ducked -- it is then a no-op.
    static func restoreSystemVolumeNow() {
        queue.async {
            ensureRecoveredFromCrash()
            guard let previous = previousVolume else { return }
            previousVolume = nil
            setVolume(previous)
            SystemVolumeDuckState.clear()
            OrionLog.write("[audio] emergency restore: system volume forced back to \(previous)")
        }
    }

    // MARK: Crash recovery

    /// Orion did not exit cleanly last time and may have left system volume
    /// at 30% with nothing left running to explain why. Checked once, lazily,
    /// on the first call any caller makes into this file.
    private static func ensureRecoveredFromCrash() {
        guard !recoveredFromCrash else { return }
        recoveredFromCrash = true
        guard let state = SystemVolumeDuckState.load() else { return }
        guard let now = currentVolume() else { SystemVolumeDuckState.clear(); return }
        let expected = max(1, Int(Double(state.priorVolume) * duckFactor))
        if abs(now - expected) <= 2 {
            setVolume(state.priorVolume)
            OrionLog.write("[audio] recovered a system-volume duck left over from a run that "
                + "did not exit cleanly -- restored to \(state.priorVolume)")
        } else {
            OrionLog.write("[audio] a stale system-volume duck marker was found, but the volume "
                + "has since changed -- leaving it, only clearing the marker")
        }
        SystemVolumeDuckState.clear()
    }

    // MARK: AppleScript

    private static func currentVolume() -> Int? {
        guard let output = run("output volume of (get volume settings)") else {
            return nil
        }
        return Int(output.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func setVolume(_ level: Int) {
        _ = run("set volume output volume \(max(0, min(100, level)))")
    }

    @discardableResult
    private static func run(_ script: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            OrionLog.write("[audio] osascript failed: \(error.localizedDescription)")
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Crash-safety marker for the system-volume fallback, mirroring
/// `AudioRouteState` in AudioRoute.swift -- same shape, same reason: the
/// fallback's own in-memory state dies with the process, so recovery has to
/// read it back from disk.
private enum SystemVolumeDuckState {
    struct State: Codable {
        let priorVolume: Int
    }

    private static let path: String = {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".openclaw")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return (dir as NSString).appendingPathComponent("orion-system-volume-duck-state.json")
    }()

    static func persist(priorVolume: Int) {
        guard let data = try? JSONEncoder().encode(State(priorVolume: priorVolume)) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    static func load() -> State? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        return try? JSONDecoder().decode(State.self, from: data)
    }

    static func clear() {
        try? FileManager.default.removeItem(atPath: path)
    }
}
