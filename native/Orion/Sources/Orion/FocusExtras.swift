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
        static let breakLength = "orion.break.length"
        static let guidedBreathing = "orion.break.guided"
        static let ambience = "orion.break.ambience"
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
    /// Ten minutes, or three by choice. Chosen in advance — see BreakLock for
    /// why this is two options rather than a slider.
    @Published var breakLength: BreakLength {
        didSet { UserDefaults.standard.set(breakLength.rawValue, forKey: Key.breakLength) }
    }

    /// The breathing circle. On by default; some days the right answer is a
    /// calm screen with nothing moving on it.
    @Published var guidedBreathing: Bool {
        didSet { UserDefaults.standard.set(guidedBreathing, forKey: Key.guidedBreathing) }
    }

    @Published var breakAmbience: Ambience {
        didSet { UserDefaults.standard.set(breakAmbience.rawValue, forKey: Key.ambience) }
    }

    @Published var cameraPresence: Bool {
        didSet { UserDefaults.standard.set(cameraPresence, forKey: Key.camera) }
    }
    /// Closing apps at session start. Off by default, like everything here.
    ///
    /// It used to need this switch AND a list Nick maintained by hand. He
    /// refused to keep one, twice, and the list stayed empty — so the switch was
    /// on and nothing ever closed. The second condition is now a mechanical
    /// safety floor plus a reasoned, logged decision per app, which is a
    /// stronger guard than a list he was never going to write.
    @Published var quitDistractions: Bool {
        didSet { UserDefaults.standard.set(quitDistractions, forKey: Key.quitApps) }
    }

    init() {
        let defaults = UserDefaults.standard
        fullBleedBreak = defaults.bool(forKey: Key.fullBleed)
        doNotDisturb = defaults.bool(forKey: Key.dnd)
        pauseMusic = defaults.bool(forKey: Key.music)
        cameraPresence = defaults.bool(forKey: Key.camera)
        breakLength = BreakLength(rawValue: defaults.string(forKey: Key.breakLength) ?? "") ?? .full
        // Defaults to ON, which `bool(forKey:)` cannot express for an unset key.
        guidedBreathing = defaults.object(forKey: Key.guidedBreathing) as? Bool ?? true
        breakAmbience = Ambience(rawValue: defaults.string(forKey: Key.ambience) ?? "") ?? .rain
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
    let focus = FocusModeControl()
    private let music: AppleMusicControl
    private let camera = CameraPresence()
    private let quittable: QuittableApps
    private let distractions: DistractionCloser
    /// Started at launch, not at session start: "which apps has he actually
    /// used" is a question that can only be answered by having been watching.
    private let activations = ActivationHistory()

    /// Off the main thread: the reasoning step talks to a model and takes
    /// seconds, and a session must start at the moment it was asked for.
    private let work = DispatchQueue(label: "com.nickmadaio.orion.focus-extras",
                                     qos: .utility)

    private var sessionIsLive = false
    private var changedFocusMode = false

    /// The most recent problem from each, so the UI can show them separately.
    private(set) var problems: [String] = []

    var onLog: ((String) -> Void)?

    init(extras: FocusExtras, quittable: QuittableApps,
         music: AppleMusicControl = AppleMusicControl(),
         reasoner: DistractionReasoning? = nil) {
        self.extras = extras
        self.quittable = quittable
        self.music = music
        self.distractions = DistractionCloser(
            apps: RunningApps(activations: activations),
            quittable: quittable, reasoner: reasoner
        )
        activations.start()
        focus.onLog = { [weak self] in self?.onLog?($0) }
        music.onLog = { [weak self] in self?.onLog?($0) }
        camera.onLog = { [weak self] in self?.onLog?($0) }
        distractions.onLog = { [weak self] in self?.onLog?($0) }
    }

    /// Called on every session change.
    func apply(_ snapshot: SessionSnapshot) {
        // `isRunning` is true for any session that has not FINISHED — including
        // `waitingForReturn`, which is where a session sits indefinitely after a
        // rest phase ends with nobody at the desk. A session from six days ago
        // was still sitting in it, so this read as "live" the whole time and the
        // camera sampled every ninety seconds for six days, outside any session
        // anyone was having. The green light was telling the truth; this line
        // was not.
        //
        // The camera therefore follows the RUNNING phase specifically, and
        // nothing else. Do Not Disturb and the music can reasonably span a
        // pause; pointing a lens at somebody cannot.
        let live = snapshot.isRunning
        let inRunningPhase: Bool
        if case .running = snapshot.reconciliation?.status { inRunningPhase = true }
        else { inRunningPhase = false }

        if !inRunningPhase && camera.isEnabled {
            camera.setEnabled(false)
            onLog?("[presence] stopped — no phase is actually running")
        }

        if live && !sessionIsLive {
            begin(task: snapshot.session?.plan.task ?? "",
                  isFreshStart: SessionFreshness.startedJustNow(
                      events: snapshot.session?.events, now: Date()))
        }
        if !live && sessionIsLive { end() }
        sessionIsLive = live
    }

    private func begin(task: String, isFreshStart: Bool) {
        var found: [String] = []

        if extras.doNotDisturb {
            let outcome = focus.enableForSession()
            changedFocusMode = outcome.worked
            if let message = outcome.message {
                found.append("Focus (\(focus.sessionMode)): \(message)")
            }
        }

        let sessionPlayerUsesMusic = UserDefaults.standard.string(
            forKey: "orion.focus.audioSource"
        ) == "appleMusic"
        if extras.pauseMusic && !sessionPlayerUsesMusic {
            let outcome = music.pauseForSession()
            // "Music is not running" is not a problem worth reporting; a refused
            // Automation consent is.
            if case .denied(let why) = outcome { found.append(why) }
            if case .failed(let why) = outcome { found.append("Music: \(why)") }
        }

        if extras.cameraPresence {
            camera.setEnabled(true)
            camera.deadline = Date().addingTimeInterval(CameraPresence.maximumRun)
            camera.start { [weak self] reading in
                if case .unavailable(let why) = reading {
                    self?.onLog?("[presence] \(why)")
                }
            }
            if !CameraPresence.isAuthorized {
                found.append("Presence checking is on but camera access has not been granted.")
            }
        }

        if extras.quitDistractions && !isFreshStart {
            onLog?("[distractions] this session was already running before Orion "
                   + "started, so nothing is being closed")
        } else if extras.quitDistractions {
            if !AccessibilityDocumentSensor.isAvailable {
                // Without Accessibility no app's unsaved state can be read, and
                // an unreadable app is never closed — so this switch would do
                // nothing at all. Say so rather than letting him believe it is
                // working.
                found.append("Closing distractions is on, but without Accessibility "
                             + "Orion cannot tell which apps have unsaved work, so it "
                             + "will close nothing.")
            }
            // Everything about this runs off the session's own thread and logs
            // every decision it makes.
            work.async { [weak self] in
                self?.distractions.closeDistractions(task: task)
            }
        }

        problems = found
        for problem in found { onLog?("[extras] \(problem)") }
    }

    private func end() {
        // Only undo what was actually done.
        if changedFocusMode {
            _ = focus.disableForSession()
            changedFocusMode = false
        }
        music.resumeAfterSession()
        camera.setEnabled(false)
        problems = []
    }

    /// Say at launch what would happen, without doing any of it.
    ///
    /// Both of these used to be discoverable only by starting a session and
    /// reading the complaint afterwards — which is how "Orion Focus On does not
    /// exist" survived for as long as it did. This runs no model and quits
    /// nothing: it reads what is there and writes it down.
    func logReadiness() {
        work.async { [weak self] in
            guard let self else { return }

            if extras.doNotDisturb {
                let name = focus.shortcutName
                switch focus.exists(name) {
                case .some(true):
                    onLog?("[focus-mode] “\(name)” is installed; a session will run "
                           + "“\(FocusModeControl.input(mode: focus.sessionMode, intent: .on))”")
                case .some(false):
                    onLog?("[focus-mode] “\(name)” is not installed — a session will not "
                           + "change your Focus until you make it")
                case .none:
                    onLog?("[focus-mode] the Shortcuts list could not be read")
                }
            }

            guard extras.quitDistractions else { return }
            guard AccessibilityDocumentSensor.isAvailable else {
                onLog?("[distractions] Accessibility is not granted, so no app's "
                       + "unsaved state can be read and nothing will ever be closed")
                return
            }
            let review = reviewWithoutReasoning()
            onLog?("[distractions] at rest: \(review.considered) of \(review.total) running "
                   + "apps could be considered; held back — \(review.held)")
        }
    }

    /// The mechanical half only: screen everything, count the refusals by
    /// reason. No model, no side effects.
    private func reviewWithoutReasoning() -> (total: Int, considered: Int, held: String) {
        let facts = RunningApps(activations: activations).facts(now: Date())
        let (eligible, blocked) = DistractionFloor.partition(facts)
        var counts: [String: Int] = [:]
        for (_, reason) in blocked { counts[reason, default: 0] += 1 }
        let held = counts.sorted { $0.value > $1.value }
            .map { "\($0.value) × \($0.key)" }
            .joined(separator: "; ")
        return (facts.count, eligible.count, held.isEmpty ? "nothing" : held)
    }

    var presenceReading: PresenceReading { camera.lastReading }
    var isFocusShortcutConfigured: Bool { focus.isConfigured() }
    var focusSetup: String { focus.setupInstructions }
}
