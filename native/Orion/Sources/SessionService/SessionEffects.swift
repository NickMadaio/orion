//
//  Carrying out what `reconcile` asked for.
//
//  The one rule that shapes this file: a method returns true ONLY if the thing
//  actually happened. The service acknowledges an effect on the strength of that
//  boolean, and an acknowledged effect is never emitted again — so returning
//  true for something that failed is how a session goes quiet forever with
//  nothing in a log.
//
//  Speaking is a closure rather than a dependency because Gate 6 replaces
//  `/usr/bin/say` with Orion's real voice through the AudioCoordinator. Until
//  then the announcements are written to the log, which is honest: they are
//  recorded, they are just not spoken yet.
//

import Foundation
import SessionDomain

public final class SessionEffects: SessionEffectHandler {

    private let clips: ClipPlaying
    private let speak: (String) -> Bool
    private let log: (String) -> Void

    /// Set when a clip could not be played, so the UI can say why a focus block
    /// is silent instead of showing a contented-looking player.
    public private(set) var clipProblem: String?

    /// Absences the session wants Nick asked about. Held rather than acted on:
    /// the domain does not decide what an absence was, and neither does this.
    /// Gate 6's negotiation drains these.
    public private(set) var pendingAbsences: [(seconds: TimeInterval, phaseIndex: Int)] = []

    public init(clips: ClipPlaying,
                speak: @escaping (String) -> Bool = { _ in true },
                log: @escaping (String) -> Void = { _ in }) {
        self.clips = clips
        self.speak = speak
        self.log = log
    }

    // MARK: SessionEffectHandler

    public func announce(_ announcement: Announcement) -> Bool {
        let line = Self.sentence(for: announcement)
        log("[session] \(line)")
        return speak(line)
    }

    public func startClip(_ clip: ClipAssignment, phaseIndex: Int) -> Bool {
        switch clips.play(clip.name) {
        case .success:
            clipProblem = nil
            return true
        case .failure(let failure):
            // Deliberately TRUE. A missing clip must not stop the session — the
            // block still runs, in silence, and the reason is surfaced. Returning
            // false would leave the effect pending and retry it every thirty
            // seconds for fifty minutes, which turns one missing file into a
            // log full of the same line.
            clipProblem = failure.reason
            log("[session] the block is running without audio — \(failure.reason)")
            return true
        }
    }

    public func stopClip() -> Bool {
        clips.stop()
        return true
    }

    public func askAboutAbsence(seconds: TimeInterval, phaseIndex: Int) -> Bool {
        pendingAbsences.append((seconds, phaseIndex))
        log("[session] \(Int(seconds / 60))m unaccounted for in phase \(phaseIndex)")
        return true
    }

    public func reportClockAnomaly(seconds: TimeInterval) -> Bool {
        log("[session] the clock moved by \(Int(seconds))s during this session; "
            + "the numbers are approximate")
        return true
    }

    // MARK: Pause and resume

    /// Pause keeps the clip's offset, so a resumed break carries on where it
    /// was instead of restarting. Idempotent in both directions.
    public func setAudioPaused(_ paused: Bool) {
        paused ? clips.pause() : clips.resume()
    }

    public func drainAbsences() -> [(seconds: TimeInterval, phaseIndex: Int)] {
        defer { pendingAbsences = [] }
        return pendingAbsences
    }

    // MARK: Words

    /// Plain sentences. The domain deliberately does not write prose, so this is
    /// where the wording lives and where a copy edit lands without touching
    /// anything that has a test pointed at it.
    public static func sentence(for announcement: Announcement) -> String {
        switch announcement {
        case .sessionStarted(let task, let minutes):
            return "Starting \(minutes) minutes on \(task)."
        case .focusBeginning(let block, let total, let minutes):
            return block == 1
                ? "First block. \(minutes) minutes."
                : "Block \(block) of \(total). \(minutes) minutes."
        case .restBeginning(let minutes):
            return "Break — \(minutes) minute\(minutes == 1 ? "" : "s")."
        case .restEnding:
            return "Break's nearly over."
        case .sessionComplete(let minutes):
            return "Session done. \(minutes) minutes of focus."
        case .sessionEndedEarly(let minutes):
            return "Wrapped up early. \(minutes) minutes of focus."
        case .waitingForReturn:
            return "The break's over whenever you're back."
        case .paused:
            return "Paused."
        case .resumed:
            return "Back on it."
        }
    }
}
