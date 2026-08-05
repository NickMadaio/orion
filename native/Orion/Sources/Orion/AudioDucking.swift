import Foundation

/*
 Turn the room down while Orion is listening.

 The problem this solves, in Nick's words: with music playing on speakers, the
 hands-free window never closes, because the microphone hears the speakers and
 concludes someone is still talking. The level-based end-of-turn detector is
 doing exactly what it was told; it just cannot tell his voice from Fleetwood
 Mac.

 Three ways to fix that, and it is worth being honest about why this is the one:

   1. Duck the system output while listening.  ← this
   2. Require speech-like input rather than raw level. Better in principle,
      but a VAD good enough to reject singing is not a small thing, and a bad
      one adds a new way to miss what he actually said.
   3. Voice-processing echo cancellation in `AVAudioEngine`. The textbook
      answer, and the one most likely to fight the Bluetooth profile switching
      that already degraded his playback once.

 (1) removes the cause rather than compensating for it, is about forty lines,
 and fails in an obvious direction: the worst case is music that is quieter than
 expected for a moment, which is visible and self-correcting. The other two fail
 by silently mis-hearing, which is not.

 Ducking, not muting. Muting a track mid-song is jarring and it also destroys
 the cue that Orion is listening at all -- the dip IS feedback.
*/

enum AudioDucking {

    /// The level before Orion touched it. `nil` means we are not ducking, and
    /// is the only thing that decides whether `restore()` does anything.
    private static var previousVolume: Int?

    /// How far down. Enough that a speaker no longer trips the level detector,
    /// not so far that he thinks the music stopped.
    private static let duckFactor = 0.3

    /// Below this, ducking is pointless and restoring it would be a surprise.
    private static let floor = 12

    private static let queue = DispatchQueue(label: "com.nickmadaio.orion.ducking")

    /// Drop system output volume, remembering what it was.
    ///
    /// Off the main thread: this shells out to `osascript`, which takes tens of
    /// milliseconds, and it is called at exactly the moment the user has started
    /// speaking -- the one moment the UI must not stutter.
    static func duck() {
        queue.async {
            guard previousVolume == nil else { return }
            guard let current = currentVolume(), current > floor else { return }
            previousVolume = current
            setVolume(max(1, Int(Double(current) * duckFactor)))
            OrionLog.write("[audio] ducked \(current) -> \(Int(Double(current) * duckFactor))")
        }
    }

    /// Put it back exactly where it was.
    ///
    /// If the user changed the volume himself while Orion was listening, his
    /// choice wins and nothing is restored -- coming back to find the assistant
    /// has overridden a deliberate turn of the volume knob is worse than
    /// leaving it low.
    static func restore() {
        queue.async {
            guard let previous = previousVolume else { return }
            previousVolume = nil
            let expected = max(1, Int(Double(previous) * duckFactor))
            guard let now = currentVolume() else { return }
            guard abs(now - expected) <= 2 else {
                OrionLog.write("[audio] not restoring — volume changed by hand while listening")
                return
            }
            setVolume(previous)
            OrionLog.write("[audio] restored \(previous)")
        }
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
