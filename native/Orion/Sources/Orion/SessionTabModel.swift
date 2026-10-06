//
//  What the Session tab knows, kept out of the view.
//
//  The view renders; this decides. Splitting them is not ceremony here — the
//  interesting logic is "which controls are legal right now" and "why is it
//  quiet", and both are far easier to get right and to read as a function of a
//  snapshot than as conditionals scattered through a view hierarchy.
//

import SwiftUI
import AppKit
import Combine
import SessionDomain
import SessionService

enum SessionAudioSource: String, CaseIterable, Identifiable {
    case none
    case appleMusic
    case binaural

    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: return "Choose audio"
        case .appleMusic: return "Apple Music"
        case .binaural: return "Binaural"
        }
    }
    var icon: String {
        switch self {
        case .none: return "speaker.slash"
        case .appleMusic: return "music.note"
        case .binaural: return "waveform"
        }
    }

    static let playableCases: [SessionAudioSource] = [.appleMusic, .binaural]
}

struct GuardSetupRequest: Identifiable {
    let id: String
    let mode: SessionGuardMode
    let apps: [ProposedApp]
}

enum SessionGuardMode: String, CaseIterable, Identifiable {
    case progressive, gentle, guided, firm, shield

    var id: String { rawValue }
    var title: String { rawValue.uppercased() }
    var level: EnforcementLevel {
        switch self {
        case .progressive: return .guided // Keeps the domain ladder active.
        case .gentle: return .gentle
        case .guided: return .guided
        case .firm: return .firm
        case .shield: return .shield
        }
    }

    var explanation: String {
        switch self {
        case .progressive: return "Starts Gentle, then moves through Guided and Firm to Shield only if drift continues."
        case .gentle: return "Orion speaks once when you stay in a disallowed app."
        case .guided: return "After repeat drift, Orion brings your last confirmed work app forward."
        case .firm: return "After repeat drift, Orion hides the disallowed app without quitting it."
        case .shield: return "Orion shows a full-screen return-to-work prompt. Escape always works."
        }
    }
}

/// Not `@MainActor`.
///
/// AppState owns this and is not actor-isolated, so marking it would make the
/// wiring an async hop for no benefit. Instead every publish is pushed to the
/// main thread explicitly, which is the same guarantee with a smaller blast
/// radius — `adopt` is called from the session's dispatch timer, off main.
final class SessionTabModel: ObservableObject {

    struct Action: Equatable {
        let title: String
        let icon: String
        let kind: Kind

        enum Kind: Equatable { case start, pause, resume, skipRest, finish, abandon }
    }

    @Published private(set) var snapshot: SessionSnapshot = .none
    @Published private(set) var clipInventory: ClipInventory?
    @Published private(set) var enforcementLine = "Off."
    @Published private(set) var sensorsUnavailable: String?
    @Published private(set) var canRelease = false
    @Published private(set) var guardSetupRequest: GuardSetupRequest?
    @Published var audioSource: SessionAudioSource {
        didSet {
            coordinateAudioSourceChange()
            refreshMedia()
        }
    }
    @Published private(set) var mediaTitle = "Binaural focus"
    @Published private(set) var mediaArtist = "Orion"
    @Published private(set) var mediaAlbum = "Local focus clip"
    @Published private(set) var mediaPosition: TimeInterval = 0
    @Published private(set) var mediaDuration: TimeInterval = 0
    @Published private(set) var mediaVolume: Double = Double(ClipPlayer.defaultVolume)
    @Published private(set) var mediaIsPlaying = false
    @Published private(set) var mediaHasLoadedItem = false
    @Published private(set) var mediaShuffleEnabled = false
    @Published private(set) var mediaRepeatMode = "all"
    @Published private(set) var mediaProblem: String?
    @Published private(set) var mediaArtwork: NSImage?
    @Published private(set) var clockNow = Date()

