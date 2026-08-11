//
//  What the Session tab knows, kept out of the view.
//
//  The view renders; this decides. Splitting them is not ceremony here — the
//  interesting logic is "which controls are legal right now" and "why is it
//  quiet", and both are far easier to get right and to read as a function of a
//  snapshot than as conditionals scattered through a view hierarchy.
//

import SwiftUI
import Combine
import SessionDomain
import SessionService

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

    private let service: SessionService
    private let library: ClipLibrary
    private let enforcer: Enforcer
    private let effects: SessionEffects

    /// What a new session gets when started from this tab. Gate 7 ships the
    /// defaults; choosing them is a settings surface, not this one.
    var defaultTask = "Focus"
    var defaultBlocks = 3
    var defaultFocusMinutes = 50.0
    var defaultRestMinutes = 10.0

    init(service: SessionService, library: ClipLibrary, enforcer: Enforcer,
         effects: SessionEffects) {
        self.service = service
        self.library = library
        self.enforcer = enforcer
        self.effects = effects
        refresh()
    }

    func refresh() {
        let next = service.snapshot()
        let inventory = library.inventory()
        onMain {
            self.snapshot = next
            self.clipInventory = inventory
            self.applyEnforcementState()
        }
    }

    func adopt(_ snapshot: SessionSnapshot) {
        onMain {
            self.snapshot = snapshot
            self.applyEnforcementState()
        }
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

    /// The unconditional escape, one click away.
    func release() {
        enforcer.release()
        refresh()
    }

    // MARK: Status lines

    /// Never just silence. If nothing is playing, this says why.
    var audioLine: String {
        if let problem = effects.clipProblem { return problem }
        if let inventory = clipInventory, let explanation = inventory.explanation {
            return explanation
        }
        guard let status, case .running(let kind) = status else {
            let count = clipInventory?.clips.count ?? 0
            return "\(count) clip\(count == 1 ? "" : "s") ready."
        }
        guard kind.isFocus else { return "Quiet during the break." }
        guard let clip = snapshot.session?.plan
            .phase(at: snapshot.reconciliation?.phaseIndex ?? 0)?.clip else {
            return "This block has no clip."
        }
        return "Playing \(clip.name), looping until the block ends."
    }

    var audioIsProblem: Bool {
        effects.clipProblem != nil || (clipInventory?.explanation != nil)
    }

    private func describeEnforcement() -> String {
        if enforcer.isReleased { return "Released — Orion will not mention drift again." }
        if !enforcer.isArmed { return "Off. Nothing is being watched." }
        if enforcer.hasDisengaged { return "Stopped after too many nudges." }
        return enforcer.policy.level == .firm
            ? "Firm — Orion will keep saying something, up to six times."
            : "Gentle — Orion will say something once."
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
