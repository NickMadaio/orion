import AppKit
import SwiftUI

/*
 Real behind-the-window translucency.

 SwiftUI's `.ultraThinMaterial` looks like the right tool and is not, on macOS:
 it blends with content INSIDE the window. In a window whose own background is
 clear there is nothing inside to blend with, so it renders as a flat grey
 wash — and if anything opaque sits behind it in the view stack, it blurs THAT
 instead of the desktop. Both of those were happening here at once.

 `NSVisualEffectView` with `blendingMode = .behindWindow` is the one that
 actually samples the wallpaper and the windows underneath. It is the same
 mechanism Notification Centre and the menu bar use.

 Three settings matter and all three are easy to get wrong:

   • `.behindWindow` — the whole point. `.withinWindow` is the default-ish
     behaviour that produced the flat grey.
   • `state = .active` — otherwise the effect goes inert whenever the window is
     not key, so the panel turns solid the moment you click anything else.
   • `material` — `.hudWindow` is the darkest of the translucent set, which
     suits a dark dashboard. `.underWindowBackground` is the most transparent.

 The host window must also be `isOpaque = false` with a clear `backgroundColor`,
 which `TextWindowController` already does.
*/

struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .hudWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        // Without this the blur stops working when the window loses focus,
        // which reads as the background randomly turning solid.
        view.state = .active
        view.isEmphasized = false
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
    }
}

/// How much of the desktop shows through, as a preference.
///
/// Stored rather than fixed for the same reason `SummonSettings.brightness` is:
/// the right amount depends on the wallpaper behind it and how much contrast
/// the text needs, and neither is knowable from here. It was hardcoded, got it
/// wrong, and changing it cost a rebuild.
enum SurfaceSettings {

    static let tintKey = "OrionSurfaceTint"

    /// 0 = pure glass, 1 = fully solid. The tint painted OVER the blur.
    static let tintRange: ClosedRange<Double> = 0...0.85
    static let defaultTint: Double = 0.22

    static var tint: Double {
        get {
            guard UserDefaults.standard.object(forKey: tintKey) != nil else {
                return defaultTint
            }
            let stored = UserDefaults.standard.double(forKey: tintKey)
            return min(tintRange.upperBound, max(tintRange.lowerBound, stored))
        }
        set {
            UserDefaults.standard.set(
                min(tintRange.upperBound, max(tintRange.lowerBound, newValue)),
                forKey: tintKey
            )
        }
    }
}
