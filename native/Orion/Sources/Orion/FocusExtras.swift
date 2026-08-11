//
//  Gate 10's switches, and the thing that flips them at the right moments.
//
//  Every one is OFF by default. That is not timidity — each of these adds a
//  permission, a destructive capability, or a battery cost, and the whole reason
//  they were held back to a separate gate is so that none of them is load-bearing
//  for a session that works. A session with all of this off is the session that
//  was verified end to end; everything here is something Nick opts into
//  individually, having read what it does.
//
//  The other rule: each one reports its own state. "Do Not Disturb is on" and
//  "Orion tried and the Shortcut is missing" must never look the same, because
//  the second one means he is about to be interrupted while believing he is not.
//

import Foundation
import Combine
import SessionDomain
import SessionService

/// The opt-ins, persisted. Nothing here defaults to true.
final class FocusExtras: ObservableObject {

    private enum Key {
        static let fullBleed = "orion.focus.fullBleedBreak"
        static let dnd = "orion.focus.doNotDisturb"
        static let music = "orion.focus.pauseMusic"
        static let camera = "orion.focus.cameraPresence"
        static let quitApps = "orion.focus.quitDistractions"
    }

    @Published var fullBleedBreak: Bool {
        didSet { UserDefaults.standard.set(fullBleedBreak, forKey: Key.fullBleed) }
    }
    @Published var doNotDisturb: Bool {
        didSet { UserDefaults.standard.set(doNotDisturb, forKey: Key.dnd) }
    }
    @Published var pauseMusic: Bool {
        didSet { UserDefaults.standard.set(pauseMusic, forKey: Key.music) }
    }
    @Published var cameraPresence: Bool {
        didSet { UserDefaults.standard.set(cameraPresence, forKey: Key.camera) }
    }
    /// Quitting apps needs BOTH this switch and a non-empty user-maintained
    /// list. Two independent conditions for the one destructive capability.
    @Published var quitDistractions: Bool {
        didSet { UserDefaults.standard.set(quitDistractions, forKey: Key.quitApps) }
    }

    init() {
        let defaults = UserDefaults.standard
        fullBleedBreak = defaults.bool(forKey: Key.fullBleed)
        doNotDisturb = defaults.bool(forKey: Key.dnd)
        pauseMusic = defaults.bool(forKey: Key.music)
        cameraPresence = defaults.bool(forKey: Key.camera)
        quitDistractions = defaults.bool(forKey: Key.quitApps)
    }
}

/// Applies the extras as a session starts, runs and ends.
///
/// Driven from the session snapshot like everything else, so it cannot disagree
/// with what is actually happening — and it tracks what it DID so it only undoes
/// its own work. Turning Do Not Disturb off at the end of a session Nick had
/// switched on himself would be Orion overriding a decision he made.
final class FocusExtrasCoordinator {

    private let extras: FocusExtras
    private let dnd = DoNotDisturbControl()
    private let music = AppleMusicControl()
    private let camera = CameraPresence()
    private let quittable: QuittableApps

    private var sessionIsLive = false
    private var turnedOnDND = false

    /// The most recent problem from each, so the UI can show them separately.
    private(set) var problems: [String] = []

    var onLog: ((String) -> Void)?

    init(extras: FocusExtras, quittable: QuittableApps) {
        self.extras = extras
        self.quittable = quittable
        dnd.onLog = { [weak self] in self?.onLog?($0) }
        music.onLog = { [weak self] in self?.onLog?($0) }
        camera.onLog = { [weak self] in self?.onLog?($0) }
    }

    /// Called on every session change.
    func apply(_ snapshot: SessionSnapshot) {
        let live = snapshot.isRunning
        if live && !sessionIsLive { begin() }
        if !live && sessionIsLive { end() }
        sessionIsLive = live
    }

    private func begin() {
        var found: [String] = []

        if extras.doNotDisturb {
            let outcome = dnd.enable()
            turnedOnDND = outcome.worked
            if let message = outcome.message { found.append("Do Not Disturb: \(message)") }
        }

        if extras.pauseMusic {
            let outcome = music.pauseForSession()
            // "Music is not running" is not a problem worth reporting; a refused
            // Automation consent is.
            if case .denied(let why) = outcome { found.append(why) }
            if case .failed(let why) = outcome { found.append("Music: \(why)") }
        }

        if extras.cameraPresence {
            camera.setEnabled(true)
            camera.start { [weak self] reading in
                if case .unavailable(let why) = reading {
                    self?.onLog?("[presence] \(why)")
                }
            }
            if !CameraPresence.isAuthorized {
                found.append("Presence checking is on but camera access has not been granted.")
            }
        }

        if extras.quitDistractions && quittable.list().isEmpty {
            // The switch is on and the list is empty, which means it will do
            // nothing. Say so rather than letting him believe it is working.
            found.append("Closing distractions is on, but your quittable list is empty, "
                         + "so nothing will be closed. Add apps to it first.")
        }

        problems = found
        for problem in found { onLog?("[extras] \(problem)") }
    }

    private func end() {
        // Only undo what was actually done.
        if turnedOnDND {
            _ = dnd.disable()
            turnedOnDND = false
        }
        music.resumeAfterSession()
        camera.setEnabled(false)
        problems = []
    }

    /// Close the apps Nick listed. Called only when he asked for it, and only
    /// ever against the list he maintains.
    @discardableResult
    func closeDistractions() -> [QuitOutcome] {
        guard extras.quitDistractions else { return [] }
        return quittable.list().map { quittable.quit(bundleID: $0.bundleID, name: $0.name) }
    }

    var presenceReading: PresenceReading { camera.lastReading }
    var isDoNotDisturbConfigured: Bool { dnd.isConfigured() }
    var doNotDisturbSetup: String { dnd.setupInstructions }
}
