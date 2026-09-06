import Foundation

/*
 Turn-taking as one pure, clock-injected value type, in the shape of
 `StallWatchdog` and `RunProgressModel` — no audio device, no socket, no
 subprocess, so the behaviour is testable on demand instead of by talking to
 a real microphone for twelve minutes.

 `AppState.phase` (`OrionPhase`) stays the four cases it already is —
 replacing it wholesale was judged too large a change for this pass, and is
 named as follow-up work in `planning/v2/PHASE_VOICE_TURN_TAKING.md` rather
 than attempted and left half-migrated. What lives here instead is the
 substate the brief asked for, modelled completely and exercised completely
 by `Tests/TurnTakingHarness`, and used for real by two things `AppState`
 could not otherwise get right:

   - `BargeInPolicy` decides whether observed speech is a deliberate
     interruption. `BargeInMonitor.swift` calls it live, on every phrase it
     hears while Orion is thinking or speaking.
   - `TurnAction` separates three things a single `bargeIn()` used to run
     together: stopping the voice, cancelling the in-flight task, and (new)
     pausing it — leaving the agent subprocess running so a paused answer
     can still be recovered instead of thrown away. See
     `AppState.pauseThinking`, which exists because of this file's
     `TurnAction.pauseTask` case.

 The endpointing DECISION that moves `.listening` through its substates is
 `AdaptiveEndpointModel`, in its own file; this type is the state the decision
 lands in, not a second copy of the decision itself.
 */

// MARK: - Substates

enum ListeningSubstate: Equatable {
    /// Speech is arriving, or too little silence has passed to consider it a
    /// pause at all.
    case capturing
    /// Silence has passed the point worth noticing. Not yet a decision —
    /// `AdaptiveEndpointModel` may still resolve this back to `capturing` the
    /// instant new speech arrives.
    case possiblePause
    /// The model has decided the speaker is done; the utterance is being
    /// delivered.
    case finalizing
}

enum SpeakingSubstate: Equatable {
    case playing
    /// A confident, policy-approved interruption was heard. Kept as its own
    /// observable state (rather than jumping straight to `.idle`) so a caller
    /// can record the reply as interrupted and offer to resume it before the
    /// state moves on.
    case interrupted
}

enum TurnPhase: Equatable {
    case idle
    case listening(ListeningSubstate)
    case thinking
    case speaking(SpeakingSubstate)
}

// MARK: - Barge-in policy

/// What the microphone actually captures right now. Bluetooth-only for now —
/// see `PHASE_AUDIO_COEXISTENCE.md` §1-3 for the measurement this rests on:
/// with Bluetooth output, `AudioInputRouteLease` captures from the built-in
/// mic instead, so headphone audio never reaches the microphone at all.
/// Wired-headphone detection is not implemented; see the design note's
/// "needs Nick at a microphone" section.
enum AudioRouteKind: Equatable {
    case headset
    case speakers
}

/// Which test a heard phrase must pass to count as a deliberate interruption.
enum BargeInMode: Equatable {
    /// Any confident speech interrupts. Safe when Orion's own voice cannot
    /// reach the microphone at all.
    case voiceEnabled
    /// Orion's own voice IS on the mic (built-in speakers). An energy floor
    /// plus rejecting an apparent echo of the current sentence are the only
    /// defence against Orion interrupting himself.
    case voiceRestricted
}

enum BargeInPolicy {

    /// Route decides the mode ONLY while something is actually being played —
    /// `.thinking` has nothing on the output device to echo back, so it is
    /// unconditionally trusted whatever the route is. This is the
    /// distinction that makes "pause the thinking task by voice" safe to ship
    /// without waiting on a route measurement at all.
    static func mode(forOutputRoute route: AudioRouteKind, phase: TurnPhase) -> BargeInMode {
        if case .speaking = phase, route == .speakers {
            return .voiceRestricted
        }
        return .voiceEnabled
    }

    /// RMS floor, same 0...1 scale as `orionNormalisedLevel`, below which
    /// speaker-route audio is not even considered — this is what keeps a
    /// quiet room from producing spurious interruptions on the stricter path.
    static let speakerEnergyFloor: Double = 0.22

    /// The one decision both routes are judged by. `currentlySpoken` is
    /// whatever Orion is saying THIS instant (empty when nothing is), used
    /// only by the restricted path to reject text that is really just an
    /// echo of Orion's own sentence picked up by the room microphone.
    static func isInterruption(
        mode: BargeInMode,
        heardText: String,
        energy: Double,
        currentlySpoken: String
    ) -> Bool {
        let heard = heardText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !heard.isEmpty else { return false }
        switch mode {
        case .voiceEnabled:
            return true
        case .voiceRestricted:
            guard energy >= speakerEnergyFloor else { return false }
            let normalizedHeard = heard.lowercased()
            let normalizedSpoken = currentlySpoken.lowercased()
            if !normalizedSpoken.isEmpty, normalizedSpoken.contains(normalizedHeard) {
                return false
            }
            return true
        }
    }
}

