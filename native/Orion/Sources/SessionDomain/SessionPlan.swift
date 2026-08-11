//
//  The shape of a session, decided once and then never edited.
//
//  A plan is IMMUTABLE. That is the load-bearing property, and it is what makes
//  the rest of the domain tractable. Pause, idle, sleep, a shortened break and a
//  clock change all alter what is happening *now*; none of them alter what was
//  planned. Keeping "what was asked for" separate from "what has happened"
//  means the effective schedule is always derived, never patched — so there is
//  no state to get out of sync with itself, and reconstructing the session after
//  a crash is a calculation rather than a guess.
//
//  Phase durations here are REQUESTED durations. A break that gets shortened
//  does not rewrite its definition; it appends an event saying it was shortened.
//

import Foundation

// MARK: - Phase kinds

public enum PhaseKind: String, Codable, Sendable, CaseIterable {
    case focus
    case rest

    /// Rest phases are the guided breaks. Naming them `rest` rather than
    /// `break` only because `break` is a keyword and `case \`break\`` reads
    /// badly everywhere it is used.
    public var isFocus: Bool { self == .focus }
}

// MARK: - Clips

/// Which binaural clip a phase plays, and how it is fitted to the phase.
///
/// Clip N is deliberately NOT bound to block N. Nick asked for them to be
/// interchangeable, plus shuffle.
public struct ClipAssignment: Codable, Equatable, Sendable {
    /// The clip's name in the convention directory. Not a path — the domain is
    /// pure and does not know where files live.
    public let name: String

    /// How to reconcile clip length with the phase's requested duration.
    public let fit: ClipFit

    /// How long the media actually is, when the caller has probed it.
    ///
    /// Stored SEPARATELY from the phase's requested duration and never merged
    /// into it, which is the whole of plan correction #10. Nil means nobody has
    /// looked yet — a legitimate state at setup time, and the reason `fit` has
    /// to survive a nil here rather than assuming a length.
    public let mediaDuration: TimeInterval?

    public init(name: String, fit: ClipFit = .trimOrLoop, mediaDuration: TimeInterval? = nil) {
        self.name = name
        self.fit = fit
        self.mediaDuration = mediaDuration
    }
}

/// What to do when the clip and the phase disagree about length.
///
/// The default never lets media length silently redefine the session. A 43
/// minute clip in a 50 minute block loops; a 62 minute clip is trimmed. If Nick
/// wants the clip to win he has to say so at setup, and then the REQUESTED
/// duration changes with it and is recorded as such — the media never quietly
/// overrides the number he asked for.
public enum ClipFit: String, Codable, Sendable {
    case trimOrLoop
    case useClipLength
}

// MARK: - Phase definition

public struct PhaseDefinition: Codable, Equatable, Sendable, Identifiable {
    public let id: PhaseID
    public let index: Int
    public let kind: PhaseKind

    /// What the user asked for. Never mutated — not by a shortened break, not by
    /// a clip that turned out to be a different length.
    public let requestedDuration: TimeInterval

    /// Nil for a phase that plays nothing.
    public let clip: ClipAssignment?

    /// The duration this phase will actually run for.
    ///
    /// Computed rather than stored, so swapping clips around — which shuffle
    /// does — cannot leave a duration behind that belongs to the clip that used
    /// to be here. `requestedDuration` stays the user's number no matter how
    /// many times the clips move.
    public var plannedDuration: TimeInterval {
        SessionPlanBuilder.duration(for: clip, requested: requestedDuration)
    }

    /// True when the media has redefined the length. Worth surfacing at setup:
    /// it is the one case where the session is not the length that was typed.
    public var lengthComesFromClip: Bool {
        plannedDuration != requestedDuration
    }

    public init(id: PhaseID, index: Int, kind: PhaseKind,
                requestedDuration: TimeInterval, clip: ClipAssignment? = nil) {
        self.id = id
        self.index = index
        self.kind = kind
        self.requestedDuration = requestedDuration
        self.clip = clip
    }
}

// MARK: - The plan

public struct SessionPlan: Codable, Equatable, Sendable {
    /// Fixed when the plan is built, because the phase IDs are derived from it
    /// and they have to agree. Carried explicitly rather than parsed back out
    /// of a phase ID, which would make the ID format load-bearing.
    public let sessionID: SessionID

    public let phases: [PhaseDefinition]

    /// What the user typed when they started. Carried in the plan because it is
    /// part of what was agreed, and because the archive is useless without it.
    public let task: String

