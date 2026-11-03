import Foundation

/// The one runtime gate for the extra buttons. Not persisted: `bindings.enabled` is the master switch, this is the moment-to-moment one.
/// A focus change applies the auto rule (a game in front turns it off, anything else turns it on); the hotkey flips it at any moment.
public struct MouseGate: Equatable {
    public var isOn: Bool
    public init(isOn: Bool = true) { self.isOn = isOn }

    /// A real focus change (a different app, or the front app turned into a game). With auto-pause off, focus never touches the gate.
    public func focusChanged(frontIsGame: Bool, autoPause: Bool) -> MouseGate {
        autoPause ? MouseGate(isOn: !frontIsGame) : self
    }

    /// The hotkey.
    public func toggled() -> MouseGate { MouseGate(isOn: !isOn) }

    /// What a press actually meets: the master switch always wins over the gate.
    public func passes(masterEnabled: Bool) -> Bool { masterEnabled && isOn }
}