// MARK: - Actions, kept apart on purpose

/// The things `AppState.bargeIn()` used to run together, named separately so
/// a caller can ask for exactly one. A spoken interruption during `.speaking`
/// only ever needs `.stopSpeaking`; the same interruption during `.thinking`
/// needs `.pauseTask`, never `.cancelTask` — the agent subprocess is left
/// running and its eventual answer is recoverable. Only Escape, which never
/// consults this file at all, asks for the destructive one.
enum TurnAction: Equatable {
    case stopSpeaking
    case pauseTask
    case cancelTask
    case finalizeUtterance
    case none
}

// MARK: - The pure model

/// Clock-injected: every method that can observe time takes `now` explicitly,
/// so a test can drive a week of simulated silence in a moment. No timer, no
/// audio tap, no subprocess.
struct TurnTakingModel: Equatable {

    private(set) var phase: TurnPhase = .idle
    private var endpoint: AdaptiveEndpointModel?

    let baseSilence: TimeInterval
    let extendedSilence: TimeInterval

    init(baseSilence: TimeInterval, extendedSilence: TimeInterval) {
        self.baseSilence = baseSilence
        self.extendedSilence = extendedSilence
    }

    // MARK: Listening

    mutating func beginListening(at now: Date) {
        phase = .listening(.capturing)
        endpoint = AdaptiveEndpointModel(now: now, baseSilence: baseSilence, extendedSilence: extendedSilence)
    }

    /// New transcript text, growing or shrinking. Returns `.finalizeUtterance`
    /// only once the model has decided the speaker is actually done;
    /// otherwise `.none`, with the substate updated to say what is happening.
    @discardableResult
    mutating func transcriptUpdated(_ text: String, confidence: Double? = nil, at now: Date) -> TurnAction {
        guard case .listening = phase else { return .none }
        endpoint?.noteTranscript(text, confidence: confidence, at: now)
        return evaluateEndpoint(at: now)
    }

    /// A clock tick with no new text — the only way silence itself is ever
    /// discovered, since `transcriptUpdated` only runs when something
    /// changed.
    @discardableResult
    mutating func silenceTick(at now: Date) -> TurnAction {
        guard case .listening = phase else { return .none }
        return evaluateEndpoint(at: now)
    }

    private mutating func evaluateEndpoint(at now: Date) -> TurnAction {
        guard let endpoint else { return .none }
        switch endpoint.verdict(at: now) {
        case .keepListening:
            let silence = now.timeIntervalSince(endpoint.lastEvidenceAt)
            phase = silence >= AdaptiveEndpointModel.considerationThreshold(baseSilence: endpoint.baseSilence)
                ? .listening(.possiblePause)
                : .listening(.capturing)
            return .none
        case .extending:
            phase = .listening(.possiblePause)
            return .none
        case .finalize:
            phase = .listening(.finalizing)
            return .finalizeUtterance
        }
    }

    /// The ear delivered a result — key released, or the model above decided
    /// to finalize. Always legal, even from `.idle`, so a delayed replay
    /// result arriving after a discard cannot desynchronise this model from
    /// reality; it just lands where it lands.
    mutating func utteranceDelivered() {
        endpoint = nil
        phase = .thinking
    }

    // MARK: Thinking / speaking

    mutating func replyReady() {
        phase = .speaking(.playing)
    }

    mutating func speechFinished() {
        phase = .idle
    }

    mutating func returnToIdle() {
        endpoint = nil
        phase = .idle
    }

    // MARK: Interruptions

    /// Confident speech observed while thinking or speaking. Returns the one
    /// action that applies — never a guess: the caller supplies the route
    /// and the currently-spoken text, and this only applies the policy to
    /// them.
    mutating func bargeIn(
        heardText: String,
        energy: Double,
        currentlySpoken: String,
        route: AudioRouteKind
    ) -> TurnAction {
        switch phase {
        case .thinking:
            guard !heardText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .none }
            return .pauseTask
        case .speaking:
            let mode = BargeInPolicy.mode(forOutputRoute: route, phase: phase)
            guard BargeInPolicy.isInterruption(
                mode: mode, heardText: heardText, energy: energy, currentlySpoken: currentlySpoken
            ) else { return .none }
            phase = .speaking(.interrupted)
            return .stopSpeaking
        default:
            return .none
        }
    }

    /// Escape, or push-to-talk being pressed while Orion is busy.
    /// Unconditional: never consults `AdaptiveEndpointModel` or a route,
    /// which is the whole point — these two must work even if every signal
    /// above is wrong or the microphone is silent.
    mutating func hardInterrupt() -> TurnAction {
        defer { phase = .idle; endpoint = nil }
        switch phase {
        case .speaking:
            return .stopSpeaking
        case .thinking:
            return .cancelTask
        default:
            return .none
        }
    }
}