    public init(sessionID: SessionID, phases: [PhaseDefinition], task: String) {
        self.sessionID = sessionID
        self.phases = phases
        self.task = task
    }

    /// What the session will run for, clip fitting included.
    public var totalPlannedDuration: TimeInterval {
        phases.reduce(0) { $0 + $1.plannedDuration }
    }

    /// What the user asked for, before any clip had a say. Shown beside the
    /// planned total when the two differ, rather than quietly replaced by it.
    public var totalRequestedDuration: TimeInterval {
        phases.reduce(0) { $0 + $1.requestedDuration }
    }

    public var focusDuration: TimeInterval {
        phases.filter(\.kind.isFocus).reduce(0) { $0 + $1.plannedDuration }
    }

    public func phase(at index: Int) -> PhaseDefinition? {
        phases.indices.contains(index) ? phases[index] : nil
    }

    public var lastIndex: Int { phases.count - 1 }
}

// MARK: - Building one

public enum SessionPlanBuilder {

    /// The default session: three 50-minute focus blocks separated by two
    /// 10-minute breaks. Written as an alternating pattern rather than a
    /// hardcoded five so a 2/1/2-minute fixture — which is what the dev loop
    /// actually runs — is the same code path as the real thing.
    public static func alternating(
        session: SessionID,
        focusBlocks: Int = 3,
        focus: TimeInterval = 50 * 60,
        rest: TimeInterval = 10 * 60,
        clips: [ClipAssignment] = [],
        task: String
    ) -> SessionPlan {
        precondition(focusBlocks >= 1, "a session with no focus block is not a session")

        var phases: [PhaseDefinition] = []
        var clipCursor = 0

        for block in 0..<focusBlocks {
            // Clips cycle rather than run out. With three clips and three blocks
            // this is one each; with two clips and three blocks the first plays
            // again, which is better than a silent third block.
            let clip: ClipAssignment? = clips.isEmpty
                ? nil
                : clips[clipCursor % clips.count]
            clipCursor += 1

            phases.append(PhaseDefinition(
                id: PhaseID(session: session, index: phases.count),
                index: phases.count,
                kind: .focus,
                requestedDuration: focus,
                clip: clip
            ))

            // A break BETWEEN blocks, never after the last one. Ending a session
            // on ten minutes of enforced rest is a way to make someone resent it.
            if block < focusBlocks - 1 {
                phases.append(PhaseDefinition(
                    id: PhaseID(session: session, index: phases.count),
                    index: phases.count,
                    kind: .rest,
                    requestedDuration: rest,
                    clip: nil
                ))
            }
        }

        return SessionPlan(sessionID: session, phases: phases, task: task)
    }

    /// `useClipLength` is the only way media length may change the requested
    /// duration.
    ///
    /// When it does, the change lands HERE, in the immutable definition, at plan
    /// time — so the number stored as "requested" is the number the session will
    /// actually run, and the archive is not later contradicted by playback. Every
    /// other case returns what was asked for and lets the player trim or loop.
    ///
    /// A nil `mediaDuration` means nobody probed the file. That cannot become a
    /// zero-length phase, so the request stands and the mismatch is a playback
    /// concern rather than a planning one.
    static func duration(for clip: ClipAssignment?,
                         requested: TimeInterval) -> TimeInterval {
        guard let clip, clip.fit == .useClipLength,
              let media = clip.mediaDuration, media > 0 else { return requested }
        return media
    }

    // MARK: Shuffling

    /// Shuffle with an injected permutation, because the domain is pure and a
    /// plan that shuffles differently on every call cannot be tested or
    /// reproduced from a fixture.
    ///
    /// The caller supplies the order; `Array.shuffled()` lives in the service.
    public static func assigning(_ clips: [ClipAssignment],
                                 to plan: SessionPlan,
                                 order: [Int]) -> SessionPlan {
        guard !clips.isEmpty else { return plan }

        var cursor = 0
        let phases = plan.phases.map { phase -> PhaseDefinition in
            guard phase.kind.isFocus else { return phase }
            let position = order.indices.contains(cursor) ? order[cursor] : cursor
            cursor += 1
            return PhaseDefinition(
                id: phase.id,
                index: phase.index,
                kind: phase.kind,
                requestedDuration: phase.requestedDuration,
                clip: clips[position % clips.count]
            )
        }
        return SessionPlan(sessionID: plan.sessionID, phases: phases, task: plan.task)
    }
}
