import Foundation

/*
 Two small rules around the typed overlay, as plain values so they are tested without a window.

 2026-11-04 11:20: he typed "open amazon uk for me", the overlay lost key status (a click, a window opening) and
 closed, and the turn ran on with nothing on screen: no overlay, no pill, no sound. A typed turn that is still in
 flight when the overlay closes goes up to the notch pill, as a voice turn does when he clicks away.

 Also 11-04: the mouse "type" button opened `orion://type`, an activation of ORION's own app, which fired the
 reopen handler and put the whole dashboard on screen. The overlay is now toggled directly; `ReopenPolicy` is the
 backstop for the URL route (scripts still use it).
*/
enum TypedSummonHandoff {
    /// Dock when something he sent is still running; a quiet overlay just closes.
    static func shouldDock(hasUserInput: Bool, phase: OrionPhase) -> Bool {
        hasUserInput && NotchTurnPhase(phase).isTurnInFlight
    }
}

struct ReopenPolicy {
    static let quietSeconds: TimeInterval = 2.0
    private var quietUntil: Date?

    /// The typed overlay was just summoned (URL or direct): the activation that follows is not "open the app".
    mutating func noteTypedSummon(now: Date) {
        quietUntil = now.addingTimeInterval(Self.quietSeconds)
    }

    func showsDashboard(now: Date, typedSummonVisible: Bool) -> Bool {
        if typedSummonVisible { return false }
        if let quietUntil, now < quietUntil { return false }
        return true
    }
}
