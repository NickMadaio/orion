import SwiftUI

/// Minimum comfortable size of a click target on the Mac, in points.
enum HitTarget {
    static let minimum: CGFloat = 28
}

extension View {
    /// Grows the CLICKABLE area of a control to at least `HitTarget.minimum`
    /// square without moving or resizing what is drawn.
    ///
    /// Why it exists: a `.plain` button only hit-tests the pixels it draws, so a
    /// 12pt glyph (or a hairline ring around one) is a 12pt target, and a click
    /// on the transparent gap around it falls through to whatever sits behind --
    /// on the borderless session float that is the window-drag background, which
    /// swallows the click as the start of a drag. The minimum frame is applied first
    /// and the content shape after it, so the extra area is real, hit-testable
    /// and invisible.
    func hitTarget(_ side: CGFloat = HitTarget.minimum, shape: some Shape = Rectangle()) -> some View {
        frame(minWidth: side, minHeight: side)
            .contentShape(shape)
    }

    /// For a text-only control (MINIMIZE, PAUSE...): pads the label so its hit
    /// area clears `HitTarget.minimum` in height, then makes all of it hittable.
    func textHitTarget(horizontal: CGFloat = 8) -> some View {
        padding(.horizontal, horizontal)
            .frame(minHeight: HitTarget.minimum)
            .contentShape(Rectangle())
    }
}

/// Two-step confirm for a destructive control: the first tap arms it, a second
/// within `window` seconds fires, and an armed state left alone lapses.
struct ArmedConfirm: Equatable {
    static let window: TimeInterval = 3
    private(set) var armedAt: Date?

    func isArmed(now: Date = Date()) -> Bool {
        guard let armedAt else { return false }
        return now.timeIntervalSince(armedAt) <= Self.window
    }

    /// Returns true when this tap should perform the action.
    mutating func tap(now: Date = Date()) -> Bool {
        if isArmed(now: now) { armedAt = nil; return true }
        armedAt = now
        return false
    }

    mutating func disarm() { armedAt = nil }
}
