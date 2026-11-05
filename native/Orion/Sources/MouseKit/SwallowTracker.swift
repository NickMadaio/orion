import Foundation

/// Remembers which buttons had their down swallowed in the current tap session, so exactly those ups are swallowed too.
/// A pass-through down forgets the button, so a stale entry can never swallow a later pass-through press's up.
public struct SwallowTracker {
    private var swallowed = Set<Int>()
    public init() {}

    public mutating func swallowDown(_ button: Int) { swallowed.insert(button) }
    public mutating func passDown(_ button: Int) { swallowed.remove(button) }
    /// True when this up belongs to a swallowed down (and forgets it).
    public mutating func shouldSwallowUp(_ button: Int) -> Bool { swallowed.remove(button) != nil }
    /// True while this button's down is swallowed (a held key repeating).
    public func isSwallowed(_ button: Int) -> Bool { swallowed.contains(button) }
    public var hasAny: Bool { !swallowed.isEmpty }
    public mutating func reset() { swallowed.removeAll() }
}