    private let service: SessionService
    private let library: ClipLibrary
    private let clipPlayer: ClipPlayer
    private let music: AppleMusicControl
    private let enforcer: Enforcer
    private let effects: SessionEffects
    private let mediaQueue = DispatchQueue(label: "com.nickmadaio.orion.session-media",
                                           qos: .utility)
    private var mediaTimer: AnyCancellable?
    private var clipShuffleEnabled = false
    private var mediaRefreshInFlight = false
    private var lastIdleMusicProbe = Date.distantPast
    private var musicSeekWorkItem: DispatchWorkItem?
    private var musicVolumeWorkItem: DispatchWorkItem?
    private var mediaArtworkPersistentID: String?
    private var snapshotAdoptedAt = Date()
    private var activeSessionID: String?
    private var promptedGuardSessionIDs = Set<String>()

    /// What a new session gets when started from this tab. Gate 7 ships the
    /// defaults; choosing them is a settings surface, not this one.
    var defaultTask = "Focus"
    var defaultBlocks = 3
    var defaultFocusMinutes = 50.0
    var defaultRestMinutes = 10.0

    init(service: SessionService, library: ClipLibrary, clipPlayer: ClipPlayer,
         music: AppleMusicControl, enforcer: Enforcer, effects: SessionEffects) {
        self.service = service
        self.library = library
        self.clipPlayer = clipPlayer
        self.music = music
        self.enforcer = enforcer
        self.effects = effects
        // A source is a live choice, not a preference we can safely carry into
        // the next block. Starting from silence must look like silence.
        audioSource = .none
        effects.setClipPlaybackEnabled(false)
        refresh()
        refreshMedia()
        mediaTimer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] now in
                guard let self else { return }
                self.clockNow = now
                self.refreshMedia()
            }
    }

    func refresh() {
        let next = service.snapshot()
        let inventory = library.inventory()
        onMain {
            self.adoptOnMain(next)
            self.clipInventory = inventory
        }
    }

    func adopt(_ snapshot: SessionSnapshot) {
        onMain {
            self.adoptOnMain(snapshot)
            if self.audioSource == .binaural { self.applyClipStatus() }
        }
    }

    private func adoptOnMain(_ next: SessionSnapshot) {
        let now = Date()
        let incomingID = next.session?.id.raw
        if let activeSessionID, let incomingID, activeSessionID != incomingID {
            audioSource = .none
        }
        snapshot = next
        snapshotAdoptedAt = now
        clockNow = now

        if case .finished = next.reconciliation?.status {
            enforcer.disarm()
            audioSource = .none
        }
        applyEnforcementState()
        evaluateGuardSetup()
    }

    private func applyEnforcementState() {
        sensorsUnavailable = enforcer.sensorDisclosure
        canRelease = enforcer.isArmed
        enforcementLine = describeEnforcement()
    }

    /// `@Published` has to change on the main thread; `adopt` is called from the
    /// session's dispatch timer, which is not it.
    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    // MARK: Reading the snapshot

    private var status: SessionStatus? { snapshot.reconciliation?.status }

    var task: String? { snapshot.session?.plan.task }
    var approximate: Bool { snapshot.reconciliation?.approximate ?? false }

    /// The Home surface uses this to become the session dashboard while work is
    /// actually running. Breaks deliberately keep their own full-screen surface.
    var isActiveFocus: Bool {
        if case .running(let kind) = status { return kind.isFocus }
        return false
    }

    /// The service publishes durable snapshots every 30 seconds. The dashboard
    /// interpolates between them for a live clock, then snaps back to the next
    /// authoritative value. Paused and waiting states never accrue display time.
    private var liveSnapshotDelta: TimeInterval {
        guard case .running = status else { return 0 }
        return max(0, clockNow.timeIntervalSince(snapshotAdoptedAt))
    }

    var focusElapsedSeconds: TimeInterval {
        let durable = snapshot.reconciliation?.servedFocus ?? 0
        guard case .running(let kind) = status, kind.isFocus else { return durable }
        return durable + liveSnapshotDelta
    }

    var phaseRemainingSeconds: TimeInterval {
        max(0, (snapshot.reconciliation?.remainingInPhase ?? 0) - liveSnapshotDelta)
    }

    var phaseElapsedSeconds: TimeInterval {
        (snapshot.reconciliation?.servedInPhase ?? 0) + liveSnapshotDelta
    }

    var phaseProgress: Double {
        let elapsed = phaseElapsedSeconds
        let total = elapsed + phaseRemainingSeconds
        return total > 0 ? min(1, max(0, elapsed / total)) : 0
    }

    var focusBlockLabel: String {
        guard let now = snapshot.reconciliation, now.totalFocusBlocks > 0 else { return "FOCUS" }
        return "FOCUS · BLOCK \(min(now.completedFocusBlocks + 1, now.totalFocusBlocks)) OF \(now.totalFocusBlocks)"
    }

    var guardStrength: Double {
        if enforcer.isReleased || !enforcer.isArmed { return 0 }
        switch enforcer.effectiveLevel {
        case .gentle: return 0.02
        case .guided: return 0.34
        case .firm: return 0.68
        case .shield: return 1.0
        }
    }

    var activeGuardMode: SessionGuardMode? {
        guard enforcer.isArmed, !enforcer.isReleased else { return nil }
        if enforcer.isProgressive { return .progressive }
        return SessionGuardMode(rawValue: enforcer.policy.level.rawValue)
    }

    var activeGuardLabel: String? {
        guard let mode = activeGuardMode else { return nil }
        guard mode == .progressive else { return mode.title }
        return "PROGRESSIVE · \(enforcer.effectiveLevel.rawValue.uppercased())"
    }

    var driftCorrectionCount: Int { enforcer.escalationCount }

    var mediaProgress: Double {
        mediaDuration > 0 ? min(1, max(0, mediaPosition / mediaDuration)) : 0
    }

    var nextBreakLine: String {
        guard snapshot.reconciliation != nil else { return "Break timing will appear here." }
        let minutes = max(1, Int((phaseRemainingSeconds / 60).rounded(.up)))
        return "Break in \(minutes) min"
    }

    /// The state file could not be read. Distinct from "no session", and shown
    /// loudly — a session that vanishes silently is the failure this project
    /// keeps having.
    var unreadable: String? { snapshot.failure?.message }

    var headline: String {
        guard let status else { return "No session" }
        switch status {
        case .notStarted: return "Ready"
        case .running(let kind): return kind.isFocus ? "Focusing" : "Break"
        case .paused: return "Paused"
        case .waitingForReturn: return "Waiting for you"
        case .readyToComplete: return "Wrapping up"
        case .readyToAbandon: return "Closing out"
        case .finished(let reason):
            switch reason {
            case .completed: return "Done"
            case .early: return "Finished early"
            case .abandoned: return "Abandoned"
            }
        }
    }

    var stripTrailing: String? {
        guard let now = snapshot.reconciliation else { return nil }
        guard now.totalFocusBlocks > 0 else { return nil }
        return "\(min(now.completedFocusBlocks + 1, now.totalFocusBlocks)) of \(now.totalFocusBlocks)"
    }

    var remainingLine: String? {
        guard let now = snapshot.reconciliation, let status else { return nil }
        switch status {
        case .running:
            return "\(minutes(now.remainingInPhase)) left in this phase."
        case .paused:
            return "Paused after \(minutes(now.servedInPhase))."
        case .waitingForReturn:
            return "The break is over whenever you are back."
        case .finished, .readyToComplete:
            return "\(minutes(now.servedFocus)) of focus."
        case .readyToAbandon:
            // Paused so long it is being archived. Say what happened rather than
            // reporting a focus total that would read as an achievement.
            return "Paused overnight — closing this one out."
        case .notStarted:
            return nil
        }
    }

    var segments: [PhaseSegment] {
        guard let session = snapshot.session, let now = snapshot.reconciliation else { return [] }
        return session.plan.phases.map { phase in
            let isCurrent = phase.index == now.phaseIndex && !now.isOver
            let total = max(1, phase.plannedDuration)
            return PhaseSegment(
                id: phase.index,
                isFocus: phase.kind.isFocus,
                isPast: phase.index < now.phaseIndex || now.isOver,
                isCurrent: isCurrent,
                progress: isCurrent ? min(1, now.servedInPhase / total) : 0,
                // Proportional to length, so a ten-minute break is visibly
                // shorter than a fifty-minute block rather than an equal chunk.
                width: max(10, CGFloat(phase.plannedDuration / 60) * 3.2),
                tint: phase.kind.isFocus ? OrionTheme.accent : OrionTheme.blue
            )
        }
    }

    // MARK: Controls

    var availableActions: [Action] {
        guard let status else {
            return [Action(title: "Start a session", icon: "play", kind: .start)]
        }
        switch status {
        case .notStarted:
            return [Action(title: "Start", icon: "play", kind: .start)]
        case .running:
            return [
                Action(title: "Pause", icon: "pause", kind: .pause),
                Action(title: "Skip the break", icon: "forward", kind: .skipRest),
                Action(title: "Finish", icon: "checkmark", kind: .finish)
            ]
        case .paused:
            return [
                Action(title: "Resume", icon: "play", kind: .resume),
                Action(title: "Finish", icon: "checkmark", kind: .finish)
            ]
        case .waitingForReturn:
            return [
                Action(title: "I'm back", icon: "arrow.uturn.left", kind: .resume),
                Action(title: "Finish", icon: "checkmark", kind: .finish)
            ]
        case .readyToComplete:
            return [Action(title: "Finish", icon: "checkmark", kind: .finish)]
        case .readyToAbandon:
            // Nothing to offer: the service archives this on the next pass, and
            // a "Resume" here would fight it.
            return [Action(title: "Start another", icon: "play", kind: .start)]
        case .finished:
            return [Action(title: "Start another", icon: "play", kind: .start)]
        }
    }

    func perform(_ action: Action) {
        let request = RequestID(from: UUID())
        let kind: CommandKind

        switch action.kind {
        case .start:
            let clips = (clipInventory?.clips ?? []).map(\.assignment)
            kind = .start(plan: SessionPlanBuilder.alternating(
                session: SessionID(from: UUID()),
                focusBlocks: defaultBlocks,
                focus: defaultFocusMinutes * 60,
                rest: defaultRestMinutes * 60,
                clips: clips,
                task: defaultTask
            ))
        case .pause:    kind = .pause
        case .resume:   kind = snapshot.reconciliation?.status == .paused ? .resume : .noteReturned
        case .skipRest: kind = .skipRest
        case .finish:   kind = .finishEarly
        case .abandon:  kind = .abandon
        }

        let outcome = service.send(Command(requestID: request, origin: .dashboard,
                                           issuedAt: Date(), kind: kind))
        adopt(outcome.snapshot)
    }

    func toggleSessionPause() {
        guard let action = availableActions.first(where: {
            $0.kind == .pause || $0.kind == .resume
        }) else { return }
        perform(action)
    }

    func finishEarly() {
        guard let action = availableActions.first(where: { $0.kind == .finish }) else { return }
        perform(action)
    }

    /// The unconditional escape, one click away.
    func release() {
        enforcer.release()
        refresh()
    }

    func guardProposal() -> [ProposedApp] {
        enforcer.preflight(forTask: task ?? defaultTask).apps
    }

    func armGuard(_ mode: SessionGuardMode, allowing bundleIDs: Set<String>) {
        guard !bundleIDs.isEmpty else { return }
        enforcer.arm(Allowlist(bundleIDs: bundleIDs),
                     policy: EnforcementPolicy(level: mode.level),
                     progressive: mode == .progressive)
        guardSetupRequest = nil
        refresh()
    }

    func dismissGuardSetup() {
        guardSetupRequest = nil
    }

    /// A dashboard-started block has no conversational preflight. Ask once for
    /// this session unless voice or another trusted route already armed a list.
    private func evaluateGuardSetup() {
        guard let session = snapshot.session else { return }
        let id = session.id.raw

        if activeSessionID != id {
            // Clear a release carried by the previous session. Do not disturb a
            // list Orion already armed during a voice preflight for this one.
            if !enforcer.isArmed { enforcer.disarm() }
            activeSessionID = id
        }

        guard isActiveFocus else {
            guardSetupRequest = nil
            return
        }
        guard !enforcer.isArmed else {
            guardSetupRequest = nil
            return
        }
        guard !promptedGuardSessionIDs.contains(id) else { return }
        promptedGuardSessionIDs.insert(id)
        let proposal = enforcer.preflight(forTask: task ?? defaultTask)
        guardSetupRequest = GuardSetupRequest(id: id, mode: .progressive, apps: proposal.apps)
    }

    /// A break is still a break at three minutes. This is deliberately not a
    /// skip: it leaves a short, bounded reset without requiring the user to
    /// abandon the session or pretend the break never happened.
    /// End the rest phase now, because he held the exit.
    ///
    /// Expressed as "shorten the rest to what has already been served" rather
    /// than as a skip: the session's record then says he took a four-minute
    /// break, which is true, instead of saying he skipped one, which is not.
    /// A week of short-but-real breaks is a different problem from a week of
    /// skipped ones and should not look the same in the history.
    func endActiveBreak() {
        let served = max(1, phaseElapsedSeconds)
        let request = RequestID(from: UUID())
        let outcome = service.send(Command(requestID: request, origin: .dashboard,
                                           issuedAt: Date(), kind: .shortenRest(to: served)))
        adopt(outcome.snapshot)
    }

    func shortenActiveBreak(to minutes: Double = 3) {
        let request = RequestID(from: UUID())
        let outcome = service.send(Command(requestID: request, origin: .dashboard,
                                           issuedAt: Date(), kind: .shortenRest(to: minutes * 60)))
        adopt(outcome.snapshot)
    }

    // MARK: Session audio

    func selectAudioSource(_ source: SessionAudioSource) {
        guard source != .none else { return }
        guard audioSource != source else { return }
        audioSource = source
    }

    /// Used by the empty player. Choosing a source is an explicit request to
    /// start it, so the card never changes labels without making sound.
    func activateAudioSource(_ source: SessionAudioSource) {
        guard source != .none else { return }
        if audioSource != source { audioSource = source }
        switch source {
        case .none:
            break
        case .appleMusic:
            performMusic { $0.play() }
        case .binaural:
            guard let name = preferredClipName else {
                mediaProblem = clipInventory?.explanation ?? "The Binaural track is unavailable."
                return
            }
            effects.setClipPlaybackEnabled(true)
            effects.setClipPausedByUser(false)
            if case .failure(let failure) = clipPlayer.play(name) {
                mediaProblem = failure.reason
            }
            refreshMedia(after: 0.12)
        }
    }

    func mediaPlayPause() {
        switch audioSource {
        case .none:
            return
        case .appleMusic:
            performMusic { $0.playPause() }
        case .binaural:
            if clipPlayer.nowPlaying != nil {
                effects.setClipPausedByUser(clipPlayer.isPlaying)
            } else if let name = preferredClipName {
                effects.setClipPausedByUser(false)
                if case .failure(let failure) = clipPlayer.play(name) {
                    mediaProblem = failure.reason
                }
            } else {
                mediaProblem = clipInventory?.explanation ?? "Add a binaural focus track first."
            }
        }
        refreshMedia(after: 0.12)
    }

    func mediaPrevious() { moveMedia(by: -1) }
    func mediaNext() { moveMedia(by: 1) }

    func mediaToggleShuffle() {
        switch audioSource {
        case .none:
            return
        case .appleMusic:
            performMusic { $0.toggleShuffle() }
        case .binaural:
            clipShuffleEnabled.toggle()
        }
        refreshMedia(after: 0.12)
    }

    func mediaCycleRepeat() {
        guard audioSource == .appleMusic else { return } // Clips always loop to the phase boundary.
        performMusic { $0.cycleRepeat() }
    }

    func mediaSeek(fraction: Double) {
        let target = min(1, max(0, fraction)) * mediaDuration
        switch audioSource {
        case .none:
            return
        case .appleMusic:
            musicSeekWorkItem?.cancel()
            let controller = music
            let item = DispatchWorkItem { [weak self] in
                let outcome = controller.seek(to: target)
                self?.onMain { self?.report(outcome); self?.refreshMedia(after: 0.12) }
            }
            musicSeekWorkItem = item
            mediaQueue.asyncAfter(deadline: .now() + 0.08, execute: item)
        case .binaural: clipPlayer.seek(to: target)
        }
        mediaPosition = target
        if audioSource == .binaural { refreshMedia(after: 0.12) }
    }

    func setMediaVolume(_ value: Double) {
        let normalized = min(1, max(0, value))
        mediaVolume = normalized
        switch audioSource {
        case .none:
            return
        case .appleMusic:
            musicVolumeWorkItem?.cancel()
            let controller = music
            let item = DispatchWorkItem { [weak self] in
                let outcome = controller.setVolume(normalized)
                self?.onMain { self?.report(outcome) }
            }
            musicVolumeWorkItem = item
            mediaQueue.asyncAfter(deadline: .now() + 0.08, execute: item)
        case .binaural: clipPlayer.volume = Float(normalized)
        }
    }

    func openAudioLocation() {
        switch audioSource {
        case .none:
            return
        case .appleMusic:
            report(music.open())
        case .binaural:
            do {
                try FileManager.default.createDirectory(at: library.url,
                                                        withIntermediateDirectories: true)
                NSWorkspace.shared.open(library.url)
                refresh()
            } catch {
                mediaProblem = "Could not open the clip folder: \(error.localizedDescription)"
            }
        }
    }

    private var preferredClipName: String? {
        if let current = clipPlayer.nowPlaying { return current }
        if let planned = snapshot.session?.plan
            .phase(at: snapshot.reconciliation?.phaseIndex ?? 0)?.clip?.name {
            return planned
        }
        return clipInventory?.clips.first?.name
    }

    /// His Music playlists for the picker; loaded when the session screen opens (2026-10-06).
    @Published private(set) var musicPlaylists: [String] = []

    func loadPlaylists() {
        let controller = music
        mediaQueue.async { [weak self] in
            let names = controller.playlists()
            DispatchQueue.main.async { self?.musicPlaylists = names }
        }
    }

    func playPlaylist(_ name: String) {
        if audioSource != .appleMusic { audioSource = .appleMusic }
        let controller = music
        mediaQueue.async { [weak self] in
            let outcome = controller.play(playlist: name)
            DispatchQueue.main.async {
                self?.report(outcome)
                self?.refreshMedia(after: 0.4)
            }
        }
    }

    private func moveMedia(by offset: Int) {
        switch audioSource {
        case .none:
            return
        case .appleMusic:
            performMusic { controller in
                offset < 0 ? controller.previousTrack() : controller.nextTrack()
            }
        case .binaural:
            let clips = clipInventory?.clips ?? []
            guard !clips.isEmpty else {
                mediaProblem = clipInventory?.explanation ?? "Add a binaural focus track first."
                return
            }
            let next: Clip
            if clipShuffleEnabled, clips.count > 1 {
                next = clips.filter { $0.name != clipPlayer.nowPlaying }.randomElement() ?? clips[0]
            } else {
                let current = clips.firstIndex { $0.name == clipPlayer.nowPlaying } ?? (offset < 0 ? 0 : -1)
                next = clips[(current + offset + clips.count) % clips.count]
            }
            if case .failure(let failure) = clipPlayer.play(next.name) {
                mediaProblem = failure.reason
            }
        }
        refreshMedia(after: 0.12)
    }

    private func coordinateAudioSourceChange() {
        effects.setClipPlaybackEnabled(audioSource == .binaural)
        switch audioSource {
        case .none:
            break
        case .appleMusic:
            break
        case .binaural:
            let controller = music
            mediaQueue.async { _ = controller.pauseForSession() }
        }
    }

    private func refreshMedia(after delay: TimeInterval = 0) {
        if delay > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.refreshMedia()
            }
            return
        }

        switch audioSource {
        case .none:
            probeExistingMusicIfNeeded()
        case .binaural:
            onMain { self.applyClipStatus() }
        case .appleMusic:
            guard !mediaRefreshInFlight else { return }
            mediaRefreshInFlight = true
            mediaQueue.async { [weak self] in
                guard let self else { return }
                let status = self.music.status()
                self.onMain {
                    self.mediaRefreshInFlight = false
                    guard self.audioSource == .appleMusic else { return }
                    self.applyMusicStatus(status)
                }
            }
        }
    }

    /// If Music was already playing when the block began, adopt it rather than
    /// covering it with an empty chooser. A stopped or paused Music app is not a
    /// choice; the user still gets the two-source prompt.
    private func probeExistingMusicIfNeeded() {
        guard isActiveFocus else {
            onMain { self.applyNoAudioStatus() }
            return
        }
        guard Date().timeIntervalSince(lastIdleMusicProbe) >= 5 else { return }
        guard !mediaRefreshInFlight else { return }
        lastIdleMusicProbe = Date()
        mediaRefreshInFlight = true
        let controller = music
        mediaQueue.async { [weak self] in
            let status = controller.status()
            self?.onMain {
                guard let self else { return }
                self.mediaRefreshInFlight = false
                guard self.audioSource == .none else { return }
                if case .ready(let now) = status, now.isPlaying {
                    self.audioSource = .appleMusic
                    self.applyMusicStatus(status)
                } else {
                    self.applyNoAudioStatus()
                }
            }
        }
    }

    private func applyClipStatus() {
        clearMusicArtwork()
        let selected = clipInventory?.clips.first { $0.name == preferredClipName }
        let problem = clipPlayer.lastFailure ?? clipInventory?.explanation
        mediaTitle = preferredClipName ?? "Binaural focus"
        mediaArtist = "Orion"
        mediaAlbum = problem ?? (selected == nil ? "Local focus track" : "Binaural focus")
        mediaPosition = clipPlayer.currentTime
        mediaDuration = clipPlayer.duration > 0 ? clipPlayer.duration : (selected?.duration ?? 0)
        mediaVolume = Double(clipPlayer.volume)
        mediaIsPlaying = clipPlayer.isPlaying
        mediaHasLoadedItem = clipPlayer.nowPlaying != nil
        mediaShuffleEnabled = clipShuffleEnabled
        mediaRepeatMode = "all"
        mediaProblem = problem
    }

    private func applyMusicStatus(_ status: AppleMusicStatus) {
        switch status {
        case .ready(let now):
            refreshMusicArtwork(for: now.persistentID)
            mediaTitle = now.title.isEmpty ? "Apple Music" : now.title
            mediaArtist = now.artist.isEmpty ? (now.isPlaying ? "Playing" : "Ready") : now.artist
            mediaAlbum = now.album.isEmpty ? "Choose music in the Music app" : now.album
            mediaPosition = now.position
            mediaDuration = now.duration
            mediaVolume = now.volume
            mediaIsPlaying = now.isPlaying
            mediaHasLoadedItem = !now.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            mediaShuffleEnabled = now.shuffleEnabled
            mediaRepeatMode = now.repeatMode
            mediaProblem = nil
        case .unavailable(let why):
            clearMusicArtwork()
            mediaTitle = "Apple Music"
            mediaArtist = "Not connected"
            mediaAlbum = why
            mediaPosition = 0
            mediaDuration = 0
            mediaIsPlaying = false
            mediaHasLoadedItem = false
            mediaShuffleEnabled = false
            mediaRepeatMode = "off"
            mediaProblem = why
        }
    }

    private func applyNoAudioStatus() {
        clearMusicArtwork()
        mediaTitle = "Choose focus audio"
        mediaArtist = "Nothing is playing"
        mediaAlbum = "Use Apple Music or Orion's local Binaural track."
        mediaPosition = 0
        mediaDuration = 0
        mediaIsPlaying = false
        mediaHasLoadedItem = false
        mediaShuffleEnabled = false
        mediaRepeatMode = "off"
        mediaProblem = nil
    }

    private func refreshMusicArtwork(for persistentID: String) {
        guard !persistentID.isEmpty else {
            clearMusicArtwork()
            return
        }
        guard mediaArtworkPersistentID != persistentID else { return }
        mediaArtworkPersistentID = persistentID
        mediaArtwork = nil
        let controller = music
        mediaQueue.async { [weak self] in
            let data = controller.artworkData()
            self?.onMain {
                guard let self, self.audioSource == .appleMusic,
                      self.mediaArtworkPersistentID == persistentID else { return }
                self.mediaArtwork = data.flatMap(NSImage.init(data:))
            }
        }
    }

    private func clearMusicArtwork() {
        mediaArtworkPersistentID = nil
        mediaArtwork = nil
    }

    var shouldOfferAudioChoices: Bool {
        audioSource == .none || (!mediaIsPlaying && !mediaHasLoadedItem)
    }

    var mediaStateLabel: String {
        if audioSource == .none { return "CHOOSE AUDIO" }
        if mediaIsPlaying { return "PLAYING" }
        if mediaHasLoadedItem { return "PAUSED" }
        if mediaProblem != nil { return "UNAVAILABLE" }
        return "READY"
    }

    private func report(_ outcome: ExternalOutcome) {
        if let message = outcome.message { mediaProblem = message }
    }

    private func performMusic(_ action: @escaping (AppleMusicControl) -> ExternalOutcome) {
        let controller = music
        mediaQueue.async { [weak self] in
            let outcome = action(controller)
            self?.onMain {
                self?.report(outcome)
                self?.refreshMedia(after: 0.12)
            }
        }
    }

    // MARK: Status lines

    /// Never just silence. If nothing is playing, this says why.
    var audioLine: String {
        if audioSource == .none {
            return "Nothing is playing. Choose Apple Music or Binaural."
        }
        if mediaIsPlaying {
            return "Playing \(mediaTitle)."
        }
        if mediaHasLoadedItem {
            return "\(mediaTitle) is paused."
        }
        if let mediaProblem { return mediaProblem }
        if let problem = effects.clipProblem { return problem }
        if let inventory = clipInventory, let explanation = inventory.explanation {
            return explanation
        }
        guard let status, case .running(let kind) = status else {
            let count = clipInventory?.clips.count ?? 0
            return "\(count) clip\(count == 1 ? "" : "s") ready."
        }
        guard kind.isFocus else { return "Quiet during the break." }
        return "Nothing is playing. Choose Apple Music or Binaural."
    }

    var audioIsProblem: Bool {
        effects.clipProblem != nil || (clipInventory?.explanation != nil)
    }

    private func describeEnforcement() -> String {
        if enforcer.isReleased { return "Released — Orion will not mention drift again." }
        if !enforcer.isArmed { return "Off. Nothing is being watched." }
        if enforcer.hasDisengaged { return "Stopped after too many nudges." }
        switch enforcer.policy.level {
        case .gentle: return "Gentle — Orion will say something once."
        case .guided: return "Guided — Orion will return you to a confirmed work app."
        case .firm: return "Firm — Orion can hide a disallowed app without quitting it."
        case .shield: return "Shield — Orion will show a reversible return-to-work surface."
        }
    }

    private func minutes(_ seconds: TimeInterval) -> String {
        seconds < 60 ? "\(Int(seconds))s" : "\(Int((seconds / 60).rounded()))m"
    }
}

// MARK: - Segments

/// One phase, as the strip draws it.
///
/// Lived in SessionTab.swift until the tab became a card on Home. The type
/// belongs with the model that produces it, not with whichever view happens to
/// render it this month.
struct PhaseSegment: Identifiable {
    let id: Int
    let isFocus: Bool
    let isPast: Bool
    let isCurrent: Bool
    let progress: Double
    let width: CGFloat
    let tint: Color
}
